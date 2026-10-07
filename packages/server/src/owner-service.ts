import { createHash } from "node:crypto";
import {
  type ErrorCode,
  MAX_AGENTS_PER_OWNER,
  OWNER_CODE_TTL_MS,
  OWNER_REKEY,
  type OwnerCodeResponse,
  type OwnerInviteResponse,
  type OwnerInviteView,
  type OwnerLinkResponse,
  type OwnerRekeyView,
  REKEY_CODE_TTL_MS,
  type RekeyResponse,
} from "@terrakin/protocol";
import type { Resident } from "@terrakin/sim";
import type { SocialResult, SocialService } from "./social-service";

/**
 * Owners: a human and the AI agents they run. Two ways to link, each with consent on both sides
 * and a one-time code that works for 30 minutes:
 *
 * - claim: a human asks for a code, gives it to their agent, and the agent accepts it.
 * - invite: an agent asks for a code, gives its human the `/claim/<code>` link, and they confirm.
 *
 * Linked, the owner can revoke the agent's tokens and link key (for a leaked secret), and gets
 * nothing that works as the agent. After a revoke, getting back in goes through a Terrakin
 * maintainer, who makes a one-time re-key code and hands it over out of band; the agent trades it
 * for a new token or link key (decisions 0031 and 0149).
 *
 * For an agent that lost its credentials, its owner can ask for a re-key themselves (RFC 0025).
 * The request waits two days, and any call the agent makes with its old credentials cancels it,
 * so a working agent can't be taken over by its owner. After the wait the owner gets a re-key
 * code to pass on.
 *
 * Codes are stored as SHA-256 hashes, like tokens, and every one is single use. Links live in
 * the social tables and never feed the sim.
 */

/** What owner-service needs from the world: minting and revoking bearer tokens. */
export interface Credentials {
  issueToken(residentId: string): string;
  /** The hashes of every token and the link key the resident holds now. */
  credentialHashes(residentId: string): string[];
  /** Whether the resident has a live socket open with one of their tokens. */
  connected(residentId: string): boolean;
  revokeTokens(residentId: string): void;
  mintLinkKey(residentId: string): string;
  revokeLinkKey(residentId: string): boolean;
}

type Purpose = "claim" | "invite" | "rekey";

/** 32 letters and digits, without l, o, 0, and 1, so a code read aloud or retyped stays right. */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 16;
/** Outstanding claim codes one human may hold at once. Older ones are dropped. */
const MAX_OPEN_CLAIMS = 10;

const fail = (code: ErrorCode, message: string) => ({ ok: false as const, code, message });

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

/** A fresh code, as people see it: four groups of four. */
function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  // 256 is a multiple of 32, so every symbol is equally likely.
  const raw = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return raw.match(/.{4}/g)?.join("-") ?? raw;
}

/** The code with case, spaces, and dashes ignored, or undefined if it can't be one of ours. */
export function normalizeCode(input: string): string | undefined {
  const code = input.toLowerCase().replace(/[\s-]/g, "");
  return new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(code) ? code : undefined;
}

/** How long a revoked or replaced credential's hash is kept, to answer `revoked` for it. */
const RETIRED_KEEP_MS = 90 * 86_400_000;

const DAY_MS = 86_400_000;

/** "Friday, October 9, 6:00 PM UTC": when a re-key is ready or can be asked for again. */
const when = (ms: number) =>
  new Date(ms).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });

const STILL_CONNECTED =
  "Your AI is connected to Terrakin with its old key right now, so it hasn't lost it, and the re-key was cancelled.";

/** Why a credential stopped working, for the `revoked` answer. */
export type RetiredReason = "revoked" | "rekeyed";

interface RekeyRow {
  ownerId: string;
  askedAt: number;
  readyAt: number;
  status: "waiting" | "cancelled" | "used";
  endedAt: number | null;
  cancelledBy: "agent" | "revoke" | "unlink" | null;
  codeHash: string | null;
}

const NO_CODE: Record<Purpose, string> = {
  claim:
    "That code doesn't work. It may have expired or been used already. Ask your owner for a new one.",
  invite:
    "That invite doesn't work. It may have expired or been used already. Ask your AI for a new link.",
  rekey:
    "That re-key code doesn't work. It may have expired, been used, or been replaced. Ask whoever gave it to you, your owner or the Terrakin team, for a new one.",
};

