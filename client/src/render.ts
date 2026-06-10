/**
 * Canvas renderer. Camera is centered on the local player. Draws the map,
 * a faint hearing-radius ring around self, every avatar with a name tag,
 * and a small indicator on peers who are screen-sharing within range.
 */
import { TILE, AVATAR_R, HEARING_RADIUS } from "./config.ts";
import { wallGrid, COLS, ROWS } from "./world.ts";
import type { Players } from "./player.ts";

const FLOOR = "#161a24";
const WALL = "#2b3346";
const GRID_LINE = "#1d2330";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * this.dpr;
    this.canvas.height = window.innerHeight * this.dpr;
  }

  /** `sharingPeers`: ids currently sharing a screen we can see (within range). */
  draw(players: Players, sharingPeers: Set<string>): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const vw = W / this.dpr;
    const vh = H / this.dpr;

    // Camera centered on me, clamped within reason.
    const camX = players.me.x - vw / 2;
    const camY = players.me.y - vh / 2;

    ctx.clearRect(0, 0, vw, vh);
    ctx.save();
    ctx.translate(-camX, -camY);

    // Map tiles.
    const grid = wallGrid();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.fillStyle = grid[r][c] ? WALL : FLOOR;
        ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
      }
    }
    // Subtle grid lines.
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * TILE, 0);
      ctx.lineTo(c * TILE, ROWS * TILE);
      ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * TILE);
      ctx.lineTo(COLS * TILE, r * TILE);
      ctx.stroke();
    }

    // Hearing radius around me.
    ctx.beginPath();
    ctx.arc(players.me.x, players.me.y, HEARING_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(240,136,62,0.05)";
    ctx.fill();
    ctx.strokeStyle = "rgba(240,136,62,0.25)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Peers, then me on top.
    for (const p of players.peers.values()) {
      this.drawAvatar(p.x, p.y, p.color, p.name, sharingPeers.has(p.id), false);
    }
    this.drawAvatar(players.me.x, players.me.y, players.me.color, players.me.name, false, true);

    ctx.restore();
  }

  private drawAvatar(
    x: number, y: number, color: string, name: string,
    sharing: boolean, isMe: boolean,
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, AVATAR_R, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (isMe) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }
    // Screen-share indicator.
    if (sharing) {
      ctx.fillStyle = "#fff";
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("🖥", x, y - AVATAR_R - 14);
    }
    // Name tag.
    ctx.fillStyle = "#e6e8ef";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(name, x, y + AVATAR_R + 3);
  }
}
