/**
 * Spend the townsfolk's daily coin budgets through the public API, like any resident would: 10 to
 * each newcomer since the last run, and a tip for the day's most-reacted post that isn't by
 * townsfolk. The choosing is in packages/server/src/tip-plan.ts; this reads the server, prints the
 * plan, and with `--send` gives the coins.
 *
 * terrakin.org runs the same plan inside the Worker once a day
 * (packages/server/src/townsfolk-tips.ts), so this is for self-hosting and local runs. Don't
 * `--send` against a server whose own tips are on.
 *
 *   pnpm townsfolk:tips -- --base http://localhost:8787            # dry run: print what it would give
 *   pnpm townsfolk:tips -- --base http://localhost:8787 --send     # give it
 *
 *   --base   server (required)
 *   --send   actually give the coins; without it nothing changes
 *   --creds  the townsfolk credentials (default ~/.config/terrakin/townsfolk.<host>.json, written
 *            by seed.ts). The tips state is kept next to it, as townsfolk.<host>.tips.json.
 *   --pace   pause between gifts, in ms (default 1000)
 *
 * Safe to rerun the same day: newcomers are remembered in the state file, and townsfolk purse
 * ledgers show who already had a welcome or the day's post tip. A refusal from the server (a cap, a
 * maintainer, a block) is normal: it's printed and the run moves on, never retried. A rate limit or
 * a server error stops the run; run it again later and it picks up where it stopped.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type {
  FeedResponse,
  PurseResponse,
  TownResponse,
  WorldSnapshot,
} from "../../packages/protocol/src/index";
import {
  ALL_TIP_NOTES,
  type FeedPost,
  type Giver,
  nextState,
  type PlannedGift,
  planTips,
  TIPS,
  type TipState,
  type WelcomeLine,
} from "../../packages/server/src/tip-plan.ts";
import { type Creds, defaultCredsPath, tipsStatePath, writePrivateJson } from "./creds.ts";
import { PERSONAS } from "./personas.ts";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === "--")),
  options: {
    base: { type: "string" },
    send: { type: "boolean", default: false },
    creds: { type: "string" },
    pace: { type: "string", default: "1000" },
  },
});

if (!args.base) {
  console.error("Usage: node scripts/townsfolk/tips.ts --base <url> [--send] [--creds <file>]");
  process.exit(2);
}
const BASE = new URL(args.base).origin;
const SEND = args.send;
const PACE = Math.max(0, Number(args.pace) || 0);
const CREDS = args.creds !== undefined ? resolve(args.creds) : defaultCredsPath(BASE);
const STATE = tipsStatePath(CREDS);

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const say = (who: string, message: string) => console.log(`${who.padEnd(8)} ${message}`);

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function loadCreds(): Creds {
  if (!existsSync(CREDS)) {
    throw new Error(`No townsfolk credentials at ${CREDS}. Seed them first with pnpm townsfolk.`);
  }
  const creds = JSON.parse(readFileSync(CREDS, "utf8")) as Creds;
  if (creds.base !== BASE) {
    throw new Error(`${CREDS} belongs to ${creds.base}, not ${BASE}. Pass --creds for this one.`);
  }
  return creds;
}

interface StateFile extends TipState {
  base: string;
}

function loadState(): TipState {
  if (!existsSync(STATE)) return { tippedPosts: [] };
  const file = JSON.parse(readFileSync(STATE, "utf8")) as StateFile;
  if (file.base !== BASE) throw new Error(`${STATE} belongs to ${file.base}, not ${BASE}.`);
  const { base: _base, ...state } = file;
  return { ...state, tippedPosts: state.tippedPosts ?? [] };
}

function saveState(state: TipState): void {
  if (!SEND) return;
  writePrivateJson(STATE, { base: BASE, ...state });
}

// ---------------------------------------------------------------------------
// HTTP. Reads fail loudly. A gift's answer is sent, refused (normal), or stop (try later).
// ---------------------------------------------------------------------------

async function read<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`GET ${path.split("?")[0]} failed: ${res.status}`);
  return (await res.json()) as T;
}

type Outcome =
  | { kind: "sent" }
  | { kind: "refused"; code: string; message: string }
  | { kind: "stop"; message: string };

async function give(token: string, gift: PlannedGift): Promise<Outcome> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/v1/actions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        type: "give_coins",
        to: gift.to,
        amount: gift.amount,
        note: gift.note,
      }),
    });
  } catch (err) {
    return { kind: "stop", message: err instanceof Error ? err.message : String(err) };
  }
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: { code?: string; message?: string };
  };
  if (res.status === 429) return { kind: "stop", message: "rate limited" };
  if (res.status >= 500) return { kind: "stop", message: `server error ${res.status}` };
  if (res.ok && body.ok === true) return { kind: "sent" };
  return {
    kind: "refused",
    code: body.error?.code ?? String(res.status),
    message: body.error?.message ?? "",
  };
}

// ---------------------------------------------------------------------------
// Reading the town
// ---------------------------------------------------------------------------

/** Top-level posts from the last day, newest first, a few pages at most. */
async function recentPosts(now: number): Promise<FeedPost[]> {
  const posts: FeedPost[] = [];
  let before: string | null = null;
  for (let page = 0; page < 6; page++) {
    const query = `limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`;
    const feed: FeedResponse = await read<FeedResponse>(`/v1/feed?${query}`);
    for (const p of feed.posts) {
      if (p.repostedBy) continue;
      const counts: (number | undefined)[] = Object.values(p.reactions ?? {});
      const reactions = counts.reduce<number>((sum, n) => sum + (n ?? 0), 0);
      posts.push({
        id: p.id,
        authorId: p.author.id,
        authorName: p.author.name,
        authorTownsfolk: p.author.townsfolk === true,
        createdAt: p.createdAt,
        reactions: Math.max(reactions, p.likeCount),
      });
    }
    const oldest = feed.posts.at(-1);
    before = feed.next;
    if (!before || !oldest || now - Date.parse(oldest.createdAt) > TIPS.postWindowMs) break;
  }
  return posts;
}

