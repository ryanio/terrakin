import { defineConfig, devices } from "@playwright/test";
import {
  CLOCK_SPECS,
  clockPort,
  FAKE_CHAIN_PORT,
  FAKE_X_PORT,
  E2E_PORT as PORT,
} from "./e2e/ports";

/** The fake X oEmbed endpoint that e2e/connect-x.spec.ts runs. Test servers only (decision 0022). */
const FAKE_X = `http://127.0.0.1:${FAKE_X_PORT}/oembed`;
/** The fake network and card host that e2e/partners.spec.ts runs (RFC 0007). Test servers only. */
const FAKE_CHAIN = `http://127.0.0.1:${FAKE_CHAIN_PORT}`;

/**
 * Test-only server settings. Every browser here shares one IP, so allow more joins a minute than
 * the real server does. The test clock lets specs move days on.
 */
const SERVER_ENV = {
  TERRAKIN_SESSIONS_PER_MINUTE: "60",
  TERRAKIN_STATIC_DIR: "client/dist",
  TERRAKIN_TEST_X_OEMBED: FAKE_X,
  TERRAKIN_TEST_CHAIN: FAKE_CHAIN,
  TERRAKIN_TEST_CLOCK: "1",
};

const phone = { ...devices["iPhone 13"], browserName: "chromium" as const };

/** The 3D specs, which run after the rest, one at a time (see `projects`). */
const THREE_D = ["three-d", "world-3d"] as const;

const specFile = (names: readonly string[]) => new RegExp(`/(${names.join("|")})\\.spec\\.ts$`);

/**
 * `TERRAKIN_E2E_ONLY=2d` runs everything but the 3D specs, and `3d` only those, which is how CI
 * splits the suite into parallel jobs. Unset runs it all.
 */
const only = process.env.TERRAKIN_E2E_ONLY;

const flat = [
  {
    name: "phone",
    testIgnore: specFile([...CLOCK_SPECS, ...THREE_D]),
    use: phone,
  },
  // Specs that move the clock a day on each have a server of their own (e2e/ports.ts), so they
  // run beside everything else without expiring what other specs hold.
  ...CLOCK_SPECS.map((spec) => ({
    name: spec,
    testMatch: specFile([spec]),
    use: { ...phone, baseURL: `http://localhost:${clockPort(spec)}` },
  })),
];

// The 3D specs draw every frame in software WebGL (SwiftShader), which takes a small CI runner's
// whole CPU. Beside other specs, or each other, their taps queue past the timeout, so they run
// after the rest, one at a time.
const threeD = [
  {
    name: "three-d",
    testMatch: specFile(["three-d"]),
    dependencies: only === "3d" ? [] : flat.map((p) => p.name),
    use: phone,
  },
  { name: "world-3d", testMatch: specFile(["world-3d"]), dependencies: ["three-d"], use: phone },
];

const mainServer = {
  command: "pnpm build && pnpm --filter @terrakin/server start",
  env: { ...SERVER_ENV, PORT: String(PORT) },
  url: `http://localhost:${PORT}/v1/health`,
  reuseExistingServer: false,
  timeout: 120_000,
};

const clockServers = {
  command: `node e2e/servers.ts ${CLOCK_SPECS.map(clockPort).join(" ")}`,
  env: SERVER_ENV,
  url: `http://localhost:${Math.max(...CLOCK_SPECS.map(clockPort))}/v1/health`,
  reuseExistingServer: false,
  timeout: 120_000,
};

/** Phone-first tests of the real build: the client served by the real server. */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: only === "2d" ? flat : only === "3d" ? threeD : [...flat, ...threeD],
  webServer: only === "3d" ? [mainServer] : [mainServer, clockServers],
});
