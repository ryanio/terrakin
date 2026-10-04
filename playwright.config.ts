import { defineConfig, devices } from "@playwright/test";

const PORT = 8790;

/** Phone-first smoke test of the real build: client served by the real server. */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "phone", use: { ...devices["iPhone 13"], browserName: "chromium" } }],
  webServer: {
    command: `pnpm build && PORT=${PORT} TERRAKIN_STATIC_DIR=client/dist pnpm --filter @terrakin/server start`,
    url: `http://localhost:${PORT}/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
