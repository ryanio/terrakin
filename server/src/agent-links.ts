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
  readOwner,
  readTokenUri,
  rpcReader,
  sameAddress,
} from "./chain";
import type { Moderation } from "./moderation";
import {
  findPartner,
  PARTNERS,
  type PartnerConfig,
  partnerBadge,
  partnerLabel,
  partnerSetUrl,
} from "./partners";
import type { SocialResult } from "./social-service";
import type { SqlExec } from "./sql-store";
import { count, report } from "./telemetry";
import { cleanText } from "./text";

/**
 * Agent links (RFC 0007): a resident proves it is a given ERC-8004 agent, and when that agent is a
 * partner's character, shows the partner's badge, border, and flair.
 *
 * The proof has two halves. The agent's card (the file its registry's `tokenURI` points to) lists a
 * `terrakin` service naming the resident's profile, which only whoever controls the agent can
 * arrange; and the resident asks for the link with its own credentials. Partner matching reads who
 * holds the agent on the partner's own contract (partners.ts), never the card's text.
 *
 * Links live in the social tables and never feed the sim. The owner address is kept server side
 * only, to rerun partner matching; it is never in a response, a log line, or telemetry.
 *
 * Every read costs a call to a public endpoint, so they are capped per UTC day in the social
 * database (`chain_reads`). Rechecks may use only part of the cap, so new links always have room,
 * and each recheck run does a bounded number. Chain reads are remembered for a minute
 * (`cachedCall`); cards are always fetched fresh, since a fresh card is the point of asking again.
 */

export interface AgentLinkOptions {
  /** Reads from a network. Default: JSON-RPC to each allowlisted network's endpoint. */
  call?: ChainCall;
  /** Fetches an agent's card. Default: the real fetcher with its rules (agent-card.ts). */
  readCard?: CardReader;
  /** RPC URLs per network, from server config. Ignored when `call` is given. */
  rpcUrls?: Readonly<Record<number, string>>;
  /** Reads (network calls plus card fetches) per UTC day, for links and rechecks together. */
  readsPerDay?: number;
  /** The share of `readsPerDay` rechecks may use. The rest is kept for new links. */
  recheckShare?: number;
  /** Most links one recheck run looks at. */
  perRun?: number;
  partners?: readonly PartnerConfig[];
  chains?: Readonly<Record<number, ChainConfig>>;
  /** Called after a link is stored, so the Worker can make sure its recheck alarm is set. */
  onLinked?: () => void;
}

export const AGENT_LINK_DEFAULTS = {
  readsPerDay: 20_000,
  recheckShare: 0.75,
  perRun: 50,
} as const;

/** How often a link is rechecked, and how soon after a failed check it's tried again. */
export const RECHECK_MS = AGENT_LINK_RECHECK_MINUTES * 60_000;
export const RETRY_MS = 15 * 60_000;
/** How often the Worker's alarm and the Node timer run `recheckDue`. */
export const AGENT_RECHECK_EVERY_MS = 5 * 60_000;
/** A card that answers but can't be read this many checks in a row (a day) is treated as gone. */
export const BAD_CARD_LIMIT = 24;
/** The most reads one link attempt can take: resolve, card URI, holder, binding, the card. */
const LINK_READS = 5;
const RECHECK_READS = 4;
const CHAIN_CACHE_MS = 60_000;
const NAME_MAX_CHARS = 64;
const DAY_MS = 86_400_000;

interface LinkRow {
  resident_id: string;
  chain_id: number;
  registry: string;
  agent_id: string;
  owner: string;
  name: string;
  partner_id: string;
  subject: string;
  linked_at: number;
  checked_at: number;
  due_at: number;
  bad_checks: number;
}

/** What one read of an agent found. */
type Check =
  | { kind: "gone" }
  | { kind: "down" }
  | { kind: "bad"; message: string }
  | {
      kind: "ok";
      owner: string;
      cardName: string;
      names: (residentId: string) => boolean;
      partner: { id: string; subject: string } | undefined;
    };

