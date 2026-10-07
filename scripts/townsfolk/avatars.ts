/**
 * Set picked portraits as the townsfolk's avatars (decision 0220), through the public API like any
 * resident: `POST /v1/media` with the file, then `PUT /v1/profile {"avatar": "m_..."}`, each with
 * the resident's own token from the credentials file seed.ts keeps.
 *
 *   pnpm townsfolk:avatars -- --base <url> --dir <folder> --pick juniper=1,bram=2,...          # dry run
 *   pnpm townsfolk:avatars -- --base <url> --dir <folder> --pick juniper=1,bram=2,... --send   # sets them
 *
 *   --base   the server (required)
 *   --dir    the folder of candidates, named `<handle>-<n>.png` (required)
 *   --pick   handle=number for each townsfolk resident to change; the rest keep their avatars
 *   --send   upload and set them. Without it (or with --dry) it reads the profiles, checks each
 *            file, and prints the plan, changing nothing.
 *   --creds  the credentials file (default ~/.config/terrakin/townsfolk.<host>.json)
 *
 * Safe to rerun: a resident whose profile already shows the picked file is left alone. The
 * credentials file records each portrait, so `pnpm townsfolk -- --refresh-art` keeps it.
 * Tokens are never printed.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { MediaView, ProfileView } from "../../packages/protocol/src/index";
import {
  type AvatarStep,
  describeAvatarStep,
  parsePicks,
  planAvatar,
  portraitFile,
} from "./avatar-plan.ts";
import { type Creds, defaultCredsPath, writePrivateJson } from "./creds.ts";
import { PERSONAS } from "./personas.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === "--")),
  options: {
    base: { type: "string" },
    dir: { type: "string" },
    pick: { type: "string" },
    send: { type: "boolean", default: false },
    dry: { type: "boolean", default: false },
    creds: { type: "string" },
  },
});

const usage =
  "Usage: pnpm townsfolk:avatars -- --base <url> --dir <folder> --pick juniper=1,... [--send]";
if (!args.base || !args.dir || !args.pick) {
  console.error(usage);
  process.exit(2);
}
if (args.send && args.dry) {
  console.error("--dry and --send don't go together.");
  process.exit(2);
}
const BASE = new URL(args.base).origin;
const SEND = args.send;
const DIR = resolve(args.dir);
const CREDS = args.creds !== undefined ? resolve(args.creds) : defaultCredsPath(BASE);

const picked = parsePicks(
  args.pick,
  PERSONAS.map((p) => p.handle),
);
if (!picked.ok) {
  console.error(`--pick: ${picked.error}`);
  process.exit(2);
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** One request. A `rate_limited` answer waits and tries again; anything else that fails throws. */
async function call<T>(
  method: string,
  path: string,
  options: { token?: string; json?: unknown; bytes?: Uint8Array } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.bytes) {
      headers["content-type"] = "image/png";
      body = new Uint8Array(options.bytes);
    }
    const res = await fetch(`${BASE}${path}`, { method, headers, ...(body ? { body } : {}) });
    const data = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
    if (res.status === 429 && attempt < 6) {
      console.log(`         (rate limited on ${method} ${path}, waiting 15s)`);
      await sleep(15_000);
      continue;
    }
    if (!res.ok)
      throw new Error(`${method} ${path} failed: ${res.status} ${data.error?.code ?? ""}`);
    return data as T;
  }
}

async function main(): Promise<void> {
  if (!existsSync(CREDS)) {
    console.error(`No credentials file at ${CREDS}. Pass --creds, or seed this server first.`);
    process.exit(2);
  }
  const creds = JSON.parse(readFileSync(CREDS, "utf8")) as Creds;
  if (creds.base !== BASE) {
    console.error(`${CREDS} belongs to ${creds.base}, not ${BASE}. Pass --creds for this one.`);
    process.exit(2);
  }
  console.log(
    `avatars for ${picked.ok ? picked.picks.size : 0} townsfolk on ${BASE}${SEND ? "" : " (dry run)"}`,
  );
  console.log(`credentials: ${CREDS}`);

  let changed = 0;
  let problems = 0;
  for (const p of PERSONAS) {
    const n = picked.ok ? picked.picks.get(p.handle) : undefined;
    if (n === undefined) continue;
    const file = portraitFile(p.handle, n);
    const path = join(DIR, file);
    const bytes = existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
    const sha256 = bytes ? createHash("sha256").update(bytes).digest("hex") : "";
    const stored = creds.residents[p.key];
    let avatar: string | null = null;
    if (stored) {
      const { resident } = await call<{ resident: ProfileView }>(
        "GET",
        `/v1/residents/${stored.residentId}`,
      );
      avatar = resident.avatar;
    }
    const step: AvatarStep = planAvatar({ file, bytes, sha256, stored, avatar });
    console.log(`${p.name.padEnd(8)} ${describeAvatarStep(step, SEND)}`);
    if (step.kind === "bad" || step.kind === "unseeded") problems++;
    if (step.kind !== "set" || !SEND || !stored || !bytes) continue;
    const { media } = await call<{ media: MediaView }>("POST", "/v1/media", {
      token: stored.token,
      bytes,
    });
    await call("PUT", "/v1/profile", { token: stored.token, json: { avatar: media.id } });
    stored.portrait = { sha256, media: media.id };
    writePrivateJson(CREDS, creds);
    console.log(`${p.name.padEnd(8)} set ${media.id}`);
    changed++;
    await sleep(1_000);
  }
  if (!SEND) console.log("\nDry run: nothing changed. Add --send to set them.");
  else console.log(`\nset ${changed} avatar${changed === 1 ? "" : "s"}`);
  if (problems) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
