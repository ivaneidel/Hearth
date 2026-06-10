/**
 * WebRTC mesh. One RTCPeerConnection per peer. Our microphone track is
 * published to everyone the moment a connection exists (proximity controls
 * *volume*, not connection, so audio is instant when you walk up). The
 * screen-share video track is added/removed *per peer* based on distance —
 * proximity-gated sharing.
 *
 * Glare (both sides offering at once) is handled by the standard "perfect
 * negotiation" pattern; the peer with the higher id is "polite" and yields.
 */
import { ICE_SERVERS, SHARE_RADIUS, SHARE_DROP_RADIUS } from "./config.ts";
import type { Net } from "./net.ts";
import type { SignalData } from "../../shared/protocol.ts";

interface PeerConn {
  id: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  micSender: RTCRtpSender | null;
  screenSender: RTCRtpSender | null;
}

export interface RtcCallbacks {
  /** A peer's audio stream arrived — wire it into AudioPlayer. */
  onRemoteAudio(peerId: string, stream: MediaStream): void;
  /** A peer's screen stream arrived (or null when it ends). */
  onRemoteScreen(peerId: string, stream: MediaStream | null): void;
}

export class Mesh {
  private peers = new Map<string, PeerConn>();
  private micStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private myId = "";

  constructor(private net: Net, private cb: RtcCallbacks) {}

  setMyId(id: string): void {
    this.myId = id;
  }

  /** Acquire the microphone once, up front. Safe to call repeatedly. */
  async startMic(): Promise<void> {
    if (this.micStream) return;
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Add to any peers that connected before the mic was ready.
    for (const p of this.peers.values()) this.addMic(p);
  }

  get isSharing(): boolean {
    return !!this.screenStream;
  }

  /** Enable/disable our outgoing mic (mute = others can't hear us). */
  setMicEnabled(enabled: boolean): void {
    this.micStream?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }

  /** Create (or fetch) the connection to a peer and start negotiating. */
  ensurePeer(peerId: string): PeerConn {
    let p = this.peers.get(peerId);
    if (p) return p;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    p = {
      id: peerId,
      pc,
      polite: this.myId > peerId, // higher id yields on glare
      makingOffer: false,
      ignoreOffer: false,
      micSender: null,
      screenSender: null,
    };
    this.peers.set(peerId, p);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.net.signal(peerId, { kind: "ice", candidate: e.candidate.toJSON() });
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        p!.makingOffer = true;
        await pc.setLocalDescription();
        this.net.signal(peerId, { kind: "offer", sdp: pc.localDescription!.sdp });
      } catch (err) {
        console.warn("negotiation error", err);
      } finally {
        p!.makingOffer = false;
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (e.track.kind === "audio") {
        this.cb.onRemoteAudio(peerId, stream);
      } else {
        // A screen-share video track. `removeTrack` on the sender (stop, or
        // walking out of range) fires `mute` on the receiver — NOT `ended` —
        // so we must hide on mute and re-show on unmute, else the tile sticks.
        const track = e.track;
        const show = () => this.cb.onRemoteScreen(peerId, stream);
        const hide = () => this.cb.onRemoteScreen(peerId, null);
        show();
        track.addEventListener("mute", hide);
        track.addEventListener("unmute", show);
        track.addEventListener("ended", hide);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") pc.restartIce();
    };

    this.addMic(p);
    return p;
  }

  private addMic(p: PeerConn): void {
    if (this.micStream && !p.micSender) {
      const track = this.micStream.getAudioTracks()[0];
      if (track) p.micSender = p.pc.addTrack(track, this.micStream);
    }
  }

  removePeer(peerId: string): void {
    const p = this.peers.get(peerId);
    if (!p) return;
    p.pc.close();
    this.peers.delete(peerId);
    this.cb.onRemoteScreen(peerId, null);
  }

  /** Handle an incoming signaling payload (perfect negotiation). */
  async onSignal(from: string, data: SignalData): Promise<void> {
    const p = this.ensurePeer(from);
    const pc = p.pc;
    try {
      if (data.kind === "offer" || data.kind === "answer") {
        const offerCollision =
          data.kind === "offer" &&
          (p.makingOffer || pc.signalingState !== "stable");
        p.ignoreOffer = !p.polite && offerCollision;
        if (p.ignoreOffer) return;

        await pc.setRemoteDescription({ type: data.kind, sdp: data.sdp });
        if (data.kind === "offer") {
          await pc.setLocalDescription();
          this.net.signal(from, { kind: "answer", sdp: pc.localDescription!.sdp });
        }
      } else {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          if (!p.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.warn("signal handling error", err);
    }
  }

  // ── Screen share ──────────────────────────────────────────────────────────

  async startScreenShare(): Promise<MediaStream> {
    if (this.screenStream) return this.screenStream;
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    // When the user clicks the browser's native "Stop sharing".
    this.screenStream.getVideoTracks()[0].addEventListener("ended", () => this.stopScreenShare());
    return this.screenStream;
  }

  stopScreenShare(): void {
    if (!this.screenStream) return;
    for (const t of this.screenStream.getTracks()) t.stop();
    this.screenStream = null;
    // Drop the sender from every peer (triggers renegotiation).
    for (const p of this.peers.values()) this.setScreenSentTo(p, false);
  }

  /**
   * Reconcile which peers should currently receive our screen, given the
   * current distance to each peer. Uses hysteresis (start at SHARE_RADIUS,
   * keep until SHARE_DROP_RADIUS) so edge-walking doesn't flap renegotiation.
   * Adds/removes the video sender per peer only on actual change.
   */
  updateShareTargets(distances: Map<string, number>): void {
    if (!this.screenStream) return;
    for (const p of this.peers.values()) {
      const d = distances.get(p.id);
      if (d === undefined) continue;
      const sending = !!p.screenSender;
      const shouldSend = sending ? d <= SHARE_DROP_RADIUS : d <= SHARE_RADIUS;
      this.setScreenSentTo(p, shouldSend);
    }
  }

  private setScreenSentTo(p: PeerConn, shouldSend: boolean): void {
    const track = this.screenStream?.getVideoTracks()[0] ?? null;
    if (shouldSend && this.screenStream && track && !p.screenSender) {
      p.screenSender = p.pc.addTrack(track, this.screenStream);
    } else if (!shouldSend && p.screenSender) {
      try { p.pc.removeTrack(p.screenSender); } catch { /* closed */ }
      p.screenSender = null;
    }
  }
}
