/**
 * Bootstrap + game loop. Wires net → players → render, and net → mesh →
 * audio/overlay. The frame loop drives local movement, remote interpolation,
 * and the proximity logic (volume per peer + which peers receive our screen).
 */
import { DEFAULT_ROOM, SPEED, SHARE_RADIUS } from "./config.ts";
import { Net } from "./net.ts";
import { Players } from "./player.ts";
import { Renderer } from "./render.ts";
import { Mesh } from "./rtc.ts";
import { AudioPlayer, volumeForDistance } from "./audio.ts";
import { collides, spawnPoint } from "./world.ts";
import { mountJoin, mountToolbar, ScreenOverlay } from "./ui.ts";

const canvas = document.getElementById("stage") as HTMLCanvasElement;

mountJoin((name) => boot(name));

function boot(name: string): void {
  const renderer = new Renderer(canvas);
  const audio = new AudioPlayer();
  const overlay = new ScreenOverlay();

  let players: Players | null = null;
  let muted = false;
  /** Peers from whom we are currently receiving a screen (for the avatar icon). */
  const incomingShares = new Set<string>();

  // Forward declare so callbacks can reference it; assigned just below.
  let mesh!: Mesh;

  const net = new Net({
    onReady(id) {
      mesh.setMyId(id);
      if (!players) {
        const s = spawnPoint(id);
        players = new Players(id, name, s.x, s.y);
      } else {
        players.me.id = id;
      }
      // Mic acquisition — the join click satisfies the autoplay/gesture gate.
      mesh.startMic().catch((e) => console.warn("mic denied", e));
    },
    onJoined(_self, peers) {
      if (!players) return;
      for (const info of peers) {
        players.upsertPeer(info);
        mesh.ensurePeer(info.id);
      }
    },
    onPeerJoined(peer) {
      players?.upsertPeer(peer);
      mesh.ensurePeer(peer.id);
    },
    onPeerLeft(id) {
      players?.removePeer(id);
      mesh.removePeer(id);
      audio.remove(id);
      overlay.clear(id);
      incomingShares.delete(id);
    },
    onPeerMove(id, x, y) {
      players?.setPeerTarget(id, x, y);
    },
    onSignal(from, data) {
      mesh.onSignal(from, data);
    },
  });

  mesh = new Mesh(net, {
    onRemoteAudio(peerId, stream) {
      audio.attach(peerId, stream);
    },
    onRemoteScreen(peerId, stream) {
      const name = players?.peers.get(peerId)?.name ?? "peer";
      if (stream) {
        overlay.set(peerId, stream, name);
        incomingShares.add(peerId);
      } else {
        overlay.clear(peerId);
        incomingShares.delete(peerId);
      }
    },
  });

  const toolbar = mountToolbar({
    onToggleMute() {
      muted = !muted;
      mesh.setMicEnabled(!muted);
      toolbar.setMuted(muted);
    },
    async onToggleShare() {
      if (mesh.isSharing) {
        mesh.stopScreenShare();
        toolbar.setSharing(false);
      } else {
        try {
          await mesh.startScreenShare();
          toolbar.setSharing(true);
        } catch {
          /* user cancelled the picker */
        }
      }
    },
  });

  net.connect(DEFAULT_ROOM, name);

  // ── Input ──────────────────────────────────────────────────────────────
  const keys = new Set<string>();
  const down = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      keys.add(k);
      e.preventDefault();
    }
  };
  const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);

  // ── Loop ───────────────────────────────────────────────────────────────
  let last = performance.now();
  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (players) {
      const me = players.me;
      let dx = 0;
      let dy = 0;
      if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
      if (keys.has("d") || keys.has("arrowright")) dx += 1;
      if (keys.has("w") || keys.has("arrowup")) dy -= 1;
      if (keys.has("s") || keys.has("arrowdown")) dy += 1;

      if (dx || dy) {
        const len = Math.hypot(dx, dy) || 1;
        const step = (SPEED * dt) / len;
        const nx = me.x + dx * step;
        const ny = me.y + dy * step;
        if (!collides(nx, me.y)) me.x = nx;
        if (!collides(me.x, ny)) me.y = ny;
        net.move(me.x, me.y);
      }

      players.interpolate(dt);

      // Proximity: per-peer volume + which peers get our screen.
      const inRange = new Set<string>();
      for (const p of players.peers.values()) {
        const d = players.distanceTo(p);
        audio.setVolume(p.id, volumeForDistance(d));
        if (d <= SHARE_RADIUS) inRange.add(p.id);
      }
      mesh.updateShareTargets(inRange);

      net.tick();
      renderer.draw(players, incomingShares);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