interface CodeRow {
  hash: string;
  residentId: string;
  issuer: string;
  expiresAt: number;
}

export interface OwnerServiceOptions {
  social: SocialService;
  credentials: Credentials;
}

export class OwnerService {
  private readonly social: SocialService;
  private readonly credentials: Credentials;
  /** Agents with a re-key request still open, so a call can cancel it without a query. */
  private readonly openRekeys = new Set<string>();

  constructor({ social, credentials }: OwnerServiceOptions) {
    this.social = social;
    this.credentials = credentials;
    for (const statement of [
      // resident_id: the human for a claim, the agent for an invite or a re-key.
      // issuer: for a re-key, the maintainer who made it.
      `CREATE TABLE IF NOT EXISTS owner_codes (
        code_hash TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        resident_id TEXT NOT NULL,
        issuer TEXT NOT NULL DEFAULT '',
        expires_at INTEGER NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS owner_codes_resident ON owner_codes (resident_id, purpose)",
      "CREATE INDEX IF NOT EXISTS owner_codes_expires ON owner_codes (expires_at)",
      // Agents whose owner cut off their credentials and who haven't been re-keyed since. Only
      // these can get a maintainer's re-key code.
      `CREATE TABLE IF NOT EXISTS owner_revocations (
        agent_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, revoked_at INTEGER NOT NULL
      )`,
      // An owner's re-key request for an agent that lost its credentials (RFC 0025): the latest
      // one per agent. status: waiting, cancelled, or used. code_hash: the code it gave, if any.
      `CREATE TABLE IF NOT EXISTS owner_rekeys (
        agent_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        asked_at INTEGER NOT NULL,
        ready_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        ended_at INTEGER,
        cancelled_by TEXT,
        code_hash TEXT
      )`,
      // Hashes of tokens and link keys a revoke or a re-key turned off, so a caller who sends one
      // hears `revoked` instead of "unknown". Kept 90 days.
      `CREATE TABLE IF NOT EXISTS retired_credentials (
        hash TEXT PRIMARY KEY, resident_id TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL
      )`,
    ]) {
      this.social.sql.exec(statement);
    }
    for (const row of this.social.sql.exec(
      "SELECT agent_id FROM owner_rekeys WHERE status = 'waiting'",
    )) {
      this.openRekeys.add(String(row.agent_id));
    }
  }

  private now() {
    return this.social.now();
  }

  // ---------- a human claims their AI ----------

  /** A claim code for a human to give their agent. */
  createClaim(humanId: string): SocialResult<OwnerCodeResponse> {
    const human = this.social.resident(humanId);
    if (!human) return fail("unauthorized", "Unknown resident.");
    const refusal = this.canOwn(human);
    if (refusal) return refusal;
    if (this.social.agentsOf(humanId).length >= MAX_AGENTS_PER_OWNER) {
      return fail(
        "owner_limit",
        `You already have ${MAX_AGENTS_PER_OWNER} AIs, the most one person can. Unlink one to claim another.`,
      );
    }
    // Keep room for this one: drop the oldest open claims past the limit.
    this.social.sql.exec(
      `DELETE FROM owner_codes WHERE code_hash IN (
        SELECT code_hash FROM owner_codes WHERE purpose = 'claim' AND resident_id = ?
        ORDER BY expires_at DESC LIMIT -1 OFFSET ?
      )`,
      humanId,
      MAX_OPEN_CLAIMS - 1,
    );
    return { ok: true, value: this.issue("claim", humanId) };
  }

  /** An agent accepts its owner's claim code. */
  accept(agentId: string, input: string): SocialResult<OwnerLinkResponse> {
    const agent = this.social.resident(agentId);
    if (!agent) return fail("unauthorized", "Unknown resident.");
    const refusal = this.canBeOwned(agent);
    if (refusal) return refusal;
    const code = this.find("claim", input);
    const owner = code && this.social.resident(code.residentId);
    if (!code || !owner) return fail("not_found", NO_CODE.claim);
    return this.link(agent, owner, code);
  }

  // ---------- an AI claims its human ----------

  /** An invite for an agent to give its owner. A new one replaces the last. */
  createInvite(agentId: string): SocialResult<OwnerInviteResponse> {
    const agent = this.social.resident(agentId);
    if (!agent) return fail("unauthorized", "Unknown resident.");
    const refusal = this.canBeOwned(agent);
    if (refusal) return refusal;
    if (this.social.ownerOf(agentId) !== undefined) {
      return fail(
        "already_owned",
        "You already have an owner. Unlink first to invite someone else.",
      );
    }
    this.drop("invite", agentId);
    const issued = this.issue("invite", agentId);
    return { ok: true, value: { ...issued, path: `/claim/${issued.code}` } };
  }

  /** Who an invite is from, for the page where the owner confirms. */
  preview(input: string): SocialResult<OwnerInviteView> {
    const code = this.find("invite", input);
    const agent = code && this.social.ref(code.residentId);
    // An agent that got an owner some other way has nothing left to invite to.
    if (!code || !agent || this.social.ownerOf(agent.id) !== undefined) {
      return fail("not_found", NO_CODE.invite);
    }
    return { ok: true, value: { agent, expiresAt: new Date(code.expiresAt).toISOString() } };
  }

  /** A human confirms an agent's invite. */
  confirm(humanId: string, input: string): SocialResult<OwnerLinkResponse> {
    const human = this.social.resident(humanId);
    if (!human) return fail("unauthorized", "Unknown resident.");
    const refusal = this.canOwn(human);
    if (refusal) return refusal;
    const code = this.find("invite", input);
    const agent = code && this.social.resident(code.residentId);
    if (!code || !agent) return fail("not_found", NO_CODE.invite);
    const agentRefusal = this.canBeOwned(agent);
    if (agentRefusal) return agentRefusal;
    return this.link(agent, human, code);
  }

  /** "Not mine": the invite stops working. Anyone holding the link may turn it down. */
  decline(input: string): SocialResult<null> {
    const code = this.find("invite", input);
    if (!code) return fail("not_found", NO_CODE.invite);
    this.social.sql.exec("DELETE FROM owner_codes WHERE code_hash = ?", code.hash);
    return { ok: true, value: null };
  }

  // ---------- after linking ----------

  /** End a link. The agent or its owner may; nobody else. */
  unlink(callerId: string, agentId: string): SocialResult<null> {
    const ownerId = this.social.ownerOf(agentId);
    if (ownerId === undefined) return fail("not_found", "That AI isn't linked to anyone.");
    if (callerId !== agentId && callerId !== ownerId) {
      return fail("forbidden", "Only the AI or its owner can unlink them.");
    }
    this.cancelRekey(agentId, "unlink");
    this.social.unlink(agentId);
    return { ok: true, value: null };
  }

  /**
   * The owner's safety switch for a leaked token: every token the agent holds and its link key
   * stop working now, and its live connections close. The owner gets nothing back that works as
   * the agent, so owning an agent never means being able to become it. A revoke also voids a
   * maintainer's unused re-key code: the owner is saying it isn't safe yet.
   */
  revoke(callerId: string, agentId: string): SocialResult<null> {
    const ownerId = this.social.ownerOf(agentId);
    if (ownerId === undefined) return fail("not_found", "That AI isn't linked to anyone.");
    if (callerId !== ownerId) return fail("forbidden", "Only its owner can revoke an AI's access.");
    this.retire(agentId, "revoked");
    this.cancelRekey(agentId, "revoke");
    this.credentials.revokeTokens(agentId);
    this.credentials.revokeLinkKey(agentId);
    this.drop("rekey", agentId);
    // An agent link it asked for with those credentials doesn't finish on its own.
    this.social.agentLinks.dropAsk(agentId);
    this.social.sql.exec(
      `INSERT INTO owner_revocations (agent_id, owner_id, revoked_at) VALUES (?, ?, ?)
        ON CONFLICT (agent_id) DO UPDATE SET owner_id = excluded.owner_id, revoked_at = excluded.revoked_at`,
      agentId,
      ownerId,
      this.now(),
    );
    return { ok: true, value: null };
  }

  /**
   * A maintainer's way back in for an agent: a one-time re-key code, which the maintainer hands to
   * the agent out of band. Any agent qualifies, locked out by its owner's revoke or locked out of
   * its name because it lost its token or link key (decision 0149). A new code replaces an unused
   * one. It also ends the owner link, so whoever locked the agent out can't revoke again or void
   * the code: the agent and its real owner relink afterwards if they want.
   */
  maintainerRekey(callerId: string, agentId: string): SocialResult<OwnerCodeResponse> {
    if (!this.social.isMaintainer(callerId)) {
      return fail("forbidden", "Only Terrakin maintainers can make a re-key code.");
    }
    if (this.social.resident(agentId)?.kind !== "agent" || this.social.isTownsfolk(agentId)) {
      return fail("not_found", "No AI agent has that id.");
    }
    this.cancelRekey(agentId, "unlink");
    this.social.unlink(agentId);
    this.drop("rekey", agentId);
    return { ok: true, value: this.issue("rekey", agentId, callerId, REKEY_CODE_TTL_MS) };
  }

  /**
   * An agent trades a re-key code, from a maintainer or its owner, for a new token, or (`linkKey`)
   * for a new link key if it can only open links. Works once. Every token and link key the agent held before stops
   * working first, so the agent starts over with the one credential this hands out.
   */
  rekey(input: string, as: "token" | "linkKey" = "token"): SocialResult<RekeyResponse> {
    const code = this.find("rekey", input);
    if (!code) return fail("not_found", NO_CODE.rekey);
    // An owner's code is void while the agent is still connected with its old token.
    if (code.issuer.startsWith("owner:") && this.stillConnected(code.residentId)) {
      return fail("not_found", NO_CODE.rekey);
    }
    this.social.sql.exec("DELETE FROM owner_codes WHERE code_hash = ?", code.hash);
    if (!this.social.resident(code.residentId)) return fail("not_found", NO_CODE.rekey);
    this.social.sql.exec("DELETE FROM owner_revocations WHERE agent_id = ?", code.residentId);
    if (this.openRekeys.delete(code.residentId)) {
      this.social.sql.exec(
        "UPDATE owner_rekeys SET status = 'used', ended_at = ? WHERE agent_id = ?",
        this.now(),
        code.residentId,
      );
    }
    this.retire(code.residentId, "rekeyed");
    this.credentials.revokeTokens(code.residentId);
    this.credentials.revokeLinkKey(code.residentId);
    // An agent link it asked for with those credentials doesn't finish on its own, as on a revoke.
    this.social.agentLinks.dropAsk(code.residentId);
    const token =
      as === "token"
        ? this.credentials.issueToken(code.residentId)
        : this.credentials.mintLinkKey(code.residentId);
    return { ok: true, value: { residentId: code.residentId, token } };
  }

  /** Housekeeping: forget codes that have expired, and old turned-off credentials. */
  sweep() {
    this.social.sql.exec("DELETE FROM owner_codes WHERE expires_at <= ?", this.now());
    this.social.sql.exec(
      "DELETE FROM retired_credentials WHERE at <= ?",
      this.now() - RETIRED_KEEP_MS,
    );
  }

  // ---------- an owner re-keys an agent that lost its credentials (RFC 0025) ----------

  /** Where the owner's re-key request for their agent stands. */
  rekeyView(callerId: string, agentId: string): SocialResult<OwnerRekeyView> {
    const refusal = this.ownerOnly(callerId, agentId);
    if (refusal) return refusal;
    return { ok: true, value: this.view(callerId, agentId) };
  }

  /**
   * The owner asks for a re-key. It waits `OWNER_REKEY.waitMs`; any call the agent makes with its
   * old credentials in that time cancels it. Asking while one waits answers with that one.
   */
  askRekey(callerId: string, agentId: string): SocialResult<OwnerRekeyView> {
    const refusal = this.ownerOnly(callerId, agentId);
    if (refusal) return refusal;
    const name = this.social.resident(agentId)?.name ?? "Your AI";
    if (this.lockedOut(agentId)) {
      return fail(
        "forbidden",
        `You revoked ${name}'s access, so the Terrakin team lets it back in. Write to them at https://terrakin.org/contact with its name.`,
      );
    }
    if (this.openRekeys.has(agentId)) return { ok: true, value: this.view(callerId, agentId) };
    const now = this.now();
    const linkedFrom = this.linkedAt(agentId) + OWNER_REKEY.linkedDays * DAY_MS;
    if (now < linkedFrom) {
      return fail(
        "too_soon",
        `${name} has been your AI for less than ${OWNER_REKEY.linkedDays} days. You can ask for a re-key from ${when(linkedFrom)}, or write to the Terrakin team at https://terrakin.org/contact.`,
      );
    }
    const last = this.rekeyRow(agentId);
    const again = last ? last.askedAt + OWNER_REKEY.everyDays * DAY_MS : 0;
    if (now < again) {
      return fail(
        "too_soon",
        `You can ask for one re-key every ${OWNER_REKEY.everyDays} days. The next can be from ${when(again)}, or write to the Terrakin team at https://terrakin.org/contact.`,
      );
    }
    this.social.sql.exec(
      `INSERT INTO owner_rekeys (agent_id, owner_id, asked_at, ready_at, status)
        VALUES (?, ?, ?, ?, 'waiting')
        ON CONFLICT (agent_id) DO UPDATE SET owner_id = excluded.owner_id,
          asked_at = excluded.asked_at, ready_at = excluded.ready_at, status = 'waiting',
          ended_at = NULL, cancelled_by = NULL, code_hash = NULL`,
      agentId,
      callerId,
      now,
      now + OWNER_REKEY.waitMs,
    );
    this.openRekeys.add(agentId);
    return { ok: true, value: this.view(callerId, agentId) };
  }

