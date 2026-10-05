import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["sim", "protocol", "cards", "server", "client", "admin", "scripts"],
  },
});
