import {
  AGENT_LINK_RECHECK_MINUTES,
  type AgentLinkRequest,
  type AgentLinkResponse,
  type AgentLinkView,
  type AgentRef,
  formatAgentRef,
  type PartnerBadge,
  parseAgentRef,
} from "@terrakin/protocol";
import { type CardReader, cardNames, httpCardReader, residentEndpoint } from "./agent-card";
import {
  CHAINS,
  type ChainCall,
  type ChainConfig,
  cachedCall,
  readAgentOf,
  readBinding,
  readItemHolder,
  readOwner,
  readTokenUri,
  rpcReader,
  sameAddress,
} from "./chain";
import type { Moderation } from "./moderation";
import type { ArtReader, ArtWanted } from "./partner-art";
import {
  findPartner,
  PARTNERS,
  type PartnerConfig,
  partnerArtUrl,
  partnerBadge,
  partnerLabel,
  partnerSetUrl,
} from "./partners";
import type { SocialResult } from "./social-service";
import type { SqlExec } from "./sql-store";
import { count, gauge, report } from "./telemetry";
import { cleanText } from "./text";

/**
 * Agent links (RFC 0007): a resident proves it is a given ERC-8004 agent, and when that agent is a
 * partner's character, shows the partner's badge, border, and flair.
 *
 * The proof has two halves. The agent's card (the file its registry's `tokenURI` points to) lists a
 * `terrakin` service naming the resident's profile, which only whoever controls the agent can
 * arrange; and the resident asks for the link with its own credentials. Partner matching reads who
 * holds the agent on the partner's own contract (partners.ts) on every check, never the card's
 * text. For a partner's character it also reads who holds the character itself (the muse, on the
 * partner's collection) and keeps only a hash of that address: when the hash changes, the
 * character changed hands, and the link goes. No holder address is ever stored.
 *
 * Links live in the social tables and never feed the sim.
 *
 * Every read costs a call to a public endpoint, so reads are capped per UTC day in the social
 * database (`agent_reads`), in two pools: one for link attempts and one for rechecks, so neither
 * can starve the other. A check reserves the most it could take before it reads anything, then
 * gives back what it didn't use: a chain read answered from the one-minute cache (`cachedCall`) or
 * a check that stopped early costs nothing. Requests refused before reading (a bad id, another
 * registry, the per-resident attempt cap) cost nothing either. Cards are always fetched fresh,
 * since a fresh card is the point of asking again.
 */

export interface AgentLinkOptions {
  /** Reads from a network. Default: JSON-RPC to each allowlisted network's endpoint. */
  call?: ChainCall;
  /** Fetches an agent's card. Default: the real fetcher with its rules (agent-card.ts). */
  readCard?: CardReader;
  /** Fetches a partner character's picture. Default: the real fetcher (partner-art.ts). */
  readArt?: ArtReader;
  /** RPC URLs per network, from server config. Ignored when `call` is given. */
  rpcUrls?: Readonly<Record<number, string>>;
  /**
   * Reads (network calls, card fetches, and partner art copies) per UTC day, both pools together.
   * 0 turns links off.
   */
  readsPerDay?: number;
  /** The share of `readsPerDay` for rechecks. The rest is for link attempts. */
  recheckShare?: number;
  /** Most links one recheck run looks at. */
  perRun?: number;
  /** Link attempts one resident may make per UTC day. */
  attemptsPerDay?: number;
  partners?: readonly PartnerConfig[];
  chains?: Readonly<Record<number, ChainConfig>>;
  /** Called after a link is stored, so the Worker can make sure its recheck alarm is set. */
  onLinked?: () => void;
}

/**
 * Sized for MUSEGOD's 999 muses all linked: a recheck takes at most 5 reads, so 999 links checked
 * hourly is about 120,000 reads a day, inside the recheck pool (85% of 150,000). A run every 5
 * minutes of up to 100 links covers 1,200 links an hour.
 */
export const AGENT_LINK_DEFAULTS = {
  readsPerDay: 150_000,
  recheckShare: 0.85,
  perRun: 100,
  attemptsPerDay: 20,
} as const;