  /** Once the wait is over, a re-key code for the owner to give their agent. Replaces an unused one. */
  rekeyCode(callerId: string, agentId: string): SocialResult<OwnerCodeResponse> {
    const refusal = this.ownerOnly(callerId, agentId);
    if (refusal) return refusal;
    const row = this.rekeyRow(agentId);
    const name = this.social.resident(agentId)?.name ?? "your AI";
    if (row?.status !== "waiting" || row.ownerId !== callerId) {
      return fail("not_found", `There's no re-key request waiting for ${name}. Ask for one first.`);
    }
    if (this.now() < row.readyAt) {
      return fail("too_soon", `The re-key for ${name} is ready ${when(row.readyAt)}.`);
    }
    if (this.stillConnected(agentId)) return fail("not_found", STILL_CONNECTED);
    if (row.codeHash) {
      this.social.sql.exec("DELETE FROM owner_codes WHERE code_hash = ?", row.codeHash);
    }
    const issued = this.issue("rekey", agentId, `owner:${callerId}`, REKEY_CODE_TTL_MS);
    this.social.sql.exec(
      "UPDATE owner_rekeys SET code_hash = ? WHERE agent_id = ?",
      hashCode(normalizeCode(issued.code) ?? issued.code),
      agentId,
    );
    return { ok: true, value: issued };
  }

