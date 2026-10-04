import { defineConfig, devices } from "@playwright/test";

const PORT = 8790;
/** The fake X oEmbed endpoint that e2e/connect-x.spec.ts runs. Test servers only (decision 0022). */
const FAKE_X = "http://127.0.0.1:8791/oembed";

/** Phone-first smoke test of the real build: client served by the real server. */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "phone", use: { ...devices["iPhone 13"], browserName: "chromium" } }],
  webServer: {
    // Every browser here shares one IP, so allow more joins a minute than the real server does.
    // The test clock lets town.spec.ts move days on.
    command: `pnpm build && PORT=${PORT} TERRAKIN_SESSIONS_PER_MINUTE=60 TERRAKIN_STATIC_DIR=client/dist TERRAKIN_TEST_X_OEMBED=${FAKE_X} TERRAKIN_TEST_CLOCK=1 pnpm --filter @terrakin/server start`,
    url: `http://localhost:${PORT}/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
