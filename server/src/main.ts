import { resolve } from "node:path";
import { createApp } from "./app";
import { FileMediaStore } from "./file-media-store";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { JsonlStore, MemoryStore } from "./store";
import { WorldService } from "./world-service";

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

const store = dataDir ? new JsonlStore(fromCwd(dataDir)) : new MemoryStore();
const service = new WorldService({ store });
const media = dataDir ? new FileMediaStore(fromCwd(`${dataDir}/media`)) : new MemoryMediaStore();
const social = new SocialService({
  sql: nodeSql(dataDir ? fromCwd(`${dataDir}/social.db`) : ":memory:"),
  media,
  resident: (id) => service.state.residents[id],
});
const server = createApp({
  service,
  social,
  media,
  trustedProxies,
  ...(staticDir ? { staticDir: fromCwd(staticDir) } : {}),
});

server.listen(port, () => {
  console.log(`terrakin server on http://localhost:${port}`);
  console.log(`  world seq=${service.state.seq} hash=${service.hash()}`);
  console.log(
    `  storage: ${dataDir ? `jsonl in ${fromCwd(dataDir)}` : "memory (set TERRAKIN_DATA_DIR to persist)"}`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
