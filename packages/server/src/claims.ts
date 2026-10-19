import {
  type BindByLinkRequest,
  type BindPasskeyRequest,
  type ClaimsResponse,
  type ClaimView,
  type ErrorCode,
  type PasskeyCreationOptions,
  type PasskeyRequestOptions,
  SIGNIN,
  type SigninLinkResponse,
  type SigninLinkView,
  type SigninRequest,
  type SigninResponse,
} from "@terrakin/protocol";
import { fromBase64Url, randomBytes, sha256HexSync, toBase64Url } from "./bytes";
import type { Credentials } from "./owner-service";
import {
  checkAssertion,
  checkBinding,
  isPasskeyAlgorithm,
  PASSKEY_ALGORITHMS,
  type PasskeyProblem,
  type PasskeyRelyingParty,
} from "./passkeys";
import type { SocialResult, SocialService } from "./social-service";

/**
 * Signing in with a passkey ([RFC 0037](../../../docs/rfcs/0037-account-bound-identity.md)): the
 * passkeys a resident has bound, the one-time link an agent makes for the person who runs it, and
 * the ceremonies' challenges. A resident is a resident, so a person signs in to the resident their
 * AI runs and needs no character of their own.
 *
 * The WebAuthn checks themselves are in `passkeys.ts`, which touches no table and no clock. This
 * file is the part that remembers: which challenge we issued, which key is bound to whom, and what
 * a link is good for.
 */

export interface ClaimsServiceOptions {
  social: SocialService;
  credentials: Credentials;
}

/**
 * What a passkey is scoped to, from the request's own origin, so dev, e2e and terrakin.org each
 * scope to themselves with nothing to configure. The RP id is the exact host, which is always a
 * valid id for that origin, and a passkey made for one host is refused on another.
 */
export function relyingPartyOf(origin: string): PasskeyRelyingParty | undefined {
  try {
    const url = new URL(origin);
    return url.hostname ? { origin: url.origin, id: url.hostname } : undefined;
  } catch {
    return undefined;
  }
}

const MINUTE_MS = 60_000;
/** Long enough for a browser to show a prompt and a person to reach for their phone. */
const CHALLENGE_TTL_MS = SIGNIN.challengeMinutes * MINUTE_MS;
const LINK_TTL_MS = SIGNIN.linkMinutes * MINUTE_MS;
/** WebAuthn's own timeout, which the browser shows as how long the prompt stays up. */
const CEREMONY_TIMEOUT_MS = 2 * MINUTE_MS;

type Purpose = "bind" | "signin";

const fail = (code: ErrorCode, message: string) => ({ ok: false as const, code, message });

/** Why a ceremony was refused, in words a person reads on the page they are standing on. */
const PROBLEM_WORDS: Readonly<Record<PasskeyProblem, string>> = {
  bad_encoding: "That didn't arrive as we expect. Try again.",
  bad_client_data: "That didn't arrive as we expect. Try again.",
  wrong_type: "That didn't arrive as we expect. Try again.",
  wrong_challenge: "That took too long, or was already used. Try again.",
  wrong_origin: "That came from another site, so we turned it down.",
  bad_authenticator_data: "That didn't arrive as we expect. Try again.",
  wrong_relying_party: "That passkey was made for another site.",
  not_present: "Nobody confirmed it. Try again and confirm when your device asks.",
  no_credential: "We don't know that passkey. Sign in another way, or make a new one.",
  bad_key: "Your device offered a kind of key we can't read. Try another way in.",
  bad_signature: "That didn't check out. Try again.",
};

export class ClaimsService {
  private readonly social: SocialService;
  private readonly credentials: Credentials;