/** The agent link read cap from config, when it is a whole number. Empty or junk keeps the default. */
export function parseDailyReads(value: string | undefined): { readsPerDay?: number } {
  const text = value?.trim() ?? "";
  if (!/^\d+$/.test(text)) return {};
  return { readsPerDay: Number(text) };
}

/** How often a link is rechecked. */
export const RECHECK_MS = AGENT_LINK_RECHECK_MINUTES * 60_000;
/** How long to wait after the network or the card host couldn't be reached: 15 minutes, 1 hour, then 4 hours. */
export const DOWN_BACKOFF_MS = [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000] as const;
/** Checks in a row that couldn't reach the agent (about three days with the backoff) before the link goes. */
export const DOWN_LIMIT = 20;
/** The registry saying an agent doesn't exist this many checks in a row drops the link. */
export const GONE_LIMIT = 2;
/** A card that answers but can't be read this many checks in a row (a day) is treated as gone. */
export const BAD_CARD_LIMIT = 24;
/** How often the Worker's alarm and the Node timer run `recheckDue`, at the soonest. */
export const AGENT_RECHECK_EVERY_MS = 5 * 60_000;

/** When the Worker's alarm should next fire: when the next link is due, never sooner than 5 minutes out. */
export function nextRecheckAt(now: number, due: number | undefined): number | undefined {
  return due === undefined ? undefined : Math.max(now + AGENT_RECHECK_EVERY_MS, due);
}
/** The most reads one link attempt can take: resolve, card URI, holder, binding, the character's holder, the card. */
const LINK_READS = 6;
/** The most one recheck can take: card URI, holder, binding, the character's holder, the card. */
const RECHECK_READS = 5;
const CHAIN_CACHE_MS = 60_000;
const NAME_MAX_CHARS = 64;
const DAY_MS = 86_400_000;

export type Pool = "link" | "recheck";

interface LinkRow {
  resident_id: string;
  chain_id: number;
  registry: string;
  agent_id: string;
  name: string;
  name_hash: string;
  partner_id: string;
  subject: string;
  holder_hash: string;
  linked_at: number;
  checked_at: number;
  due_at: number;
  bad_checks: number;
  down_checks: number;
  gone_checks: number;
}

/** What one read of an agent found. */
type Check =
  | { kind: "gone" }
  | { kind: "down" }
  | { kind: "bad"; message: string }
  | {
      kind: "ok";
      cardName: string;
      names: (residentId: string) => boolean;
      partner: { id: string; subject: string; holderHash: string } | undefined;
    };

/** The readers one check uses, counting what really goes out. */
interface Meter {
  reads: number;
  call: ChainCall;
  readCard: CardReader;
}

type LinkReply = { status: 200 | 201; body: AgentLinkResponse };

/** How a recheck went: done (or nothing to do), or stopped because its pool is spent. */
type Recheck = "done" | "skipped" | "spent";

const fail = (
  code: "bad_request" | "not_found" | "unavailable" | "rate_limited",
  message: string,
) => ({ ok: false, code, message }) as const;

const UNAVAILABLE = "Couldn't read the agent just now. Try again in a minute.";
const OFF = "Agent links are off on this server.";
const UNREADABLE_PARTNER = "The partner's contract answered in a shape Terrakin can't read.";

