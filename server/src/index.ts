/**
 * Hearth relay — a dumb, stateless room server.
 *
 * Evolved from html-games `ws-bridge`: the 1:1 `pairs` map became an
 * N-player `rooms` map, and a `signal` passthrough was added so peers can
 * negotiate WebRTC (audio + screen share) over this same socket. The relay
 * still holds NO application state — positions live only on clients and are
 * fire-and-forget broadcast; media flows peer-to-peer, never through here.
 *
 * Reused verbatim in spirit from ws-bridge: 4-digit id generator, the
 * ghost-TTL rejoin grace, and "non-OPEN socket counts as a rejoin target".
 *
 * Runs on Node's native TypeScript (no build step). `node src/index.ts`.
 */
import { WebSocketServer, WebSocket } from "ws";
import { spawn } from "node:child_process";
import type {
  ClientId,
  ClientMessage,
  PeerInfo,
  RoomId,
  ServerMessage,
} from "../../shared/protocol.ts";

const PORT = Number(process.env.PORT) || 8090;
const GHOST_TTL = 60_000; // grace period (ms) for a dropped client to rejoin

/** Per-connection state we hang off each socket. */
interface Conn extends WebSocket {
  id: ClientId;
  room?: RoomId;
  name: string;
  x: number;
  y: number;
}

const clients = new Map<ClientId, Conn>(); // id -> live socket
const rooms = new Map<RoomId, Set<ClientId>>(); // room -> member ids
const ghosts = new Map<ClientId, NodeJS.Timeout>(); // dropped-but-not-purged

const wss = new WebSocketServer({ port: PORT, host: "0.0.0.0" });

function generateId(): ClientId {
  let id: string;
  do {
    id = Math.floor(1000 + Math.random() * 9000).toString();
  } while (clients.has(id) || ghosts.has(id));
  return id;
}

function send(ws: WebSocket | undefined, data: ServerMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

/** Send to every member of `room` except `exceptId`. */
function broadcast(room: RoomId, data: ServerMessage, exceptId?: ClientId): void {
  const members = rooms.get(room);
  if (!members) return;
  for (const memberId of members) {
    if (memberId === exceptId) continue;
    send(clients.get(memberId), data);
  }
}

function peerInfo(c: Conn): PeerInfo {
  return { id: c.id, name: c.name, x: c.x, y: c.y };
}

/** Remove a client from its room, notifying the rest. */
function leaveRoom(id: ClientId): void {
  const c = clients.get(id);
  const room = c?.room;
  if (!room) return;
  const members = rooms.get(room);
  if (members) {
    members.delete(id);
    if (members.size === 0) rooms.delete(room);
    else broadcast(room, { type: "peer_left", id }, id);
  }
  if (c) c.room = undefined;
}

/** Final cleanup once the ghost grace expires. */
function purge(id: ClientId): void {
  ghosts.delete(id);
  leaveRoom(id);
  clients.delete(id);
  console.log(`Purged ghost: ${id}`);
}

wss.on("connection", (socket) => {
  const ws = socket as Conn;
  ws.id = generateId();
  ws.name = "anon";
  ws.x = 0;
  ws.y = 0;
  clients.set(ws.id, ws);
  console.log(`Client connected: ${ws.id}`);
  send(ws, { type: "id", id: ws.id });

  ws.on("message", (raw) => {
    let data: ClientMessage;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (data.type) {
      // ── REJOIN: adopt a prior id within the ghost grace ──────────────────
      case "rejoin": {
        const oldId = data.id;
        if (oldId === ws.id) return;

        const isGhost = ghosts.has(oldId);
        // On fast reloads the old socket may not have fired 'close' yet —
        // any non-OPEN connection is a valid rejoin target (from ws-bridge).
        const stale = clients.get(oldId);
        const isStale = !!stale && stale.readyState !== WebSocket.OPEN;
        if (!isGhost && !isStale) return; // unknown id → keep fresh id

        if (isGhost) {
          clearTimeout(ghosts.get(oldId)!);
          ghosts.delete(oldId);
        } else if (stale) {
          try {
            stale.terminate();
          } catch {
            /* already gone */
          }
        }

        // Inherit the old connection's identity + room membership.
        const inheritedRoom = stale?.room;
        const inheritedName = stale?.name ?? ws.name;
        const inheritedX = stale?.x ?? ws.x;
        const inheritedY = stale?.y ?? ws.y;

        clients.delete(ws.id); // drop the temp id
        ws.id = oldId;
        ws.name = inheritedName;
        ws.x = inheritedX;
        ws.y = inheritedY;
        clients.set(oldId, ws);
        send(ws, { type: "id", id: oldId });

        if (inheritedRoom && rooms.has(inheritedRoom)) {
          ws.room = inheritedRoom;
          rooms.get(inheritedRoom)!.add(oldId);
          const peers = [...rooms.get(inheritedRoom)!]
            .filter((pid) => pid !== oldId)
            .map((pid) => peerInfo(clients.get(pid)!))
            .filter(Boolean);
          send(ws, { type: "joined", room: inheritedRoom, self: oldId, peers });
          broadcast(inheritedRoom, { type: "peer_joined", peer: peerInfo(ws) }, oldId);
        }
        console.log(`Client rejoined: ${oldId}`);
        return;
      }

      // ── JOIN: enter a room ───────────────────────────────────────────────
      case "join": {
        if (ws.room) leaveRoom(ws.id);
        ws.room = data.room;
        ws.name = (data.name || "anon").slice(0, 24);
        if (!rooms.has(data.room)) rooms.set(data.room, new Set());
        const members = rooms.get(data.room)!;

        const peers = [...members]
          .map((pid) => clients.get(pid))
          .filter((c): c is Conn => !!c)
          .map(peerInfo);

        members.add(ws.id);
        send(ws, { type: "joined", room: data.room, self: ws.id, peers });
        broadcast(data.room, { type: "peer_joined", peer: peerInfo(ws) }, ws.id);
        console.log(`${ws.id} joined room ${data.room} (${members.size} present)`);
        return;
      }

      // ── MOVE: fire-and-forget position broadcast ─────────────────────────
      case "move": {
        if (!ws.room) return;
        ws.x = data.x;
        ws.y = data.y;
        broadcast(ws.room, { type: "peer_move", id: ws.id, x: data.x, y: data.y }, ws.id);
        return;
      }

      // ── SIGNAL: direct WebRTC passthrough to one peer ────────────────────
      case "signal": {
        const target = clients.get(data.to);
        if (!target) return;
        send(target, { type: "signal", from: ws.id, data: data.data });
        return;
      }
    }
  });

  ws.on("close", () => {
    const id = ws.id;
    if (!id || clients.get(id) !== ws) return; // superseded by a rejoin
    clients.delete(id);
    console.log(`Client disconnected: ${id} — entering ghost state`);
    // Tell the room immediately; keep membership alive for GHOST_TTL so a
    // reload can silently rejoin without others seeing a flicker.
    if (ws.room) broadcast(ws.room, { type: "peer_left", id }, id);
    ghosts.set(id, setTimeout(() => purge(id), GHOST_TTL));
  });
});

wss.on("listening", () => {
  console.log(`Hearth relay on :${PORT}`);
  if (!process.env.TUNNEL) return;
  // Optional public URL via cloudflared (mirrors ws-bridge), behind TUNNEL=1.
  const cf = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${PORT}`]);
  cf.stderr.on("data", (d: Buffer) => {
    const m = d.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) console.log(`\n🌐 Tunnel URL: ${m[0]}  (clients paste this)\n`);
  });
  cf.on("exit", (code) => console.log(`cloudflared exited: ${code}`));
});