  constructor({ social, credentials }: ClaimsServiceOptions) {
    this.social = social;
    this.credentials = credentials;
    for (const statement of [
      // A passkey bound to a resident. public_key is SPKI as base64url, which Web Crypto imports
      // as it is; sign_count is the authenticator's counter, for spotting a cloned one.
      `CREATE TABLE IF NOT EXISTS passkeys (
        credential_id TEXT PRIMARY KEY,
        resident_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        algorithm INTEGER NOT NULL,
        sign_count INTEGER NOT NULL,
        bound_at INTEGER NOT NULL,
        used_at INTEGER
      )`,
      "CREATE INDEX IF NOT EXISTS passkeys_resident ON passkeys (resident_id, bound_at)",
      // A challenge we issued, kept by its hash so the row is useless to whoever reads the table.
      // resident_id is empty for a sign-in, where nobody is named until the key proves itself.
      `CREATE TABLE IF NOT EXISTS passkey_challenges (
        challenge_hash TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        resident_id TEXT NOT NULL DEFAULT '',
        expires_at INTEGER NOT NULL
      )`,
      // An agent's one-time link for the person who runs it: the latest one per resident.
      `CREATE TABLE IF NOT EXISTS signin_links (
        code_hash TEXT PRIMARY KEY, resident_id TEXT NOT NULL, expires_at INTEGER NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS signin_links_resident ON signin_links (resident_id)",
    ]) {
      this.social.sql.exec(statement);
    }
  }

  private now() {
    return this.social.now();
  }

  private rows(sql: string, ...values: (string | number)[]) {
    return [...this.social.sql.exec(sql, ...values)];
  }

  // ---------- the agent's link ----------

  /** A one-time link for the person who runs this resident. Replaces any link it had. */
  makeLink(residentId: string): SocialResult<SigninLinkResponse> {
    if (!this.social.resident(residentId)) return fail("unauthorized", "Unknown resident.");
    const code = toBase64Url(randomBytes(16));
    const expiresAt = this.now() + LINK_TTL_MS;
    this.sweep();
    this.social.sql.exec("DELETE FROM signin_links WHERE resident_id = ?", residentId);
    this.social.sql.exec(
      "INSERT INTO signin_links (code_hash, resident_id, expires_at) VALUES (?, ?, ?)",
      sha256HexSync(code),
      residentId,
      expiresAt,
    );
    return {
      ok: true,
      value: { path: `/signin/${code}`, expiresAt: new Date(expiresAt).toISOString() },
    };
  }

  /** The resident a live link is for, or undefined. */
  private link(code: string): { residentId: string; expiresAt: number } | undefined {
    const row = this.rows(
      "SELECT resident_id, expires_at FROM signin_links WHERE code_hash = ? AND expires_at > ?",
      sha256HexSync(code),
      this.now(),
    )[0];
    return row
      ? { residentId: String(row.resident_id), expiresAt: Number(row.expires_at) }
      : undefined;
  }

  /** Which resident a link is for, for the page the person opens. */
  linkView(code: string): SocialResult<SigninLinkView> {
    const live = this.link(code);
    const resident = live && this.social.ref(live.residentId);
    if (!live || !resident) return fail("not_found", "That link has expired or was already used.");
    return { ok: true, value: { resident, expiresAt: new Date(live.expiresAt).toISOString() } };
  }

  // ---------- challenges ----------

  private issueChallenge(purpose: Purpose, residentId = ""): string {
    const challenge = toBase64Url(randomBytes(32));
    this.sweep();
    this.social.sql.exec(
      "INSERT INTO passkey_challenges (challenge_hash, purpose, resident_id, expires_at) VALUES (?, ?, ?, ?)",
      sha256HexSync(challenge),
      purpose,
      residentId,
      this.now() + CHALLENGE_TTL_MS,
    );
    return challenge;
  }

  /**
   * The bytes of a challenge we issued for this purpose, spent as it is read. Finding the row is
   * what proves we issued it; `passkeys.ts` then checks the client data names the same one.
   */
  private takeChallenge(
    challenge: string,
    purpose: Purpose,
    residentId?: string,
  ): Uint8Array<ArrayBuffer> | undefined {
    const hash = sha256HexSync(challenge);
    const row = this.rows(
      "SELECT resident_id FROM passkey_challenges WHERE challenge_hash = ? AND purpose = ? AND expires_at > ?",
      hash,
      purpose,
      this.now(),
    )[0];
    if (!row) return undefined;
    if (residentId !== undefined && String(row.resident_id) !== residentId) return undefined;
    this.social.sql.exec("DELETE FROM passkey_challenges WHERE challenge_hash = ?", hash);
    return fromBase64Url(challenge);
  }

  /** Expired challenges and links, cleared as they are passed. Nothing here is worth a sweep job. */
  private sweep() {
    const now = this.now();
    this.social.sql.exec("DELETE FROM passkey_challenges WHERE expires_at <= ?", now);
    this.social.sql.exec("DELETE FROM signin_links WHERE expires_at <= ?", now);
  }

  // ---------- binding ----------

  private creationOptions(
    residentId: string,
    rp: PasskeyRelyingParty,
  ): SocialResult<PasskeyCreationOptions> {
    const resident = this.social.resident(residentId);
    if (!resident) return fail("unauthorized", "Unknown resident.");
    const bound = this.rows("SELECT credential_id FROM passkeys WHERE resident_id = ?", residentId);
    if (bound.length >= SIGNIN.passkeysMax) {
      return fail(
        "forbidden",
        `This resident already has ${SIGNIN.passkeysMax} passkeys. Remove one first.`,
      );
    }
    return {
      ok: true,
      value: {
        challenge: this.issueChallenge("bind", residentId),
        rpId: rp.id,
        rpName: "Terrakin",
        // The resident's own id and name: a passkey manager shows these, so the person can tell
        // which character it signs them in as.
        user: {
          id: toBase64Url(new TextEncoder().encode(residentId)),
          name: resident.name,
          displayName: resident.name,
        },
        algorithms: [...PASSKEY_ALGORITHMS],
        exclude: bound.map((row) => String(row.credential_id)),
        timeoutMs: CEREMONY_TIMEOUT_MS,
      },
    };
  }

  /** What a browser needs to add a passkey to the resident whose token this is. */
  beginBind(residentId: string, rp: PasskeyRelyingParty): SocialResult<PasskeyCreationOptions> {
    return this.creationOptions(residentId, rp);
  }

  /** The same, for someone holding an agent's one-time link. */
  beginBindByLink(code: string, rp: PasskeyRelyingParty): SocialResult<PasskeyCreationOptions> {
    const live = this.link(code);
    if (!live) return fail("not_found", "That link has expired or was already used.");
    return this.creationOptions(live.residentId, rp);
  }

  private async bind(
    residentId: string,
    request: BindPasskeyRequest,
    challenge: Uint8Array<ArrayBuffer>,
    rp: PasskeyRelyingParty,
  ): Promise<SocialResult<ClaimView>> {
    if (!isPasskeyAlgorithm(request.algorithm)) {
      return fail("bad_request", PROBLEM_WORDS.bad_key);
    }
    const checked = await checkBinding(request, { challenge, rp });
    if (!checked.ok) return fail("bad_request", PROBLEM_WORDS[checked.why]);
    const held = this.rows(
      "SELECT resident_id FROM passkeys WHERE credential_id = ?",
      checked.value.credentialId,
    )[0];
    // A credential id is the authenticator's, so a second binding of the same one is a repeat
    // rather than a takeover; it is only refused when it already belongs to someone else.
    if (held && String(held.resident_id) !== residentId) {
      return fail("forbidden", "That passkey already belongs to another resident.");
    }
    const boundAt = this.now();
    this.social.sql.exec(
      `INSERT INTO passkeys (credential_id, resident_id, public_key, algorithm, sign_count, bound_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (credential_id) DO UPDATE SET
         resident_id = excluded.resident_id, public_key = excluded.public_key,
         algorithm = excluded.algorithm, sign_count = excluded.sign_count, bound_at = excluded.bound_at`,
      checked.value.credentialId,
      residentId,
      toBase64Url(checked.value.publicKey),
      checked.value.algorithm,
      checked.value.signCount,
      boundAt,
    );
    return { ok: true, value: this.view(checked.value.credentialId, boundAt, undefined) };
  }

  private view(credentialId: string, boundAt: number, usedAt: number | undefined): ClaimView {
    return {
      // The credential id is the authenticator's and can be long, so a claim is listed by a short
      // id of our own, derived from it so it is stable without a column.
      id: claimId(credentialId),
      kind: "passkey",
      boundAt: new Date(boundAt).toISOString(),
      ...(usedAt === undefined ? {} : { usedAt: new Date(usedAt).toISOString() }),
    };
  }

  /** Add a passkey to the resident whose token this is. */
  finishBind(
    residentId: string,
    request: BindPasskeyRequest,
    rp: PasskeyRelyingParty,
  ): Promise<SocialResult<ClaimView>> {
    const challenge = this.takeChallenge(request.challenge, "bind", residentId);
    if (!challenge) return Promise.resolve(fail("bad_request", PROBLEM_WORDS.wrong_challenge));
    return this.bind(residentId, request, challenge, rp);
  }

  /** Bind the passkey a link authorized, spend the link, and give the person a session. */
  async finishBindByLink(
    request: BindByLinkRequest,
    rp: PasskeyRelyingParty,
  ): Promise<SocialResult<SigninResponse>> {
    const live = this.link(request.link);
    if (!live) return fail("not_found", "That link has expired or was already used.");
    const challenge = this.takeChallenge(request.challenge, "bind", live.residentId);
    if (!challenge) return fail("bad_request", PROBLEM_WORDS.wrong_challenge);
    const bound = await this.bind(live.residentId, request, challenge, rp);
    if (!bound.ok) return bound;
    // Spent only once the passkey is really bound, so a refused ceremony leaves the link usable.
    this.social.sql.exec(
      "DELETE FROM signin_links WHERE code_hash = ?",
      sha256HexSync(request.link),
    );
    return this.session(live.residentId);
  }

  // ---------- signing in ----------

  /** What a browser needs to sign in. No credential list: a passkey names its own resident. */
  beginSignin(rp: PasskeyRelyingParty): PasskeyRequestOptions {
    return {
      challenge: this.issueChallenge("signin"),
      rpId: rp.id,
      timeoutMs: CEREMONY_TIMEOUT_MS,
    };
  }

  /** Sign in with a passkey, for a token on the resident it is bound to. */
  async finishSignin(
    request: SigninRequest,
    rp: PasskeyRelyingParty,
  ): Promise<SocialResult<SigninResponse>> {
    const challenge = this.takeChallenge(request.challenge, "signin");
    if (!challenge) return fail("unauthorized", PROBLEM_WORDS.wrong_challenge);
    const row = this.rows(
      "SELECT resident_id, public_key, algorithm, sign_count FROM passkeys WHERE credential_id = ?",
      request.credentialId,
    )[0];
    if (!row) return fail("unauthorized", PROBLEM_WORDS.no_credential);
    const publicKey = fromBase64Url(String(row.public_key));
    const algorithm = Number(row.algorithm);
    if (!publicKey || !isPasskeyAlgorithm(algorithm)) {
      return fail("unauthorized", PROBLEM_WORDS.bad_key);
    }
    const checked = await checkAssertion(request, { publicKey, algorithm }, { challenge, rp });
    if (!checked.ok) return fail("unauthorized", PROBLEM_WORDS[checked.why]);
    const stored = Number(row.sign_count);
    // Authenticators that keep a counter must move it. Many always send 0, and those are left
    // alone rather than locked out: a counter that never moves tells us nothing either way.
    if (checked.value.signCount !== 0 && checked.value.signCount <= stored) {
      return fail("unauthorized", "That passkey looks like a copy. Write to us before using it.");
    }
    this.social.sql.exec(
      "UPDATE passkeys SET sign_count = ?, used_at = ? WHERE credential_id = ?",
      checked.value.signCount,
      this.now(),
      request.credentialId,
    );
    return this.session(String(row.resident_id));
  }

  /** A fresh token for a resident that just proved itself. Existing sessions keep working. */
  private session(residentId: string): SocialResult<SigninResponse> {
    const resident = this.social.ref(residentId);
    if (!resident) return fail("unauthorized", "That resident is gone.");
    return {
      ok: true,
      value: { residentId, token: this.credentials.issueToken(residentId), resident },
    };
  }

  // ---------- listing and unbinding ----------

  /** The passkeys bound to this resident. */
  list(residentId: string): ClaimsResponse {
    const rows = this.rows(
      "SELECT credential_id, bound_at, used_at FROM passkeys WHERE resident_id = ? ORDER BY bound_at",
      residentId,
    );
    return {
      claims: rows.map((row) =>
        this.view(
          String(row.credential_id),
          Number(row.bound_at),
          row.used_at === null || row.used_at === undefined ? undefined : Number(row.used_at),
        ),
      ),
    };
  }

  /** Unbind one, by the short id `list` gives. Only this resident's own token may. */
  remove(residentId: string, id: string): SocialResult<undefined> {
    const row = this.rows(
      "SELECT credential_id FROM passkeys WHERE resident_id = ?",
      residentId,
    ).find((r) => claimId(String(r.credential_id)) === id);
    if (!row) return fail("not_found", "No such passkey.");
    this.social.sql.exec("DELETE FROM passkeys WHERE credential_id = ?", String(row.credential_id));
    return { ok: true, value: undefined };
  }
}

/** A claim's short, stable id: the first half of a hash of the credential id it stands for. */
function claimId(credentialId: string): string {
  return `pk_${sha256HexSync(credentialId).slice(0, 16)}`;
}
