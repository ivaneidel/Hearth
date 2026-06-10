/**
 * Hearth relay — a dumb, stateless room server.
 *
 * Evolved from html-games `ws-bridge`: the 1:1 `pairs` map became an
 * N-player `rooms` map, and a `signal` passthrough was added so peers can
 * negotiate WebRTC (audio + screen share) over this same socket. The relay
 * still holds NO application state beyond ephemeral room membership and a
 * last-known position used only to seed late joiners — media flows P2P.
 *
 * Handshake is deterministic: the server assigns an id internally on connect
 * but does NOT announce it until the client explicitly `join`s or `rejoin`s.
 * This avoids the temp-id race that used to leak an orphan avatar at (0,0).
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
const GHOST_TTL = 60_000; // grace (ms) for a dropped client to rejoin
const LEFT_DELAY = 2_500; // wait before telling others someone left (reload grace)

/** Per-connection state we hang off each socket. */
interface Conn extends WebSocket {
  id: ClientId;
  room?: RoomId;
  name: string;
  x: number;
  y: number;
}

/** State retained for a dropped client during its rejoin grace. */
interface Ghost {
  room?: RoomId;
  name: string;
  x: number;
  y: number;
  leftSent: boolean; // have we already told the room they left?
  leftTimer: NodeJS.Timeout;
  purgeTimer: NodeJS.Timeout;
}

const clients = new Map<ClientId, Conn>(); // id -> live socket
const rooms = new Map<RoomId, Set<ClientId>>(); // room -> member ids
const ghosts = new Map<ClientId, Ghost>(); // dropped-but-not-purged

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

/** Members of `room` other than `exceptId`, as PeerInfo. */
function roomPeers(room: RoomId, exceptId: ClientId): PeerInfo[] {
  const members = rooms.get(room);
  if (!members) return [];
  return [...members]
    .filter((pid) => pid !== exceptId)
    .map((pid) => clients.get(pid))
    .filter((c): c is Conn => !!c)
    .map(peerInfo);
}

/** Place a client into a room: confirm id, send the peer snapshot, announce. */
function doJoin(ws: Conn, room: RoomId, name: string): void {
  ws.room = room;
  ws.name = (name || "anon").slice(0, 24);
  if (!rooms.has(room)) rooms.set(room, new Set());
  const members = rooms.get(room)!;
  const peers = roomPeers(room, ws.id);
  members.add(ws.id);
  send(ws, { type: "id", id: ws.id });
  send(ws, { type: "joined", room, self: ws.id, peers });
  broadcast(room, { type: "peer_joined", peer: peerInfo(ws) }, ws.id);
  console.log(`${ws.id} joined room ${room} (${members.size} present)`);
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
  const g = ghosts.get(id);
  ghosts.delete(id);
  // The id may still sit in its room set (kept during ghost). Tidy it up.
  if (g?.room) {
    const members = rooms.get(g.room);
    if (members) {
      members.delete(id);
      if (members.size === 0) rooms.delete(g.room);
      else if (!g.leftSent) broadcast(g.room, { type: "peer_left", id }, id);
    }
  }
  clients.delete(id);
  console.log(`Purged ghost: ${id}`);
}

wss.on("connection", (socket) => {
  const ws = socket as Conn;
  ws.id = generateId(); // assigned now, announced only on join/rejoin
  ws.name = "anon";
  ws.x = 0;
  ws.y = 0;
  clients.set(ws.id, ws);
  console.log(`Client connected (pending): ${ws.id}`);

  ws.on("message", (raw) => {
    let data: ClientMessage;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (data.type) {
      // ── REJOIN: adopt a prior id within the grace, else fresh join ───────
      case "rejoin": {
        const oldId = data.id;
        const ghost = ghosts.get(oldId);
        const stale = clients.get(oldId);
        const isStale = !!stale && stale !== ws && stale.readyState !== WebSocket.OPEN;

        if (oldId !== ws.id && (ghost || isStale)) {
          if (ghost) {
            clearTimeout(ghost.leftTimer);
            clearTimeout(ghost.purgeTimer);
            ghosts.delete(oldId);
          }
          if (isStale && stale) {
            try { stale.terminate(); } catch { /* already gone */ }
          }

          const restoreRoom = ghost?.room ?? stale?.room;
          ws.name = ghost?.name ?? stale?.name ?? data.name;
          ws.x = ghost?.x ?? stale?.x ?? 0;
          ws.y = ghost?.y ?? stale?.y ?? 0;

          clients.delete(ws.id); // drop the temp id
          ws.id = oldId;
          clients.set(oldId, ws);
          send(ws, { type: "id", id: oldId });
          console.log(`Client rejoined: ${oldId}`);

          if (restoreRoom) {
            ws.room = restoreRoom;
            if (!rooms.has(restoreRoom)) rooms.set(restoreRoom, new Set());
            const members = rooms.get(restoreRoom)!;
            const peers = roomPeers(restoreRoom, oldId);
            members.add(oldId);
            send(ws, { type: "joined", room: restoreRoom, self: oldId, peers });
            // Only re-announce if the room had already been told we left.
            const announced = ghost?.leftSent ?? true;
            if (announced) {
              broadcast(restoreRoom, { type: "peer_joined", peer: peerInfo(ws) }, oldId);
            }
          } else {
            doJoin(ws, data.room, data.name);
          }
          return;
        }

        // Not restorable (cold server, expired grace): fresh join, no leak.
        doJoin(ws, data.room, data.name);
        return;
      }

      // ── JOIN: fresh entry ────────────────────────────────────────────────
      case "join": {
        if (ws.room) leaveRoom(ws.id);
        doJoin(ws, data.room, data.name);
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

      // ── CHAT: broadcast to room (receivers proximity-filter) ─────────────
      case "chat": {
        if (!ws.room) return;
        const text = String(data.text).slice(0, 500);
        if (!text.trim()) return;
        broadcast(ws.room, { type: "peer_chat", from: ws.id, name: ws.name, text }, ws.id);
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
    console.log(`Client disconnected: ${id} — ghost`);
    // Keep room membership alive; defer the "left" broadcast so a quick reload
    // rejoins silently (no blink-out for others). Purge after the full TTL.
    const g: Ghost = {
      room: ws.room,
      name: ws.name,
      x: ws.x,
      y: ws.y,
      leftSent: false,
      leftTimer: setTimeout(() => {
        const gg = ghosts.get(id);
        if (gg && gg.room) broadcast(gg.room, { type: "peer_left", id }, id);
        if (gg) gg.leftSent = true;
      }, LEFT_DELAY),
      purgeTimer: setTimeout(() => purge(id), GHOST_TTL),
    };
    ghosts.set(id, g);
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
