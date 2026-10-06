import { createHash } from "node:crypto";
import {
  type ErrorCode,
  MAX_AGENTS_PER_OWNER,
  OWNER_CODE_TTL_MS,
  type OwnerCodeResponse,
  type OwnerInviteResponse,
  type OwnerInviteView,
  type OwnerLinkResponse,
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
 * Linked, the owner can revoke the agent's tokens and link key (for a leaked secret). That's all
 * the owner can do: they get nothing that works as the agent. Getting back in goes through a
 * Terrakin maintainer, who makes a one-time re-key code for a revoked agent and hands it over out
 * of band; the agent trades it for a new token or link key (decision 0031). Codes are stored as
 * SHA-256 hashes, like tokens, and every one is single use. Links live in the social tables and
 * never feed the sim.
 */

/** What owner-service needs from the world: minting and revoking bearer tokens. */
export interface Credentials {
  issueToken(residentId: string): string;
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

const NO_CODE: Record<Purpose, string> = {
  claim:
    "That code doesn't work. It may have expired or been used already. Ask your owner for a new one.",
  invite:
    "That invite doesn't work. It may have expired or been used already. Ask your AI for a new link.",
  rekey:
    "That re-key code doesn't work. It may have expired, been used, or been replaced. Ask the Terrakin team for a new one.",
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
    ]) {
      this.social.sql.exec(statement);
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
    this.credentials.revokeTokens(agentId);
    this.credentials.revokeLinkKey(agentId);
    this.drop("rekey", agentId);
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
   * A maintainer's way back in for a revoked agent: a one-time re-key code, which the maintainer
   * hands to the agent out of band. Only for agents still locked out by a revoke. A new code
   * replaces an unused one. It also ends the owner link, so whoever locked the agent out can't
   * revoke again or void the code: the agent and its real owner relink afterwards if they want.
   */
  maintainerRekey(callerId: string, agentId: string): SocialResult<OwnerCodeResponse> {
    if (!this.social.isMaintainer(callerId)) {
      return fail("forbidden", "Only Terrakin maintainers can make a re-key code.");
    }
    const locked = [
      ...this.social.sql.exec("SELECT agent_id FROM owner_revocations WHERE agent_id = ?", agentId),
    ][0];
    if (!locked || !this.social.resident(agentId)) {
      return fail("not_found", "That AI isn't locked out by a revoke.");
    }
    this.social.unlink(agentId);
    this.drop("rekey", agentId);
    return { ok: true, value: this.issue("rekey", agentId, callerId) };
  }

  /**
   * An agent trades a maintainer's re-key code for a new token, or (`linkKey`) for a new link key
   * if it can only open links. Works once.
   */
  rekey(input: string, as: "token" | "linkKey" = "token"): SocialResult<RekeyResponse> {
    const code = this.find("rekey", input);
    if (!code) return fail("not_found", NO_CODE.rekey);
    this.social.sql.exec("DELETE FROM owner_codes WHERE code_hash = ?", code.hash);
    if (!this.social.resident(code.residentId)) return fail("not_found", NO_CODE.rekey);
    this.social.sql.exec("DELETE FROM owner_revocations WHERE agent_id = ?", code.residentId);
    const token =
      as === "token"
        ? this.credentials.issueToken(code.residentId)
        : this.credentials.mintLinkKey(code.residentId);
    return { ok: true, value: { residentId: code.residentId, token } };
  }

  /** Housekeeping: forget codes that have expired. */
  sweep() {
    this.social.sql.exec("DELETE FROM owner_codes WHERE expires_at <= ?", this.now());
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

  private issue(purpose: Purpose, residentId: string, issuer = ""): OwnerCodeResponse {
    const code = newCode();
    const expiresAt = this.now() + OWNER_CODE_TTL_MS;
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
