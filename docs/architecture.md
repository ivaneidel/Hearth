# Architecture

Hearth has three layers, deliberately separated so the wire format is single-sourced
and the media path never touches the server.

```
 ┌────────────┐   WebSocket    ┌──────────────┐   WebSocket    ┌────────────┐
 │  client A  │◄──────────────►│ relay server │◄──────────────►│  client B  │
 │ (Vite/TS)  │   join/move    │  (ws, dumb)  │   join/move    │ (Vite/TS)  │
 │            │   + signaling  └──────────────┘   + signaling  │            │
 │            │                                                 │            │
 │            │◄═══════════════ WebRTC mesh (P2P) ═════════════►│            │
 └────────────┘     mic audio + screen share, never via server └────────────┘
```

## 1. The relay (`server/src/index.ts`)

Evolved from the html-games `ws-bridge`. It is **stateless** about the app — it
never stores positions or media. Responsibilities:

- **Identity** — assigns each socket a 4-digit id on connect; supports `rejoin`
  to reclaim an id within a 60s ghost grace (survives reloads/brief drops).
- **Rooms** — `rooms: Map<RoomId, Set<ClientId>>`. `join` adds you and returns a
  snapshot of who's already present (`joined`), and tells the others
  (`peer_joined`). Disconnect/leave broadcasts `peer_left`.
- **Movement** — `move {x,y}` is fire-and-forget broadcast to the room as
  `peer_move`. No persistence, no ack; positions are ephemeral.
- **Signaling** — `signal {to, data}` is relayed verbatim to one peer as
  `signal {from, data}`. This carries WebRTC SDP offers/answers and ICE
  candidates. The server never inspects it.

### Why pairs → rooms
The original ws-bridge paired exactly two clients. Hearth needs everyone in a
space to see everyone, so the `pairs` map became a `rooms` map and broadcasts
target room members instead of a single partner. The ghost/rejoin resilience
carried over unchanged in spirit.

## 2. Networking client (`client/src/net.ts`)

A `WSSNet`-style class: `localStorage` holds the server URL, `sessionStorage`
holds our id (so a reload rejoins the same identity), 3s auto-reconnect, and a
throttled `move()` (~12 Hz). Surfaces everything to the app via callbacks
(`onJoined`, `onPeerJoined/Left/Move`, `onSignal`).

## 3. World, render, players

- **world.ts** — the hardcoded ASCII map → wall grid; pixel-space collision via
  a 4-corner tile lookup; id-hashed spawn points.
- **player.ts** — local avatar (input-authoritative) + remote avatars, which
  store the last server position as a target and **lerp** toward it each frame
  for smoothness despite the 12 Hz update rate.
- **render.ts** — camera centered on the local player; draws map, the hearing
  radius ring, avatars, name tags, and a 🖥 marker on in-range sharers.

## 4. Media — the WebRTC mesh (`rtc.ts`, `audio.ts`)

- One `RTCPeerConnection` **per peer** (full mesh). Fine for ≤ 8: audio is tiny,
  and screen share only fans out to nearby peers.
- The **mic** track is published to every peer as soon as the connection exists.
  Proximity controls **volume**, not connection, so audio is instant when someone
  walks up. Volume is set per-peer each frame from distance
  (`volumeForDistance`, a smoothstep falloff) on a hidden `<audio>` element —
  chosen over WebAudio routing to dodge a Chrome remote-stream-silence bug.
- **Screen share** uses `getDisplayMedia`. Its video track is added/removed
  **per peer** based on `SHARE_RADIUS` (`updateShareTargets` each frame), so only
  nearby teammates receive and see it. Add/remove triggers renegotiation only on
  actual range changes.
- **Glare** (both peers offering at once) is handled by the standard *perfect
  negotiation* pattern; the higher-id peer is "polite" and yields — mirroring the
  "lower id initiates" tiebreak from the html-games sync doc.

## Message flow: two people meet

1. A joins `OFFICE` → relay returns `joined {peers:[]}`. B joins → A gets
   `peer_joined{B}`, B gets `joined{peers:[A]}`.
2. Both call `ensurePeer` → each creates a PC, adds its mic track →
   `negotiationneeded` fires → offer/answer/ICE flow through `signal` relay.
3. Mic audio now flows P2P. Each frame, A and B set each other's `<audio>.volume`
   from distance. Walk together → loud; apart → silent.
4. A clicks Share → A's screen track is added only to peers within `SHARE_RADIUS`;
   they get `ontrack` video → overlay appears. Walk out of range → track removed.
