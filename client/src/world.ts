/**
 * The hardcoded office map. Defined as ASCII rows for legibility:
 *   '#' = wall (blocks movement), ' ' = floor.
 * Collision is a simple tile lookup. Coordinates everywhere else in the
 * client are in pixels; convert with TILE.
 */
import { TILE, AVATAR_R } from "./config.ts";

// 24 wide x 16 tall. A central open floor with two small side rooms.
const MAP_ROWS = [
  "########################",
  "#          ##          #",
  "#          ##          #",
  "#                      #",
  "#   ####        ####   #",
  "#   #              #   #",
  "#   #              #   #",
  "#                      #",
  "#                      #",
  "#   #              #   #",
  "#   #              #   #",
  "#   ####        ####   #",
  "#                      #",
  "#          ##          #",
  "#          ##          #",
  "########################",
];

export const COLS = MAP_ROWS[0].length;
export const ROWS = MAP_ROWS.length;
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;

/** grid[row][col] — true if solid. */
const grid: boolean[][] = MAP_ROWS.map((row) =>
  [...row].map((ch) => ch === "#"),
);

/** Is the tile at (col,row) a wall (or out of bounds)? */
function isWallTile(col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return true;
  return grid[row][col];
}

/** Would an avatar centered at pixel (x,y) overlap a wall? */
export function collides(x: number, y: number): boolean {
  // Sample the four points of the avatar's bounding box.
  const r = AVATAR_R;
  const pts = [
    [x - r, y - r], [x + r, y - r],
    [x - r, y + r], [x + r, y + r],
  ];
  for (const [px, py] of pts) {
    if (isWallTile(Math.floor(px / TILE), Math.floor(py / TILE))) return true;
  }
  return false;
}

/** A walkable spawn point near the center, jittered by id so peers don't stack. */
export function spawnPoint(id: string): { x: number; y: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const cx = WORLD_W / 2;
  const cy = WORLD_H / 2;
  const angle = (Math.abs(h) % 360) * (Math.PI / 180);
  const dist = TILE * (1 + (Math.abs(h >> 3) % 3));
  let x = cx + Math.cos(angle) * dist;
  let y = cy + Math.sin(angle) * dist;
  if (collides(x, y)) { x = cx; y = cy; }
  return { x, y };
}

/** Expose grid for the renderer. */
export function wallGrid(): readonly (readonly boolean[])[] {
  return grid;
}
