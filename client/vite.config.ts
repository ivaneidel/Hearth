import { defineConfig } from "vite";

// Allow importing ../shared/*.ts from the client.
export default defineConfig({
  server: { host: true, port: 5173 },
  // fs.allow lets Vite serve files from the sibling shared/ dir.
  // (Vite already allows the workspace root, but be explicit.)
  base: process.env.VITE_BASE || "/",
});