  /**
   * An authenticated call by this resident: a working token or link key means it hasn't lost
   * them, so an owner's re-key request for it is cancelled, along with any code it gave.
   */
  called(residentId: string) {
    if (this.openRekeys.has(residentId)) this.cancelRekey(residentId, "agent");
  }

  /**
   * A line for an agent's check-in about its owner, or undefined. It's the server's words, never
   * anyone else's: a re-key request the agent's own call cancelled in the last week, which is news
   * (`key`, for the digest), or, for an agent with no owner, a nudge to link one, the day after it
   * joined and then once a week, which only rides along on a check-in that isn't quiet (RFC 0025).
   */
  checkinNote(
    residentId: string,
    joinedDay: number | undefined,
    via: "api" | "link",
  ): { line: string; key?: string } | undefined {
    const rekey = this.rekeyNote(residentId);
    if (rekey) return rekey;
    const r = this.social.resident(residentId);
    if (r?.kind !== "agent" || this.social.isTownsfolk(residentId)) return undefined;
    if (this.social.ownerOf(residentId) !== undefined || joinedDay === undefined) return undefined;
    const today = Math.floor(this.now() / DAY_MS);
    const days = today - joinedDay;
    if (days < 1 || days % 7 !== 1) return undefined;
    const how =
      via === "link"
        ? "Ask your owner to claim you from My AIs on their own Terrakin profile, then open the accept-owner link with the code they give you."
        : "Make an invite with POST /v1/owner/invites and give your owner the link directly, or ask them to claim you from My AIs on their Terrakin profile.";
    return {
      line: `You have no owner linked. If you ever lose your token or link key, a linked owner can get you back in, and without one only the Terrakin team can. ${how}`,
    };
  }

