/**
 * Net — the room-aware WebSocket client, ported in spirit from html-games
 * WSSNet (localStorage URL, sessionStorage id, rejoin-on-reconnect, 3s
 * auto-reconnect) but evolved from pairing to rooms and extended with a
 * `signal` channel for WebRTC.
 */
import type {
  ClientMessage,
  PeerInfo,
  ServerMessage,
  SignalData,
} from "../../shared/protocol.ts";
import { MOVE_INTERVAL } from "./config.ts";

export interface NetCallbacks {
  onReady(id: string): void;
  onJoined(self: string, peers: PeerInfo[]): void;
  onPeerJoined(peer: PeerInfo): void;
  onPeerLeft(id: string): void;
  onPeerMove(id: string, x: number, y: number): void;
  onSignal(from: string, data: SignalData): void;
}

const URL_KEY = "hearth_url";
const ID_KEY = "hearth_id";

export class Net {
  myId: string | null = null;
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectTimer: number | null = null;
  private room: string | null = null;
  private name = "anon";
  private lastMoveSent = 0;
  private pendingMove: { x: number; y: number } | null = null;

  constructor(private cb: NetCallbacks) {
    this.url = Net.resolveUrl();
  }

  /** Saved URL, else derive ws://<host>:8090 from the page location. */
  static resolveUrl(): string {
    const saved = localStorage.getItem(URL_KEY);
    if (saved) return saved;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.hostname}:8090`;
  }

  static setUrl(raw: string): void {
    const cleaned = raw.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
    const url = /^wss?:\/\//i.test(raw.trim()) ? raw.trim() : `wss://${cleaned}`;
    localStorage.setItem(URL_KEY, url);
  }

  connect(room: string, name: string): void {
    this.room = room;
    this.name = name;
    this.open();
  }

  private open(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      const oldId = sessionStorage.getItem(ID_KEY);
      if (oldId) this.sendRaw({ type: "rejoin", id: oldId });
      // Whether fresh or rejoining, (re)assert room membership once we have an id.
      // The server treats a second join as a move-to-room; harmless on rejoin
      // because rejoin restores the room itself, and join is idempotent enough.
    };

    this.ws.onmessage = (e) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.handle(msg);
    };

    this.ws.onclose = () => {
      this.reconnectTimer = window.setTimeout(() => this.open(), 3000);
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case "id": {
        const isRejoin = sessionStorage.getItem(ID_KEY) === msg.id;
        this.myId = msg.id;
        sessionStorage.setItem(ID_KEY, msg.id);
        this.cb.onReady(msg.id);
        // Fresh connection (not a successful rejoin into a room): join now.
        if (!isRejoin && this.room) {
          this.sendRaw({ type: "join", room: this.room, name: this.name });
        }
        break;
      }
      case "joined":
        this.cb.onJoined(msg.self, msg.peers);
        break;
      case "peer_joined":
        this.cb.onPeerJoined(msg.peer);
        break;
      case "peer_left":
        this.cb.onPeerLeft(msg.id);
        break;
      case "peer_move":
        this.cb.onPeerMove(msg.id, msg.x, msg.y);
        break;
      case "signal":
        this.cb.onSignal(msg.from, msg.data);
        break;
      case "error":
        console.warn("relay error:", msg.message);
        break;
    }
  }

  /** Throttled position broadcast. Call freely; it self-rate-limits. */
  move(x: number, y: number): void {
    this.pendingMove = { x, y };
    const now = performance.now();
    if (now - this.lastMoveSent >= MOVE_INTERVAL) this.flushMove();
  }

  /** Flush any pending move if the interval has elapsed (call each frame). */
  tick(): void {
    if (this.pendingMove && performance.now() - this.lastMoveSent >= MOVE_INTERVAL) {
      this.flushMove();
    }
  }

  private flushMove(): void {
    if (!this.pendingMove) return;
    this.sendRaw({ type: "move", x: this.pendingMove.x, y: this.pendingMove.y });
    this.lastMoveSent = performance.now();
    this.pendingMove = null;
  }

  signal(to: string, data: SignalData): void {
    this.sendRaw({ type: "signal", to, data });
  }

  private sendRaw(data: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}