type LinkReply = { status: 200 | 201; body: AgentLinkResponse };

const fail = (
  code: "bad_request" | "not_found" | "unavailable" | "rate_limited",
  message: string,
) => ({ ok: false, code, message }) as const;

const UNAVAILABLE = "Couldn't read the agent just now. Try again in a minute.";

export class AgentLinkService {
  private readonly sql: SqlExec;
  private readonly now: () => number;
  private readonly moderation: Moderation;
  private readonly call: ChainCall;
  private readonly readCard: CardReader;
  private readonly readsPerDay: number;
  private readonly recheckShare: number;
  private readonly perRun: number;
  private readonly partners: readonly PartnerConfig[];
  private readonly chains: Readonly<Record<number, ChainConfig>>;
  private readonly onLinked: (() => void) | undefined;
  /** Residents whose link is being rechecked right now, so a busy profile checks once. */
  private readonly inFlight = new Set<string>();

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
    this.call = cachedCall(
      options.call ?? rpcReader(options.rpcUrls ? { urls: options.rpcUrls } : {}),
      { now: this.now, ttlMs: CHAIN_CACHE_MS },
    );
    this.readCard = options.readCard ?? httpCardReader();
    this.readsPerDay = options.readsPerDay ?? AGENT_LINK_DEFAULTS.readsPerDay;
    this.recheckShare = options.recheckShare ?? AGENT_LINK_DEFAULTS.recheckShare;
    this.perRun = options.perRun ?? AGENT_LINK_DEFAULTS.perRun;
    this.partners = options.partners ?? PARTNERS;
    this.chains = options.chains ?? CHAINS;
    this.onLinked = options.onLinked;
    for (const statement of [
      // One row per linked resident. An agent links to one resident, and a partner's character
      // (partner_id, subject) to one resident; a newer link replaces an older one.
      `CREATE TABLE IF NOT EXISTS agent_links (
        resident_id TEXT PRIMARY KEY,
        chain_id INTEGER NOT NULL,
        registry TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        partner_id TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        linked_at INTEGER NOT NULL,
        checked_at INTEGER NOT NULL,
        due_at INTEGER NOT NULL,
        bad_checks INTEGER NOT NULL DEFAULT 0,
        UNIQUE (chain_id, registry, agent_id)
      )`,
      "CREATE INDEX IF NOT EXISTS agent_links_due ON agent_links (due_at)",
      "CREATE INDEX IF NOT EXISTS agent_links_partner ON agent_links (partner_id, subject)",
      // Reads spent per UTC day: the cost cap.
      `CREATE TABLE IF NOT EXISTS chain_reads (
        day INTEGER PRIMARY KEY, reads INTEGER NOT NULL
      )`,
    ]) {
      this.sql.exec(statement);
    }
  }

  // ---------- linking ----------

  async link(residentId: string, request: AgentLinkRequest): Promise<SocialResult<LinkReply>> {
    let wanted: { partner: PartnerConfig; subject: string } | undefined;
    let ref: AgentRef | undefined;
    if (request.agent !== undefined) {
      ref = parseAgentRef(request.agent);
      if (!ref) {
        return fail(
          "bad_request",
          "That isn't an agent id. It looks like eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:7055.",
        );
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
      wanted = { partner, subject };
    }
    if (!this.take(LINK_READS, 1)) return this.spent();

    if (wanted) {
      const { partner, subject } = wanted;
      const chain = this.chains[partner.match.chainId];
      if (!chain) return fail("unavailable", UNAVAILABLE);
      const found = await readAgentOf(this.call, chain.chainId, partner.match.agentOf, subject);
      if (!found.ok) {
        return found.missing
          ? fail("not_found", `${partnerLabel(partner, subject)} has no agent yet.`)
          : fail("unavailable", UNAVAILABLE);
      }
      if (!found.value.registered) {
        return fail("not_found", `${partnerLabel(partner, subject)} has no agent yet.`);
      }
      ref = { chainId: chain.chainId, registry: chain.registry, agentId: found.value.agentId };
    }
    if (!ref) return fail("bad_request", "Send either `agent`, or `partner` with `subject`.");

    const chain = this.chains[ref.chainId];
    if (!chain) return fail("bad_request", "Terrakin doesn't read agents from that network yet.");
    if (!sameAddress(chain.registry, ref.registry)) {
      return fail("bad_request", "That isn't the agent registry Terrakin reads on that network.");
    }

    const check = await this.check(ref);
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
    this.sql.exec(
      `DELETE FROM agent_links WHERE resident_id = ?
        OR (chain_id = ? AND registry = ? AND agent_id = ?)
        OR (partner_id != '' AND partner_id = ? AND subject = ?)`,
      residentId,
      ref.chainId,
      ref.registry.toLowerCase(),
      ref.agentId,
      partner?.id ?? "",
      partner?.subject ?? "",
    );
    this.sql.exec(
      `INSERT INTO agent_links (resident_id, chain_id, registry, agent_id, owner, name, partner_id,
        subject, linked_at, checked_at, due_at, bad_checks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      residentId,
      ref.chainId,
      ref.registry.toLowerCase(),
      ref.agentId,
      check.owner,
      this.cleanName(check.cardName),
      partner?.id ?? "",
      partner?.subject ?? "",
      now,
      now,
      now + RECHECK_MS,
    );
    this.onLinked?.();
    const link = this.view(residentId);
    if (!link) return fail("unavailable", UNAVAILABLE);
    return { ok: true, value: { status: 201, body: { link } } };
  }

  unlink(residentId: string) {
    this.sql.exec("DELETE FROM agent_links WHERE resident_id = ?", residentId);
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

  /** A resident's link as profiles show it. Never the owner address. */
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

  hasLinks(): boolean {
    return [...this.sql.exec("SELECT 1 AS x FROM agent_links LIMIT 1")].length > 0;
  }

  // ---------- rechecks ----------

  /**
   * Recheck links that are due, oldest first, up to `perRun`, and stop early when the day's share
   * of reads for rechecks is spent. Returns how many were checked.
   */
  async recheckDue(): Promise<number> {
    const due = [
      ...this.sql.exec(
        "SELECT * FROM agent_links WHERE due_at <= ? ORDER BY due_at LIMIT ?",
        this.now(),
        this.perRun,
      ),
    ] as unknown as LinkRow[];
    let checked = 0;
    for (const row of due) {
      if (!(await this.recheck(row))) break;
      checked++;
    }
    return checked;
  }

  /**
   * A profile view rechecks a link older than an hour, in the background. Returns the check (for
   * tests), or undefined when none was started.
   */
  refreshIfStale(residentId: string): Promise<boolean> | undefined {
    const row = this.row(residentId);
    if (!row || row.due_at > this.now() || this.inFlight.has(residentId)) return undefined;
    return this.recheck(row).catch((err: unknown) => {
      report(err, "agent_link.recheck");
      return false;
    });
  }

  /** One recheck. False when the day's recheck reads are spent and nothing was read. */
  private async recheck(row: LinkRow): Promise<boolean> {
    if (this.inFlight.has(row.resident_id)) return true;
    if (!this.take(RECHECK_READS, this.recheckShare)) return false;
    this.inFlight.add(row.resident_id);
    try {
      const ref = { chainId: Number(row.chain_id), registry: row.registry, agentId: row.agent_id };
      const check = await this.check(ref);
      count("agent_link.check", { during: "recheck", result: check.kind });
      const now = this.now();
      const still = () => this.row(row.resident_id)?.linked_at === row.linked_at;
      // Linked again (or unlinked) while we read: that newer state wins.
      if (!still()) return true;
      if (check.kind === "down") {
        this.sql.exec(
          "UPDATE agent_links SET due_at = ? WHERE resident_id = ?",
          now + RETRY_MS,
          row.resident_id,
        );
        return true;
      }
      if (check.kind === "bad" && Number(row.bad_checks) + 1 < BAD_CARD_LIMIT) {
        this.sql.exec(
          "UPDATE agent_links SET due_at = ?, bad_checks = bad_checks + 1 WHERE resident_id = ?",
          now + RECHECK_MS,
          row.resident_id,
        );
        return true;
      }
      if (check.kind !== "ok" || !check.names(row.resident_id)) {
        this.unlink(row.resident_id);
        count("agent_link.dropped", { result: check.kind });
        return true;
      }
      const partner = check.partner;
      // The character may have moved to a newer link of someone else's meanwhile; it stays theirs.
      const taken =
        partner &&
        [
          ...this.sql.exec(
            "SELECT 1 AS x FROM agent_links WHERE partner_id = ? AND subject = ? AND resident_id != ?",
            partner.id,
            partner.subject,
            row.resident_id,
          ),
        ].length > 0;
      this.sql.exec(
        `UPDATE agent_links SET owner = ?, name = ?, partner_id = ?, subject = ?, checked_at = ?,
          due_at = ?, bad_checks = 0 WHERE resident_id = ?`,
        check.owner,
        this.cleanName(check.cardName),
        partner && !taken ? partner.id : "",
        partner && !taken ? partner.subject : "",
        now,
        now + RECHECK_MS,
        row.resident_id,
      );
      return true;
    } finally {
      this.inFlight.delete(row.resident_id);
    }
  }

  // ---------- reading an agent ----------

  /** Read an agent: its card URI and holder, a partner match, and the card. */
  private async check(ref: AgentRef): Promise<Check> {
    const [uri, owner] = await Promise.all([
      readTokenUri(this.call, ref.chainId, ref.registry, ref.agentId),
      readOwner(this.call, ref.chainId, ref.registry, ref.agentId),
    ]);
    if ((!uri.ok && uri.missing) || (!owner.ok && owner.missing)) return { kind: "gone" };
    if (!uri.ok || !owner.ok) return { kind: "down" };

    let partner: { id: string; subject: string } | undefined;
    for (const p of this.partners) {
      const { match } = p;
      if (match.chainId !== ref.chainId || !sameAddress(match.owner, owner.value)) continue;
      const binding = await readBinding(this.call, ref.chainId, match.owner, ref.agentId);
      if (!binding.ok) {
        if (binding.missing) continue;
        return { kind: "down" };
      }
      const { standard, bound, tokenId } = binding.value;
      // 0 is ERC-721: one item in the partner's own collection.
      if (standard === 0 && sameAddress(bound, match.collection) && p.subject.test(tokenId)) {
        partner = { id: p.id, subject: tokenId };
        break;
      }
    }

    const card = await this.readCard(uri.value);
    if (!card.ok) return card.bad ? { kind: "bad", message: card.message } : { kind: "down" };
    return {
      kind: "ok",
      owner: owner.value,
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

  /** Reads spent today. */
  readsToday(): number {
    const day = Math.floor(this.now() / DAY_MS);
    const row = [...this.sql.exec("SELECT reads FROM chain_reads WHERE day = ?", day)][0];
    return Number(row?.reads ?? 0);
  }

  /**
   * Reserve `reads` for today if they fit under `share` of the daily cap. Reserved up front, at the
   * most a check can take, so concurrent checks can't push a day past its cap.
   */
  private take(reads: number, share: number): boolean {
    const day = Math.floor(this.now() / DAY_MS);
    if (this.readsToday() + reads > Math.floor(this.readsPerDay * share)) return false;
    this.sql.exec(
      `INSERT INTO chain_reads (day, reads) VALUES (?, ?)
        ON CONFLICT (day) DO UPDATE SET reads = reads + excluded.reads`,
      day,
      reads,
    );
    this.sql.exec("DELETE FROM chain_reads WHERE day < ?", day - 30);
    return true;
  }

  private spent() {
    const now = this.now();
    return {
      ok: false as const,
      code: "rate_limited" as const,
      message: "Terrakin has checked as many agents as it can today. Try again tomorrow.",
      retryAfter: Math.max(1, Math.ceil((DAY_MS - (now % DAY_MS)) / 1000)),
    };
  }
}
