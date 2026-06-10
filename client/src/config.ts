/** Tunables for the whole client, in one place. */

/** Default room everyone lands in, so teammates need no code to meet. */
export const DEFAULT_ROOM = "OFFICE";

/** Pixel size of one map tile. */
export const TILE = 36;

/** Local avatar speed, pixels per second. */
export const SPEED = 200;

/** How often we broadcast our position, in ms (~12 Hz). */
export const MOVE_INTERVAL = 80;

/** Audio fades to silence at this distance (pixels). The core "Gather feel". */
export const HEARING_RADIUS = 3.5 * TILE;

/** Volume is full within this distance, then fades to 0 by HEARING_RADIUS. */
export const FULL_VOLUME_RADIUS = 1 * TILE;

/** Ceiling on remote volume — keeps "right next to you" from being too loud. */
export const MAX_VOLUME = 0.7;

/** A peer's screen share starts being sent/shown within this distance (pixels). */
export const SHARE_RADIUS = 2.5 * TILE;

/**
 * Hysteresis: once sharing to a peer, keep sending until they pass this larger
 * distance. Prevents renegotiation flapping when walking along the boundary.
 */
export const SHARE_DROP_RADIUS = SHARE_RADIUS * 1.3;

/** Avatar radius in pixels. */
export const AVATAR_R = 13;

/**
 * ICE servers for WebRTC. Public STUN handles most cases; a TURN relay is
 * required for teammates behind strict/symmetric NATs (some remote users).
 * Fill TURN in from your provider (Cloudflare Calls / metered.ca / coturn)
 * once chosen — see plan "Open items".
 */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  // {
  //   urls: "turn:YOUR_TURN_HOST:3478",
  //   username: "YOUR_USER",
  //   credential: "YOUR_SECRET",
  // },
];

/** Distinct avatar colors, picked by hashing the client id. */
export const AVATAR_COLORS = [
  "#f0883e", "#56d364", "#58a6ff", "#db61a2",
  "#e3b341", "#a371f7", "#39c5cf", "#ff7b72",
];

export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