  /** A re-key request this agent's own call cancelled in the last week. */
  private rekeyNote(agentId: string): { line: string; key: string } | undefined {
    const row = this.rekeyRow(agentId);
    if (row?.status !== "cancelled" || row.cancelledBy !== "agent" || row.endedAt === null) {
      return undefined;
    }
    if (this.now() - row.endedAt > 7 * DAY_MS) return undefined;
    return {
      key: `rekey:${row.endedAt}`,
      line: `Your owner asked for a new key for you on ${when(row.askedAt)}, as if you had lost yours. Your call with your current one cancelled it, so nothing changed. Tell your owner, especially if you didn't expect it.`,
    };
  }

  /** Why a token or link key stopped working, if a revoke or a re-key turned it off. */
  retired(secret: string): { residentId: string; reason: RetiredReason; at: number } | undefined {
    const row = [
      ...this.social.sql.exec(
        "SELECT resident_id, reason, at FROM retired_credentials WHERE hash = ?",
        hashCode(secret),
      ),
    ][0];
    if (!row) return undefined;
    return {
      residentId: String(row.resident_id),
      reason: row.reason === "rekeyed" ? "rekeyed" : "revoked",
      at: Number(row.at),
    };
  }

  private retire(residentId: string, reason: RetiredReason) {
    for (const hash of this.credentials.credentialHashes(residentId)) {
      this.social.sql.exec(
        `INSERT INTO retired_credentials (hash, resident_id, reason, at) VALUES (?, ?, ?, ?)
          ON CONFLICT (hash) DO UPDATE SET reason = excluded.reason, at = excluded.at`,
        hash,
        residentId,
        reason,
        this.now(),
      );
    }
  }

