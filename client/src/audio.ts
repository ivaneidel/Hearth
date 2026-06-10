/**
 * Per-peer audio playback with distance-based volume.
 *
 * Each remote peer's audio stream is attached to a hidden <audio> element.
 * We drive volume directly via HTMLMediaElement.volume — simple, and it
 * avoids the long-standing Chrome bug where remote WebRTC streams routed
 * through WebAudio produce silence. Distance→volume gives the Gather fade.
 */
import { HEARING_RADIUS, FULL_VOLUME_RADIUS, MAX_VOLUME } from "./config.ts";

/** Smoothstep falloff: 1 inside FULL_VOLUME_RADIUS, 0 beyond HEARING_RADIUS. */
export function volumeForDistance(dist: number): number {
  if (dist <= FULL_VOLUME_RADIUS) return 1;
  if (dist >= HEARING_RADIUS) return 0;
  const t = (dist - FULL_VOLUME_RADIUS) / (HEARING_RADIUS - FULL_VOLUME_RADIUS);
  const s = 1 - t; // invert: closer = louder
  return s * s * (3 - 2 * s); // smoothstep
}

export class AudioPlayer {
  private els = new Map<string, HTMLAudioElement>();
  private muted = false;

  attach(peerId: string, stream: MediaStream): void {
    let el = this.els.get(peerId);
    if (!el) {
      el = document.createElement("audio");
      el.autoplay = true;
      // Not muted (that would silence playback); volume drives proximity.
      el.style.display = "none";
      document.body.appendChild(el);
      this.els.set(peerId, el);
    }
    el.srcObject = stream;
    // Autoplay may be blocked until a user gesture; play() best-effort.
    el.play().catch(() => {});
  }

  setVolume(peerId: string, v: number): void {
    const el = this.els.get(peerId);
    if (el) el.volume = this.muted ? 0 : Math.max(0, Math.min(1, v)) * MAX_VOLUME;
  }

  /** Mute all remote audio (does not affect our outgoing mic). */
  setMuted(m: boolean): void {
    this.muted = m;
    if (m) for (const el of this.els.values()) el.volume = 0;
  }

  remove(peerId: string): void {
    const el = this.els.get(peerId);
    if (el) {
      el.srcObject = null;
      el.remove();
      this.els.delete(peerId);
    }
  }
}
