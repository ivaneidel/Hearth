# 🔥 Hearth

A minimal, self-hosted [Gather Town](https://gather.town)-style spatial space for
small teams. Walk an avatar around a 2D office; **you hear teammates louder as you
get closer** and they fade to silence as you walk away. Screen sharing is
**proximity-gated** — only people near you can see your screen.

Audio + screen share only (no webcam video), built for teams of **≤ 8**.

## Stack

- **client/** — Vite + TypeScript + Canvas. The world, movement, rendering, and
  all WebRTC media logic run here.
- **server/** — Node + `ws`, a dumb stateless **relay** (room membership +
  position broadcast + WebRTC signaling passthrough). No build step — runs on
  Node's native TypeScript.
- **shared/protocol.ts** — the wire protocol, imported by both so they can't drift.

Media (mic audio + screen share) flows **peer-to-peer over a WebRTC mesh**; the
server only relays signaling. See [docs/architecture.md](docs/architecture.md).

## Quick start

```bash
npm install        # installs both workspaces
npm run dev        # relay on :8090, client on http://localhost:5173
```

Open `http://localhost:5173` in two tabs (use headphones to avoid feedback),
enter a name in each, and walk them together — volume rises as they approach.

> ⚠️ Mic + screen share need a **secure context**. `localhost` counts as secure,
> so local dev works. For teammates on other machines you must serve over
> **HTTPS/WSS** (e.g. the cloudflared tunnel below) — `getUserMedia` is blocked
> on plain `http://` to a remote host.

## Letting remote teammates in

The relay can expose a public URL via cloudflared (like the html-games ws-bridge):

```bash
npm -w server run tunnel    # prints https://<random>.trycloudflare.com
```

You'll also need to host the **client** over HTTPS (any static host — Vite
`npm run build` → `client/dist/`), and teammates paste the relay URL under the
join screen's **Advanced → server** field.

### TURN (for strict NATs)

A public STUN server is configured by default, which is enough for most networks.
Teammates behind strict/symmetric NATs need a **TURN** relay — fill in
`ICE_SERVERS` in `client/src/config.ts` with credentials from a provider
(Cloudflare Calls, metered.ca, or self-hosted coturn). This is the one piece
left as a config slot; pick a provider when a remote connection fails to form.

## Controls

- **WASD / arrow keys** — move
- **🎤 Mute** — mute your mic (others stop hearing you)
- **🖥 Share** — share your screen to nearby teammates

## Tunables

All in `client/src/config.ts`: `HEARING_RADIUS`, `FULL_VOLUME_RADIUS`,
`SHARE_RADIUS`, `SPEED`, `DEFAULT_ROOM`, and the map lives in `client/src/world.ts`.