/** SHA-256 of who holds a partner's character, so a sale shows without keeping the address. */
async function holderHash(partnerId: string, holder: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${partnerId}:${holder.toLowerCase()}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A short fingerprint of a card's raw name, to tell when it changed. Not for security. */
function nameHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length}:${h.toString(16)}`;
}

export class AgentLinkService {
  private readonly sql: SqlExec;
  private readonly now: () => number;
  private readonly moderation: Moderation;
  private readonly cache: (onRead?: () => void) => ChainCall;
  private readonly fetchCard: CardReader;
  private readonly readsPerDay: number;
  private readonly recheckShare: number;
  private readonly perRun: number;
  private readonly attemptsPerDay: number;
  private readonly partners: readonly PartnerConfig[];
  private readonly chains: Readonly<Record<number, ChainConfig>>;
  private readonly onLinked: (() => void) | undefined;
  /** Residents whose link is being rechecked right now, so a busy profile checks once. */
  private readonly inFlight = new Set<string>();
  /**
   * Called after residents' links were made, ended, or rechecked, with the pool any follow-up read
   * should come from. `SocialService` sets it to bring partner art in line (partner-art.ts).
   * Awaited, so a link's answer comes back after its art is copied.
   */
  onChange: ((residentIds: string[], pool: Pool) => Promise<void>) | undefined;

  constructor(
    deps: {
      sql: SqlExec;
      now: () => number;
      moderation: Moderation;
    },
    options: AgentLinkOptions = {},
  ) {
    this.sql = deps.sql;
    this.now = deps.now;
    this.moderation = deps.moderation;
    this.cache = cachedCall(
      options.call ?? rpcReader(options.rpcUrls ? { urls: options.rpcUrls } : {}),
      { now: this.now, ttlMs: CHAIN_CACHE_MS },
    );
    this.fetchCard = options.readCard ?? httpCardReader();
    this.readsPerDay = options.readsPerDay ?? AGENT_LINK_DEFAULTS.readsPerDay;
    this.recheckShare = options.recheckShare ?? AGENT_LINK_DEFAULTS.recheckShare;
    this.perRun = options.perRun ?? AGENT_LINK_DEFAULTS.perRun;
    this.attemptsPerDay = options.attemptsPerDay ?? AGENT_LINK_DEFAULTS.attemptsPerDay;
    this.partners = options.partners ?? PARTNERS;
    this.chains = options.chains ?? CHAINS;
    this.onLinked = options.onLinked;
    // The first cut of these tables (never deployed) kept the agent's holder address and counted
    // reads in one pool. Drop them if they exist, so no address stays behind.
    try {
      this.sql.exec("SELECT owner FROM agent_links LIMIT 0");
      this.sql.exec("DROP TABLE agent_links");
    } catch {
      // No such table, or already the current shape.
    }
    this.sql.exec("DROP TABLE IF EXISTS chain_reads");
    for (const statement of [
      // One row per linked resident. An agent links to one resident, and a partner's character
      // (partner_id, subject) to one resident; a newer link replaces an older one. `name_hash`
      // fingerprints the card's raw name, so a recheck runs the filters only when it changed.
      `CREATE TABLE IF NOT EXISTS agent_links (
        resident_id TEXT PRIMARY KEY,
        chain_id INTEGER NOT NULL,
        registry TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        name_hash TEXT NOT NULL DEFAULT '',
        partner_id TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        holder_hash TEXT NOT NULL DEFAULT '',
        linked_at INTEGER NOT NULL,
        checked_at INTEGER NOT NULL,
        due_at INTEGER NOT NULL,
        bad_checks INTEGER NOT NULL DEFAULT 0,
        down_checks INTEGER NOT NULL DEFAULT 0,
        gone_checks INTEGER NOT NULL DEFAULT 0,
        UNIQUE (chain_id, registry, agent_id)
      )`,
      "CREATE INDEX IF NOT EXISTS agent_links_due ON agent_links (due_at)",
      "CREATE INDEX IF NOT EXISTS agent_links_partner ON agent_links (partner_id, subject)",
      // Reads spent per UTC day and pool: the cost cap.
      `CREATE TABLE IF NOT EXISTS agent_reads (
        day INTEGER NOT NULL, pool TEXT NOT NULL, reads INTEGER NOT NULL,
        PRIMARY KEY (day, pool)
      )`,
      // Link attempts per resident per UTC day.
      `CREATE TABLE IF NOT EXISTS agent_link_attempts (
        resident_id TEXT NOT NULL, day INTEGER NOT NULL, attempts INTEGER NOT NULL,
        PRIMARY KEY (resident_id, day)
      )`,
    ]) {
      this.sql.exec(statement);
    }
  }

  // ---------- linking ----------

  async link(residentId: string, request: AgentLinkRequest): Promise<SocialResult<LinkReply>> {
    if (this.readsPerDay <= 0) return fail("unavailable", OFF);
    let wanted: { partner: PartnerConfig; subject: string; chain: ChainConfig } | undefined;
    let given: AgentRef | undefined;
    if (request.agent !== undefined) {
      given = parseAgentRef(request.agent);
      if (!given) {
        return fail(
          "bad_request",
          "That isn't an agent id. It looks like eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:7055.",
        );
      }
      const chain = this.chains[given.chainId];
      if (!chain) return fail("bad_request", "Terrakin doesn't read agents from that network yet.");
      if (!sameAddress(chain.registry, given.registry)) {
        return fail("bad_request", "That isn't the agent registry Terrakin reads on that network.");
      }
    } else {
      const partner = findPartner(request.partner ?? "", this.partners);
      if (partner?.status !== "active") {
        return fail("bad_request", "No partner by that id. GET /v1/partners lists them.");
      }
      const subject = request.subject ?? "";
      if (!partner.subject.test(subject)) {
        return fail("bad_request", `${partner.name} has no ${partnerLabel(partner, subject)}.`);
      }
      const chain = this.chains[partner.match.chainId];
      if (!chain) return fail("unavailable", UNAVAILABLE);
      wanted = { partner, subject, chain };
    }

    // Only now does anything cost: one attempt for this resident, and the most it could read.
    if (this.attemptsToday(residentId) >= this.attemptsPerDay) {
      return {
        ...fail(
          "rate_limited",
          `That's ${this.attemptsPerDay} agent checks for you today. Try again tomorrow.`,
        ),
        retryAfter: this.secondsToTomorrow(),
      };
    }
    const day = this.reserve("link", LINK_READS);
    if (day === undefined) return this.spent();
    this.countAttempt(residentId);
    const meter = this.meter();
    try {
      return await this.attempt(residentId, meter, given, wanted);
    } finally {
      this.settle("link", day, LINK_READS, meter.reads);
    }
  }

  private async attempt(
    residentId: string,
    meter: Meter,
    given: AgentRef | undefined,
    wanted: { partner: PartnerConfig; subject: string; chain: ChainConfig } | undefined,
  ): Promise<SocialResult<LinkReply>> {
    let ref = given;
    if (wanted) {
      const { partner, subject, chain } = wanted;
      const found = await readAgentOf(meter.call, chain.chainId, partner.match.agentOf, subject);
      if (!found.ok && found.bad) return fail("bad_request", UNREADABLE_PARTNER);
      if (!found.ok && !found.missing) return fail("unavailable", UNAVAILABLE);
      if (!found.ok || !found.value.registered) {
        return fail("not_found", `${partnerLabel(partner, subject)} has no agent yet.`);
      }
      ref = { chainId: chain.chainId, registry: chain.registry, agentId: found.value.agentId };
    }
    if (!ref) return fail("bad_request", "Send either `agent`, or `partner` with `subject`.");

    const check = await this.check(ref, meter);
    count("agent_link.check", { during: "link", result: check.kind });
    if (check.kind === "gone") return fail("not_found", "No agent with that id in the registry.");
    if (check.kind === "down") return fail("unavailable", UNAVAILABLE);
    if (check.kind === "bad") return fail("bad_request", check.message);
    if (
      wanted &&
      (check.partner?.id !== wanted.partner.id || check.partner.subject !== wanted.subject)
    ) {
      return fail(
        "bad_request",
        `That agent isn't ${partnerLabel(wanted.partner, wanted.subject)} any more.`,
      );
    }

    if (!check.names(residentId)) {
      const partner = check.partner ? findPartner(check.partner.id, this.partners) : undefined;
      const setUrl =
        partner && check.partner
          ? partnerSetUrl(partner, check.partner.subject, residentId)
          : undefined;
      return {
        ok: true,
        value: {
          status: 200,
          body: {
            link: null,
            message: setUrl
              ? "The agent's card doesn't name you yet. Ask whoever controls it to open setUrl and confirm this profile, then ask again."
              : `The agent's card doesn't name you yet. Its services need {"name": "terrakin", "endpoint": "${residentEndpoint(residentId)}"}; ask whoever controls it to add that, then ask again.`,
            ...(setUrl ? { setUrl } : {}),
          },
        },
      };
    }

    const now = this.now();
    const partner = check.partner;
    // A newer valid claim wins: the same agent, the same partner character, or this resident's
    // own older link all make way.
    const replaced = `resident_id = ?
        OR (chain_id = ? AND registry = ? AND agent_id = ?)
        OR (partner_id != '' AND partner_id = ? AND subject = ?)`;
    const replacedArgs = [
      residentId,
      ref.chainId,
      ref.registry.toLowerCase(),
      ref.agentId,
      partner?.id ?? "",
      partner?.subject ?? "",
    ];
    const others = [
      ...this.sql.exec(`SELECT resident_id FROM agent_links WHERE ${replaced}`, ...replacedArgs),
    ]
      .map((r) => String(r.resident_id))
      .filter((id) => id !== residentId);
    this.sql.exec(`DELETE FROM agent_links WHERE ${replaced}`, ...replacedArgs);
    this.sql.exec(
      `INSERT INTO agent_links (resident_id, chain_id, registry, agent_id, name, name_hash,
        partner_id, subject, holder_hash, linked_at, checked_at, due_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      residentId,
      ref.chainId,
      ref.registry.toLowerCase(),
      ref.agentId,
      this.cleanName(check.cardName),
      nameHash(check.cardName),
      partner?.id ?? "",
      partner?.subject ?? "",
      partner?.holderHash ?? "",
      now,
      now,
      now + RECHECK_MS,
    );
    this.onLinked?.();
    // Residents who lost the character first, so their copies go before the new one is made.
    await this.changed([...others, residentId], "link");
    const link = this.view(residentId);
    if (!link) return fail("unavailable", UNAVAILABLE);
    return { ok: true, value: { status: 201, body: { link } } };
  }

  /** End a resident's link. Its perks go with it: partner art, entitlements. */
  async unlink(residentId: string, pool: Pool = "link") {
    this.sql.exec("DELETE FROM agent_links WHERE resident_id = ?", residentId);
    await this.changed([residentId], pool);
  }

  private async changed(residentIds: string[], pool: Pool) {
    try {
      await this.onChange?.(residentIds, pool);
    } catch (err) {
      report(err, "agent_link.changed");
    }
  }

  /** Spend one read from today's pool, for a follow-up like copying art. False when it's spent. */
  spendRead(pool: Pool): boolean {
    return this.reserve(pool, 1) !== undefined;
  }

  /** The picture a resident's link brings: an active partner's character, with art in its config. */
  artWanted(residentId: string): ArtWanted | "paused" | undefined {
    const row = [
      ...this.sql.exec(
        "SELECT partner_id, subject FROM agent_links WHERE resident_id = ? AND partner_id != ''",
        residentId,
      ),
    ][0];
    if (!row) return undefined;
    const partner = findPartner(String(row.partner_id), this.partners);
    const subject = String(row.subject);
    if (partner?.status === "paused") return "paused";
    if (partner?.status !== "active" || !partner.subject.test(subject)) return undefined;
    const url = partnerArtUrl(partner, subject);
    return url ? { partnerId: partner.id, subject, url } : undefined;
  }

  // ---------- views ----------

  private row(residentId: string): LinkRow | undefined {
    return [...this.sql.exec("SELECT * FROM agent_links WHERE resident_id = ?", residentId)][0] as
      | LinkRow
      | undefined;
  }

  /** The partner's badge for a resident, for profiles and post authors. */
  badge(residentId: string): PartnerBadge | undefined {
    const row = [
      ...this.sql.exec(
        "SELECT partner_id, subject FROM agent_links WHERE resident_id = ? AND partner_id != ''",
        residentId,
      ),
    ][0];
    if (!row) return undefined;
    return partnerBadge(String(row.partner_id), String(row.subject), this.partners);
  }

  /** A resident's link as profiles show it. */
  view(residentId: string): AgentLinkView | undefined {
    const row = this.row(residentId);
    if (!row) return undefined;
    const partner = row.partner_id
      ? partnerBadge(row.partner_id, row.subject, this.partners)
      : undefined;
    return {
      agent: formatAgentRef({
        chainId: Number(row.chain_id),
        registry: row.registry,
        agentId: row.agent_id,
      }),
      name: row.name,
      linkedAt: new Date(Number(row.linked_at)).toISOString(),
      checkedAt: new Date(Number(row.checked_at)).toISOString(),
      ...(partner ? { partner } : {}),
    };
  }

  /** When the next recheck is due, or undefined when there are no links. */
  nextDueAt(): number | undefined {
    const row = [...this.sql.exec("SELECT MIN(due_at) AS due FROM agent_links")][0];
    return row?.due === null || row?.due === undefined ? undefined : Number(row.due);
  }

  // ---------- rechecks ----------

  /**
   * Recheck links that are due, oldest first, up to `perRun`, and stop early when the day's
   * recheck pool is spent. Returns how many were checked.
   */
  async recheckDue(): Promise<number> {
    const now = this.now();
    const oldest = this.nextDueAt();
    // How far behind rechecks are, so a backlog shows before links go stale.
    if (oldest !== undefined) {
      gauge("agent_link.recheck_lag_seconds", Math.max(0, Math.round((now - oldest) / 1000)));
    }
    const due = [
      ...this.sql.exec(
        "SELECT resident_id FROM agent_links WHERE due_at <= ? ORDER BY due_at LIMIT ?",
        now,
        this.perRun,
      ),
    ].map((r) => String(r.resident_id));
    let checked = 0;
    for (const residentId of due) {
      const result = await this.recheck(residentId);
      if (result === "spent") break;
      if (result === "done") checked++;
    }
    return checked;
  }

  /**
   * A profile view rechecks a link that is due, in the background. Returns the check (for tests),
   * or undefined when none was started.
   */
  refreshIfStale(residentId: string): Promise<Recheck> | undefined {
    const row = this.row(residentId);
    if (!row || row.due_at > this.now() || this.inFlight.has(residentId)) return undefined;
    return this.recheck(residentId).catch((err: unknown) => {
      report(err, "agent_link.recheck");
      return "skipped" as const;
    });
  }

  /** One recheck, from the row as it is now. */
  private async recheck(residentId: string): Promise<Recheck> {
    if (this.inFlight.has(residentId)) return "skipped";
    const row = this.row(residentId);
    // Gone, or checked since this run was planned.
    if (!row || row.due_at > this.now()) return "skipped";
    const day = this.reserve("recheck", RECHECK_READS);
    if (day === undefined) return "spent";
    this.inFlight.add(residentId);
    const meter = this.meter();
    try {
      await this.recheckRow(row, meter);
      return "done";
    } finally {
      this.inFlight.delete(residentId);
      this.settle("recheck", day, RECHECK_READS, meter.reads);
    }
  }

  private async recheckRow(row: LinkRow, meter: Meter): Promise<void> {
    const id = row.resident_id;
    const ref = { chainId: Number(row.chain_id), registry: row.registry, agentId: row.agent_id };
    const check = await this.check(ref, meter);
    count("agent_link.check", { during: "recheck", result: check.kind });
    const now = this.now();
    // Linked again (to this agent or another) or unlinked while we read: that newer state wins.
    const current = this.row(id);
    if (
      !current ||
      current.linked_at !== row.linked_at ||
      Number(current.chain_id) !== Number(row.chain_id) ||
      current.registry !== row.registry ||
      current.agent_id !== row.agent_id
    ) {
      return;
    }
    if (check.kind === "gone") {
      // One revert could be a node that is behind; two in a row means the agent is gone.
      const gones = Number(current.gone_checks) + 1;
      if (gones < GONE_LIMIT) {
        this.sql.exec(
          "UPDATE agent_links SET due_at = ?, gone_checks = ? WHERE resident_id = ?",
          now + (DOWN_BACKOFF_MS[0] ?? RECHECK_MS),
          gones,
          id,
        );
        return;
      }
    }
    if (check.kind === "down") {
      const downs = Number(current.down_checks) + 1;
      if (downs >= DOWN_LIMIT) {
        await this.unlink(id, "recheck");
        count("agent_link.dropped", { result: "down" });
        return;
      }
      const wait = DOWN_BACKOFF_MS[Math.min(downs, DOWN_BACKOFF_MS.length) - 1] ?? RECHECK_MS;
      this.sql.exec(
        "UPDATE agent_links SET due_at = ?, down_checks = ?, gone_checks = 0 WHERE resident_id = ?",
        now + wait,
        downs,
        id,
      );
      return;
    }
    if (check.kind === "bad" && Number(current.bad_checks) + 1 < BAD_CARD_LIMIT) {
      this.sql.exec(
        `UPDATE agent_links SET due_at = ?, bad_checks = bad_checks + 1, down_checks = 0,
          gone_checks = 0 WHERE resident_id = ?`,
        now + RECHECK_MS,
        id,
      );
      return;
    }
    if (check.kind !== "ok" || !check.names(id)) {
      await this.unlink(id, "recheck");
      count("agent_link.dropped", { result: check.kind });
      return;
    }
    const partner = check.partner;
    // The character changed hands since the link was made: whoever holds it now decides where it
    // lives, so this link goes (musegod.org also drops the card's line on a sale).
    if (
      partner &&
      current.holder_hash !== "" &&
      partner.id === current.partner_id &&
      partner.holderHash !== current.holder_hash
    ) {
      await this.unlink(id, "recheck");
      count("agent_link.dropped", { result: "sold" });
      return;
    }
    // The character may have moved to a newer link of someone else's meanwhile; it stays theirs.
    const taken =
      partner &&
      [
        ...this.sql.exec(
          "SELECT 1 AS x FROM agent_links WHERE partner_id = ? AND subject = ? AND resident_id != ?",
          partner.id,
          partner.subject,
          id,
        ),
      ].length > 0;
    // The filters run again only when the card's name changed, so a quiet recheck adds nothing to
    // the moderation counts or the logs.
    const hash = nameHash(check.cardName);
    const name = hash === current.name_hash ? current.name : this.cleanName(check.cardName);
    this.sql.exec(
      `UPDATE agent_links SET name = ?, name_hash = ?, partner_id = ?, subject = ?, holder_hash = ?,
        checked_at = ?, due_at = ?, bad_checks = 0, down_checks = 0, gone_checks = 0
        WHERE resident_id = ?`,
      name,
      hash,
      partner && !taken ? partner.id : "",
      partner && !taken ? partner.subject : "",
      partner && !taken ? partner.holderHash : "",
      now,
      now + RECHECK_MS,
      id,
    );
    // The partner match may have changed, and a copy of the character's art may still be due.
    await this.changed([id], "recheck");
  }

  // ---------- reading an agent ----------

  /** Readers for one check that count the reads that really go out. */
  private meter(): Meter {
    const meter: Meter = {
      reads: 0,
      call: this.cache(() => {
        meter.reads++;
      }),
      readCard: (uri) => {
        // An inline card costs no network read.
        if (!/^data:/i.test(uri)) meter.reads++;
        return this.fetchCard(uri);
      },
    };
    return meter;
  }

  /**
   * Read an agent: its card URI and holder, a partner match, and the card. The holder is compared
   * and dropped, never kept.
   */
  private async check(ref: AgentRef, meter: Meter): Promise<Check> {
    const [uri, holder] = await Promise.all([
      readTokenUri(meter.call, ref.chainId, ref.registry, ref.agentId),
      readOwner(meter.call, ref.chainId, ref.registry, ref.agentId),
    ]);
    if ((!uri.ok && uri.missing) || (!holder.ok && holder.missing)) return { kind: "gone" };
    if (!uri.ok && uri.bad) {
      return {
        kind: "bad",
        message: "The agent's card address can't be read: it is too long or malformed.",
      };
    }
    if (!holder.ok && holder.bad) {
      return { kind: "bad", message: "The agent's registry entry can't be read." };
    }
    if (!uri.ok || !holder.ok) return { kind: "down" };

    let partner: { id: string; subject: string; holderHash: string } | undefined;
    for (const p of this.partners) {
      const { match } = p;
      if (match.chainId !== ref.chainId || !sameAddress(match.owner, holder.value)) continue;
      const binding = await readBinding(meter.call, ref.chainId, match.owner, ref.agentId);
      if (!binding.ok) {
        if (binding.missing) continue;
        return binding.bad ? { kind: "bad", message: UNREADABLE_PARTNER } : { kind: "down" };
      }
      const { standard, bound, tokenId } = binding.value;
      // 0 is ERC-721: one item in the partner's own collection.
      if (standard === 0 && sameAddress(bound, match.collection) && p.subject.test(tokenId)) {
        // Who holds the character itself. A burned one (a revert) is no longer the partner's.
        const item = await readItemHolder(meter.call, ref.chainId, match.collection, tokenId);
        if (!item.ok) {
          if (item.missing) break;
          return item.bad ? { kind: "bad", message: UNREADABLE_PARTNER } : { kind: "down" };
        }
        partner = { id: p.id, subject: tokenId, holderHash: await holderHash(p.id, item.value) };
        break;
      }
    }

    const card = await meter.readCard(uri.value);
    if (!card.ok) return card.bad ? { kind: "bad", message: card.message } : { kind: "down" };
    return {
      kind: "ok",
      cardName: card.card.name,
      names: (residentId) => cardNames(card.card, residentId),
      partner,
    };
  }

  /**
   * The card's name, cleaned like a resident name: no control or invisible characters, capped,
   * and through the edge filters. A name the filters turn away is stored empty; the link stands.
   */
  private cleanName(raw: string): string {
    const text = Array.from(cleanText(raw)).slice(0, NAME_MAX_CHARS).join("").trim();
    if (text === "") return "";
    return this.moderation.review("name", text).ok ? text : "";
  }

  // ---------- the cost cap ----------

  private day(): number {
    return Math.floor(this.now() / DAY_MS);
  }

  private secondsToTomorrow(): number {
    return Math.max(1, Math.ceil((DAY_MS - (this.now() % DAY_MS)) / 1000));
  }

  /** Reads spent today, in one pool or both. */
  readsToday(pool?: Pool): number {
    const rows = [
      ...this.sql.exec(
        "SELECT pool, reads FROM agent_reads WHERE day = ? AND (? = '' OR pool = ?)",
        this.day(),
        pool ?? "",
        pool ?? "",
      ),
    ];
    return rows.reduce((sum, r) => sum + Number(r.reads), 0);
  }

  private poolCap(pool: Pool): number {
    const recheck = Math.floor(this.readsPerDay * this.recheckShare);
    return pool === "recheck" ? recheck : this.readsPerDay - recheck;
  }

  /**
   * Reserve `reads` from today's pool if they fit. Reserved up front, at the most a check can take,
   * so concurrent checks can't push a day past its cap; `settle` gives back what wasn't used.
   */
  private reserve(pool: Pool, reads: number): number | undefined {
    const day = this.day();
    if (this.readsToday(pool) + reads > this.poolCap(pool)) return undefined;
    this.addReads(pool, day, reads);
    this.sql.exec("DELETE FROM agent_reads WHERE day < ?", day - 30);
    return day;
  }

  /**
   * Settle a reservation on the day it was charged, even if the check ended after midnight: give
   * back what didn't go out, or charge an overrun (a check that read more than it reserved, which
   * two partners sharing one binding contract could cause).
   */
  private settle(pool: Pool, day: number, reserved: number, used: number) {
    if (used !== reserved) this.addReads(pool, day, used - reserved);
  }

  private addReads(pool: Pool, day: number, reads: number) {
    this.sql.exec(
      `INSERT INTO agent_reads (day, pool, reads) VALUES (?, ?, MAX(0, ?))
        ON CONFLICT (day, pool) DO UPDATE SET reads = MAX(0, reads + ?)`,
      day,
      pool,
      reads,
      reads,
    );
  }

  private attemptsToday(residentId: string): number {
    const row = [
      ...this.sql.exec(
        "SELECT attempts FROM agent_link_attempts WHERE resident_id = ? AND day = ?",
        residentId,
        this.day(),
      ),
    ][0];
    return Number(row?.attempts ?? 0);
  }

  private countAttempt(residentId: string) {
    const day = this.day();
    this.sql.exec(
      `INSERT INTO agent_link_attempts (resident_id, day, attempts) VALUES (?, ?, 1)
        ON CONFLICT (resident_id, day) DO UPDATE SET attempts = attempts + 1`,
      residentId,
      day,
    );
    this.sql.exec("DELETE FROM agent_link_attempts WHERE day < ?", day - 2);
  }

  private spent() {
    return {
      ok: false as const,
      code: "rate_limited" as const,
      message: "Terrakin has checked as many agents as it can today. Try again tomorrow.",
      retryAfter: this.secondsToTomorrow(),
    };
  }
}
