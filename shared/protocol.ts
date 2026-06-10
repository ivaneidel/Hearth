/**
 * Hearth wire protocol — single source of truth for every message that
 * crosses the WebSocket, imported by both `server/` and `client/` so the
 * two can never drift.
 *
 * The relay is deliberately dumb: it assigns IDs, tracks room membership,
 * fire-and-forget broadcasts movement, and relays WebRTC signaling between
 * peers. It holds NO application state (no positions, no media).
 *
 * Lineage: evolved from html-games `ws-bridge` — the pairs model became a
 * rooms model, and a `signal` passthrough was added for WebRTC.
 */

/** A 4-digit client id, e.g. "4821". */
export type ClientId = string;

/** A room/space code, e.g. "OFFICE". Teammates sharing a code share a space. */
export type RoomId = string;

/** Opaque WebRTC signaling payload (SDP offer/answer or ICE candidate). */
export type SignalData =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

// ─── Client → Server ────────────────────────────────────────────────────────

/**
 * Resume a previous session id after a reload/drop (ghost grace). Carries
 * room+name so a rejoin that can't be restored degrades cleanly into a fresh
 * join — the server never hands out a leaked temp id.
 */
export interface RejoinMsg {
  type: "rejoin";
  id: ClientId;
  room: RoomId;
  name: string;
}

/** Enter a room. Server replies `joined` and tells existing peers `peer_joined`. */
export interface JoinMsg {
  type: "join";
  room: RoomId;
  name: string;
}

/** Send a chat message to the room. Visibility is proximity-filtered client-side. */
export interface ChatMsg {
  type: "chat";
  text: string;
}

/** Broadcast my new position to everyone else in the room. Fire-and-forget. */
export interface MoveMsg {
  type: "move";
  x: number;
  y: number;
}

/** Relay a WebRTC signaling payload to exactly one peer. */
export interface SignalMsg {
  type: "signal";
  to: ClientId;
  data: SignalData;
}

export type ClientMessage = RejoinMsg | JoinMsg | MoveMsg | SignalMsg | ChatMsg;

// ─── Server → Client ──────────────────────────────────────────────────────��─

/** Session id assigned (on connect) or restored (on rejoin). */
export interface IdMsg {
  type: "id";
  id: ClientId;
}

/** Snapshot of who is already in the room you just joined. */
export interface JoinedMsg {
  type: "joined";
  room: RoomId;
  self: ClientId;
  peers: PeerInfo[];
}

/** Someone new entered the room. */
export interface PeerJoinedMsg {
  type: "peer_joined";
  peer: PeerInfo;
}

/** Someone left the room (disconnect past ghost grace, or explicit leave). */
export interface PeerLeftMsg {
  type: "peer_left";
  id: ClientId;
}

/** A peer's position update. */
export interface PeerMoveMsg {
  type: "peer_move";
  id: ClientId;
  x: number;
  y: number;
}

/** A WebRTC signaling payload relayed from another peer. */
export interface SignalRelayMsg {
  type: "signal";
  from: ClientId;
  data: SignalData;
}

/** A chat message relayed from a room peer. Receiver decides if it's in range. */
export interface PeerChatMsg {
  type: "peer_chat";
  from: ClientId;
  name: string;
  text: string;
}

/** Recoverable error (e.g. malformed message). */
export interface ErrorMsg {
  type: "error";
  message: string;
}

export type ServerMessage =
  | IdMsg
  | JoinedMsg
  | PeerJoinedMsg
  | PeerLeftMsg
  | PeerMoveMsg
  | SignalRelayMsg
  | PeerChatMsg
  | ErrorMsg;

/** Public info about a peer, shared on join. */
export interface PeerInfo {
  id: ClientId;
  name: string;
  x: number;
  y: number;
}
