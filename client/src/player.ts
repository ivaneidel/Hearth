/**
 * Avatar state for the local player and all remote peers.
 *
 * Local player: x/y are authoritative, driven by input.
 * Remote peers: we store the last position the server told us as a target
 * and lerp the rendered position toward it each frame, so movement looks
 * smooth despite arriving at ~12 Hz.
 */
import { colorForId } from "./config.ts";
import type { PeerInfo } from "../../shared/protocol.ts";

export interface Avatar {
  id: string;
  name: string;
  color: string;
  /** Rendered (interpolated) position. */
  x: number;
  y: number;
  /** For remotes: the latest position from the server, lerped toward. */
  tx: number;
  ty: number;
}

export class Players {
  /** The local player. */
  me: Avatar;
  /** Remote peers by id. */
  peers = new Map<string, Avatar>();

  constructor(id: string, name: string, x: number, y: number) {
    this.me = { id, name, color: colorForId(id), x, y, tx: x, ty: y };
  }

  upsertPeer(info: PeerInfo): Avatar {
    let p = this.peers.get(info.id);
    if (!p) {
      p = {
        id: info.id,
        name: info.name,
        color: colorForId(info.id),
        x: info.x,
        y: info.y,
        tx: info.x,
        ty: info.y,
      };
      this.peers.set(info.id, p);
    } else {
      p.name = info.name;
      p.tx = info.x;
      p.ty = info.y;
    }
    return p;
  }

  setPeerTarget(id: string, x: number, y: number): void {
    const p = this.peers.get(id);
    if (p) { p.tx = x; p.ty = y; }
  }

  removePeer(id: string): void {
    this.peers.delete(id);
  }

  /** Smoothly advance remote avatars toward their targets. */
  interpolate(dt: number): void {
    // Exponential smoothing; ~snappy but smooth at typical update rates.
    const k = 1 - Math.exp(-dt * 12);
    for (const p of this.peers.values()) {
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
    }
  }

  /** Distance from the local player to a peer, in pixels. */
  distanceTo(p: Avatar): number {
    return Math.hypot(p.x - this.me.x, p.y - this.me.y);
  }
}
