import { defineConfig } from "vite";

const server = process.env.TERRAKIN_SERVER ?? "http://localhost:8787";

export default defineConfig({
  build: {
    // three.js lives in its own chunk (model-viewer), loaded only when someone opens a 3D model.
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": { target: server, ws: true },
      "/media": { target: server },
    },
  },
});
