import { resolve } from "node:path";
import { findProposal, votesCast } from "@terrakin/sim";
import { createApp } from "./app";
import { FileMediaStore } from "./file-media-store";
import { MemoryMediaStore } from "./media";
import { Moderation } from "./moderation";
import { nodeSql } from "./node-sql";
import { parseMaintainers, parseTownsfolk, SocialService } from "./social-service";
import { JsonlStore, MemoryStore } from "./store";
import { DAY_MS, WorldService } from "./world-service";
import { oembedReader } from "./x-link";

// Resolve relative paths from where the user ran the command. `pnpm --filter` runs this file
// from server/, but pnpm records the original directory in INIT_CWD.
const fromCwd = (path: string) => resolve(process.env.INIT_CWD ?? process.cwd(), path);

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.TERRAKIN_DATA_DIR;
const staticDir = process.env.TERRAKIN_STATIC_DIR;
const trustedProxies = Number(process.env.TERRAKIN_TRUSTED_PROXIES ?? 0);
if (!Number.isInteger(trustedProxies) || trustedProxies < 0) {
  // A bad value would silently let clients pick their own IP. Refuse to start instead.
  console.error(
    `TERRAKIN_TRUSTED_PROXIES must be a whole number >= 0, got "${process.env.TERRAKIN_TRUSTED_PROXIES}"`,
  );
  process.exit(1);
}

// New sessions per minute per IP. Only the e2e suite raises it, since all its browsers share one IP.
const sessionsPerMinute = Number(process.env.TERRAKIN_SESSIONS_PER_MINUTE ?? 0) || undefined;
// Tests only: a clock that `POST /v1/test/advance-day` moves forward a day at a time, so the e2e
// suite can watch a proposal open, pass, and build. Never in production.
const testClock = process.env.TERRAKIN_TEST_CLOCK === "1";
if (testClock && process.env.NODE_ENV === "production") {
  console.error("TERRAKIN_TEST_CLOCK is for tests and can't be set when NODE_ENV=production.");
  process.exit(1);
}
let offset = 0;
const now = testClock ? () => Date.now() + offset : Date.now;
const townsfolk = parseTownsfolk(process.env.TERRAKIN_TOWNSFOLK);
const maintainers = parseMaintainers(process.env.TERRAKIN_MAINTAINERS);
// One set of edge filters for the world and the social layer, so refusals add up everywhere.
const moderation = new Moderation({
  now,
  privileged: (id) => townsfolk.has(id) || maintainers.has(id),
});

const store = dataDir ? new JsonlStore(fromCwd(dataDir)) : new MemoryStore();
const service = new WorldService({ store, now, days: true, townsfolk, moderation });
const media = dataDir ? new FileMediaStore(fromCwd(`${dataDir}/media`)) : new MemoryMediaStore();
const social = new SocialService({
  sql: nodeSql(dataDir ? fromCwd(`${dataDir}/social.db`) : ":memory:"),
  media,
  now,
  resident: (id) => service.state.residents[id],
  townsfolk,
  ...testXReader(process.env.TERRAKIN_TEST_X_OEMBED),
  maintainers,
  votesCast: (id) => votesCast(service.state, id),
  moderation,
  residentAgeDays: (id) => service.residentAgeDays(id),
  proposal: (id) => findProposal(service.state, id),
});

/**
 * End-to-end tests point X checks at a local fake oEmbed server with TERRAKIN_TEST_X_OEMBED. Only
 * a loopback http URL, and never with NODE_ENV=production (the Docker image sets it). The Worker
 * has no such switch.
 */
function testXReader(endpoint: string | undefined) {
  if (!endpoint) return {};
  const url = URL.canParse(endpoint) ? new URL(endpoint) : undefined;
  if (
    process.env.NODE_ENV === "production" ||
    url?.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    console.error("TERRAKIN_TEST_X_OEMBED must be a loopback http URL, and never in production.");
    process.exit(1);
  }
  console.log(`  X checks read from the test endpoint ${url.href}`);
  return { readXPost: oembedReader({ endpoint: url.href }) };
}
const server = createApp({
  service,
  social,
  media,
  trustedProxies,
  ...(sessionsPerMinute ? { sessionsPerMinute } : {}),
  ...(staticDir ? { staticDir: fromCwd(staticDir) } : {}),
  ...(testClock
    ? {
        testClock: {
          advanceDay: () => {
            offset += DAY_MS;
            service.tick();
            return service.state.day ?? null;
          },
          // The e2e suite needs a maintainer, and resident ids are random, so it names one here.
          grantMaintainer: (id: string) => {
            maintainers.add(id);
          },
        },
      }
    : {}),
});

server.listen(port, () => {
  console.log(`terrakin server on http://localhost:${port}`);
  console.log(`  world seq=${service.state.seq} hash=${service.hash()} day=${service.state.day}`);
  console.log(
    `  storage: ${dataDir ? `jsonl in ${fromCwd(dataDir)}` : "memory (set TERRAKIN_DATA_DIR to persist)"}`,
  );
  if (testClock) console.log("  test clock: POST /v1/test/advance-day moves the world a day on");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
