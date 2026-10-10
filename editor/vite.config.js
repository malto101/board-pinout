import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: ".",
  publicDir: "public",
  server: {
    port: 5173,
    fs: {
      allow: [path.resolve("..")],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
