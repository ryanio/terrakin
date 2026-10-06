import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/sim",
      "packages/protocol",
      "packages/cards",
      "packages/server",
      "packages/client",
      "packages/admin",
      "scripts",
    ],
  },
});
