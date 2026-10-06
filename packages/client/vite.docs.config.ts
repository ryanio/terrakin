import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import app from "./vite.config.ts";

/**
 * The /docs page (docs.html), built on its own after the app and into the same dist. A separate
 * build, not a second entry, so the app's chunks never share modules with Scalar: a shared chunk
 * would make every visitor download the parts of zod and Vue the docs need. Same plugins (and so
 * the same Content-Security-Policy). `vite dev` serves docs.html at /docs from the app config.
 */
export default mergeConfig(
  app,
  defineConfig({
    publicDir: false,
    build: {
      emptyOutDir: false,
      // Scalar (Vue, the API client, markdown and code highlighting) is about 1 MB gzipped. Only
      // /docs loads it.
      chunkSizeWarningLimit: 2000,
      rolldownOptions: {
        input: { docs: fileURLToPath(new URL("./docs.html", import.meta.url)) },
      },
    },
  }),
);