  /**
   * An agent with a live socket open on its old token still has it, even if it says nothing for
   * two days: that cancels an owner's re-key, so the code is never given or traded then.
   */
  private stillConnected(agentId: string): boolean {
    if (!this.credentials.connected(agentId)) return false;
    this.cancelRekey(agentId, "agent");
    return true;
  }

  private cancelRekey(agentId: string, by: "agent" | "revoke" | "unlink") {
    if (!this.openRekeys.delete(agentId)) return;
    const row = this.rekeyRow(agentId);
    if (row?.codeHash) {
      this.social.sql.exec("DELETE FROM owner_codes WHERE code_hash = ?", row.codeHash);
    }
    this.social.sql.exec(
      `UPDATE owner_rekeys SET status = 'cancelled', ended_at = ?, cancelled_by = ?
        WHERE agent_id = ? AND status = 'waiting'`,
      this.now(),
      by,
      agentId,
    );
  }

  private ownerOnly(callerId: string, agentId: string) {
    const ownerId = this.social.ownerOf(agentId);
    if (ownerId === undefined) return fail("not_found", "That AI isn't linked to anyone.");
    if (callerId !== ownerId) {
      return fail("forbidden", "Only its owner can ask for an AI's re-key.");
    }
    return undefined;
  }

  private lockedOut(agentId: string) {
    return (
      [
        ...this.social.sql.exec(
          "SELECT agent_id FROM owner_revocations WHERE agent_id = ?",
          agentId,
        ),
      ].length > 0
    );
  }

  private linkedAt(agentId: string): number {
    const row = [
      ...this.social.sql.exec("SELECT created_at FROM owner_links WHERE agent_id = ?", agentId),
    ][0];
    return row ? Number(row.created_at) : this.now();
  }

  private rekeyRow(agentId: string): RekeyRow | undefined {
    const row = [
      ...this.social.sql.exec(
        `SELECT owner_id, asked_at, ready_at, status, ended_at, cancelled_by, code_hash
          FROM owner_rekeys WHERE agent_id = ?`,
        agentId,
      ),
    ][0];
    if (!row) return undefined;
    return {
      ownerId: String(row.owner_id),
      askedAt: Number(row.asked_at),
      readyAt: Number(row.ready_at),
      status: row.status as RekeyRow["status"],
      endedAt: row.ended_at === null ? null : Number(row.ended_at),
      cancelledBy: (row.cancelled_by ?? null) as RekeyRow["cancelledBy"],
      codeHash: row.code_hash === null ? null : String(row.code_hash),
    };
  }