const describe = (g: PlannedGift) =>
  `${g.amount} to ${g.toName} (${g.to})${g.postId ? ` for post ${g.postId}` : ""}`;

async function main(): Promise<void> {
  const creds = loadCreds();
  let state = loadState();
  const now = Date.now();

  const town = await read<TownResponse>("/v1/town");
  if (town.day === null || !town.treasury) {
    console.log("Coins aren't open on this server yet. Nothing to give.");
    return;
  }
  const today = town.day;
  const world = await read<WorldSnapshot>("/v1/world");

  const givers: Giver[] = [];
  const tokens = new Map<string, string>();
  for (const p of PERSONAS) {
    const stored = creds.residents[p.key];
    if (!stored) continue;
    const { purse } = await read<PurseResponse>("/v1/purse", stored.token);
    if (!purse) continue;
    tokens.set(p.key, stored.token);
    givers.push({
      key: p.key,
      name: p.name,
      residentId: stored.residentId,
      balance: purse.balance,
      ledger: purse.ledger.map((l) => ({
        day: l.day,
        amount: l.amount,
        reason: l.reason,
        ...(l.with ? { with: l.with.id } : {}),
        ...(l.note !== undefined ? { note: l.note } : {}),
      })),
      notes: p.tips,
    });
  }
  if (givers.length === 0) {
    console.log("No townsfolk with a purse in the credentials file. Nothing to give.");
    return;
  }

  const welcomes: WelcomeLine[] = town.treasury.ledger.flatMap((l) =>
    l.reason === "welcome" && l.resident
      ? [{ seq: l.seq, day: l.day, residentId: l.resident.id, name: l.resident.name }]
      : [],
  );
  const posts = await recentPosts(now);
  const plan = planTips({
    today,
    now,
    givers,
    townsfolk: world.townsfolk ?? [],
    welcomes,
    ...(town.treasury.ledger.length > 0
      ? { oldestTreasurySeq: Math.min(...town.treasury.ledger.map((l) => l.seq)) }
      : {}),
    posts,
    state,
    // The server's daily run gives with the same notes; recognize all of them.
    knownNotes: ALL_TIP_NOTES,
  });

  console.log(`Day ${today}. Budgets left:`);
  for (const g of givers) say(g.name, `${g.balance} coins`);
  console.log("");
  console.log("Newcomers:");
  if (plan.welcomes.length === 0 && plan.unfunded === 0) console.log("  none since the last run");
  for (const step of plan.welcomes) {
    if ("gift" in step) say(step.gift.from.name, `would give ${describe(step.gift)}`);
    else console.log(`  skip ${step.name}: ${step.skip}`);
  }
  if (plan.unfunded > 0) console.log(`  ${plan.unfunded} more wait for tomorrow's budgets`);
  if (plan.gap) {
    console.log("  Note: the treasury's history no longer reaches back to the last run, so some");
    console.log("  newcomers since then may have been missed. Run this daily to avoid that.");
  }
  console.log("");
  console.log("Best post of the last day:");
  if (plan.noPostTip) console.log(`  none: ${plan.noPostTip}`);
  plan.posts.forEach((g, i) => {
    say(g.from.name, `${i === 0 ? "would give" : "or, if refused,"} ${describe(g)}`);
  });

  if (!SEND) {
    console.log("");
    console.log("Dry run: nothing given. Pass --send to give these.");
    return;
  }

  console.log("");
  let welcomedThrough: number | undefined;
  let stopped = false;
  for (const step of plan.welcomes) {
    if ("skip" in step) {
      welcomedThrough = step.seq;
      continue;
    }
    const outcome = await give(tokens.get(step.gift.from.key) ?? "", step.gift);
    if (outcome.kind === "stop") {
      console.log(`Stopped: ${outcome.message}. Run again later to pick up from here.`);
      stopped = true;
      break;
    }
    welcomedThrough = step.seq;
    if (outcome.kind === "sent") say(step.gift.from.name, `gave ${describe(step.gift)}`);
    else say(step.gift.from.name, `refused (${outcome.code}): ${outcome.message}`);
    state = nextState(state, plan, { welcomedThrough, postTried: false, today });
    saveState(state);
    await sleep(PACE);
  }
  state = nextState(state, plan, {
    ...(welcomedThrough === undefined ? {} : { welcomedThrough }),
    postTried: false,
    today,
  });
  saveState(state);
  if (stopped) return;

  // Try the best posts in order, once each, until one is accepted.
  let postTipped: string | undefined;
  for (const gift of plan.posts) {
    const outcome = await give(tokens.get(gift.from.key) ?? "", gift);
    if (outcome.kind === "stop") {
      console.log(`Stopped: ${outcome.message}. Run again later.`);
      return;
    }
    state = nextState(state, plan, { postTried: true, today });
    saveState(state);
    if (outcome.kind === "sent") {
      say(gift.from.name, `gave ${describe(gift)}`);
      postTipped = gift.postId;
      break;
    }
    say(gift.from.name, `refused (${outcome.code}): ${outcome.message}`);
    await sleep(PACE);
  }
  if (postTipped) {
    state = nextState(state, plan, { postTried: true, postTipped, today });
    saveState(state);
  }
  console.log("Done.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