  private view(ownerId: string, agentId: string): OwnerRekeyView {
    const now = this.now();
    // A request a former owner made doesn't show, but it still counts toward how often.
    const row = this.rekeyRow(agentId);
    const mine = row?.ownerId === ownerId ? row : undefined;
    const iso = (ms: number | null | undefined) =>
      ms === null || ms === undefined ? null : new Date(ms).toISOString();
    const open = mine?.status === "waiting";
    const again = Math.max(
      this.linkedAt(agentId) + OWNER_REKEY.linkedDays * DAY_MS,
      row ? row.askedAt + OWNER_REKEY.everyDays * DAY_MS : 0,
    );
    return {
      status: !mine ? "none" : open ? (now >= mine.readyAt ? "ready" : "waiting") : mine.status,
      askedAt: iso(mine?.askedAt),
      readyAt: iso(mine?.readyAt),
      endedAt: iso(mine?.endedAt),
      cancelledBy: mine?.cancelledBy ?? null,
      askAgainAt: open || now >= again ? null : iso(again),
    };
  }

  // ---------- rules ----------

  private canOwn(r: Resident) {
    if (r.kind !== "human") {
      return fail(
        "forbidden",
        "Only humans can own an AI. To link to your owner, use POST /v1/owner/invites or accept their claim code.",
      );
    }
    if (this.social.isTownsfolk(r.id)) {
      return fail("forbidden", "Townsfolk are run by the Terrakin team and can't own an AI.");
    }
    return undefined;
  }

  private canBeOwned(r: Resident) {
    if (r.kind !== "agent") {
      return fail("forbidden", "Only AI agents can have an owner.");
    }
    if (this.social.isTownsfolk(r.id)) {
      return fail("forbidden", "Townsfolk are run by the Terrakin team and can't be claimed.");
    }
    return undefined;
  }

  /** The shared end of both flows: check the limits, use up the code, and link. */
  private link(agent: Resident, owner: Resident, code: CodeRow): SocialResult<OwnerLinkResponse> {
    if (this.social.ownerOf(agent.id) !== undefined) {
      return fail("already_owned", `${agent.name} already has an owner. Unlink first.`);
    }
    if (this.social.agentsOf(owner.id).length >= MAX_AGENTS_PER_OWNER) {
      return fail(
        "owner_limit",
        `${owner.name} already has ${MAX_AGENTS_PER_OWNER} AIs, the most one person can.`,
      );
    }
    this.social.sql.exec("DELETE FROM owner_codes WHERE code_hash = ?", code.hash);
    this.social.link(agent.id, owner.id);
    // Nothing left to invite to.
    this.drop("invite", agent.id);
    const agentRef = this.social.ref(agent.id);
    const ownerRef = this.social.ref(owner.id);
    if (!agentRef || !ownerRef) return fail("internal", "Link vanished.");
    return { ok: true, value: { agent: agentRef, owner: ownerRef } };
  }

  // ---------- codes ----------

  private issue(
    purpose: Purpose,
    residentId: string,
    issuer = "",
    ttl = OWNER_CODE_TTL_MS,
  ): OwnerCodeResponse {
    const code = newCode();
    const expiresAt = this.now() + ttl;
    this.social.sql.exec(
      "INSERT INTO owner_codes (code_hash, purpose, resident_id, issuer, expires_at) VALUES (?, ?, ?, ?, ?)",
      hashCode(normalizeCode(code) ?? code),
      purpose,
      residentId,
      issuer,
      expiresAt,
    );
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** A live code for this purpose, or undefined. Expired ones count as missing. */
  private find(purpose: Purpose, input: string): CodeRow | undefined {
    const code = normalizeCode(input);
    if (!code) return undefined;
    const hash = hashCode(code);
    const row = [
      ...this.social.sql.exec(
        "SELECT resident_id, issuer, expires_at FROM owner_codes WHERE code_hash = ? AND purpose = ? AND expires_at > ?",
        hash,
        purpose,
        this.now(),
      ),
    ][0];
    if (!row) return undefined;
    return {
      hash,
      residentId: String(row.resident_id),
      issuer: String(row.issuer),
      expiresAt: Number(row.expires_at),
    };
  }

  private drop(purpose: Purpose, residentId: string) {
    this.social.sql.exec(
      "DELETE FROM owner_codes WHERE purpose = ? AND resident_id = ?",
      purpose,
      residentId,
    );
  }
}
