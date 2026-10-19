/**
 * Passkeys ([RFC 0037](../../../docs/rfcs/0037-account-bound-identity.md)): the WebAuthn checks a
 * binding and a sign-in make, and nothing else. No table, no clock, no SQL: a caller hands in the
 * bytes and the challenge it issued, and gets back what to store or why to refuse.
 *
 * There is no CBOR parser here on purpose. Registration sends the credential's public key as SPKI
 * and its authenticator data flat, rather than the attestation object that wraps the key in CBOR,
 * so the only bytes this file walks are authenticator data's fixed header and an ECDSA signature's
 * ASN.1 wrapper. Both are hostile input, so both read their lengths before using them and refuse
 * rather than throw (`packages/server/AGENTS.md`, uploads are hostile bytes).
 */
import { fromBase64Url, sameBytes, sha256Bytes } from "./bytes";

/** Why a binding or a sign-in was refused. Each is a sentence the caller turns into a message. */
export type PasskeyProblem =
  | "bad_encoding"
  | "bad_client_data"
  | "wrong_type"
  | "wrong_challenge"
  | "wrong_origin"
  | "bad_authenticator_data"
  | "wrong_relying_party"
  | "not_present"
  | "not_verified"
  | "no_credential"
  | "bad_key"
  | "bad_signature";

/** The COSE algorithms a passkey may use here: ES256 and RS256, which cover every platform one. */
export const PASSKEY_ALGORITHMS = [-7, -257] as const;
export type PasskeyAlgorithm = (typeof PASSKEY_ALGORITHMS)[number];
export const isPasskeyAlgorithm = (alg: unknown): alg is PasskeyAlgorithm =>
  (PASSKEY_ALGORITHMS as readonly number[]).includes(alg as number);

/** Authenticator data's fixed header: a 32-byte RP id hash, one flags byte, a 4-byte counter. */
const AUTH_DATA_MIN = 37;
/** User present. Every ceremony needs it: the person touched the authenticator. */
const FLAG_USER_PRESENT = 0x01;
/**
 * User verified: the authenticator checked who it was, with a face, a fingerprint or a screen
 * lock. Required, not preferred, because every page, SKILL.md and the auth page say that is what
 * confirming means. Without it, picking up an unlocked phone would be enough.
 */
const FLAG_USER_VERIFIED = 0x04;
/** Attested credential data follows, which only a registration has. */
const FLAG_ATTESTED = 0x40;

/** Authenticator data's header, or undefined when there isn't a whole one. */
export function readAuthenticatorData(
  bytes: Uint8Array,
): { rpIdHash: Uint8Array; flags: number; signCount: number } | undefined {
  if (bytes.length < AUTH_DATA_MIN) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    rpIdHash: bytes.subarray(0, 32),
    flags: bytes[32] as number,
    // Unsigned, because `|` and `<<` are signed and a counter past 2^31 would come back negative.
    signCount: view.getUint32(33, false),
  };
}

/**
 * An ECDSA signature's 64 raw bytes, from the ASN.1 DER sequence WebAuthn sends. Web Crypto's
 * ECDSA verify takes r and s raw and padded; DER trims leading zeros and may add one to keep a
 * value positive, so each is read by its own length and copied into place. Undefined for anything
 * that isn't a DER sequence of two integers that fit.
 */
export function rawEcdsaSignature(der: Uint8Array): Uint8Array<ArrayBuffer> | undefined {
  // 0x30 <len> 0x02 <rLen> r 0x02 <sLen> s. Short-form lengths only: r and s are 32 bytes here, so
  // a long form would mean something other than a P-256 signature.
  if (der.length < 8 || der[0] !== 0x30) return undefined;
  const total = der[1] as number;
  if (total > 0x7f || total + 2 !== der.length) return undefined;
  const out = new Uint8Array(64);
  let at = 2;
  for (const half of [0, 32]) {
    if (der[at] !== 0x02 || at + 1 >= der.length) return undefined;
    const len = der[at + 1] as number;
    at += 2;
    if (len === 0 || len > 0x7f || at + len > der.length) return undefined;
    // DER may carry a leading zero to keep the integer positive; the raw form never does.
    const value = der.subarray(at, at + len);
    const start = value[0] === 0 ? 1 : 0;
    const size = len - start;
    if (size === 0 || size > 32) return undefined;
    out.set(value.subarray(start), half + 32 - size);
    at += len;
  }
  return at === der.length ? out : undefined;
}

/** What the browser sent back, with every binary field as base64url. */
export interface PasskeyResponse {
  /** `clientDataJSON`, which the browser built and the authenticator signed over. */
  clientData: string;
  /** `getAuthenticatorData()`, flat rather than wrapped in an attestation object. */
  authenticatorData: string;
}

/** What this server is to a passkey: the origin the page runs on and the RP id scoped to it. */
export interface PasskeyRelyingParty {
  /** The exact origin, as the browser reports it: `https://terrakin.org`. */
  origin: string;
  /** The RP id, a registrable domain of that origin: `terrakin.org`. */
  id: string;
}

type Checked<T> = { ok: true; value: T } | { ok: false; why: PasskeyProblem };

const refuse = <T>(why: PasskeyProblem): Checked<T> => ({ ok: false, why });

/**
 * The checks every ceremony shares: the client data says what we asked for, over the challenge we
 * issued, from our own origin, and the authenticator data is ours with the person present.
 */
async function checkCeremony(
  response: PasskeyResponse,
  expect: {
    type: "webauthn.create" | "webauthn.get";
    challenge: Uint8Array;
    rp: PasskeyRelyingParty;
  },
): Promise<Checked<{ authData: Uint8Array<ArrayBuffer>; signCount: number; flags: number }>> {
  const clientData = fromBase64Url(response.clientData);
  const authData = fromBase64Url(response.authenticatorData);
  if (!clientData || !authData) return refuse("bad_encoding");

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(clientData));
  } catch {
    return refuse("bad_client_data");
  }
  const data = parsed as { type?: unknown; challenge?: unknown; origin?: unknown };
  if (typeof data.type !== "string" || data.type !== expect.type) return refuse("wrong_type");
  if (typeof data.challenge !== "string") return refuse("bad_client_data");
  const sent = fromBase64Url(data.challenge);
  if (!sent || !sameBytes(sent, expect.challenge)) return refuse("wrong_challenge");
  // The origin is what stops a lookalike site replaying a ceremony at us.
  if (typeof data.origin !== "string" || data.origin !== expect.rp.origin) {
    return refuse("wrong_origin");
  }

  const header = readAuthenticatorData(authData);
  if (!header) return refuse("bad_authenticator_data");
  const rpIdHash = await sha256Bytes(new TextEncoder().encode(expect.rp.id));
  if (!sameBytes(header.rpIdHash, rpIdHash)) return refuse("wrong_relying_party");
  if ((header.flags & FLAG_USER_PRESENT) === 0) return refuse("not_present");
  if ((header.flags & FLAG_USER_VERIFIED) === 0) return refuse("not_verified");

  return { ok: true, value: { authData, signCount: header.signCount, flags: header.flags } };
}

/** A new passkey, as it is stored. The public key is SPKI, which Web Crypto imports as it is. */
export interface BoundPasskey {
  credentialId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  algorithm: PasskeyAlgorithm;
  signCount: number;
}

/**
 * A binding: what to store for the credential just made, or why to refuse it.
 *
 * Attestation is `none`, so nothing here claims where the authenticator came from, and taking the
 * public key from the browser rather than out of the attestation object gives nothing away: a
 * caller who sends their own key is registering their own credential, which is what registering
 * is, and the request reached here already authorized by a token or a one-time link.
 */
export async function checkBinding(
  response: PasskeyResponse & { credentialId: string; publicKey: string; algorithm: number },
  expect: { challenge: Uint8Array; rp: PasskeyRelyingParty },
): Promise<Checked<BoundPasskey>> {
  const checked = await checkCeremony(response, { ...expect, type: "webauthn.create" });
  if (!checked.ok) return checked;
  if ((checked.value.flags & FLAG_ATTESTED) === 0) return refuse("bad_authenticator_data");
  if (!isPasskeyAlgorithm(response.algorithm)) return refuse("bad_key");
  const credentialId = fromBase64Url(response.credentialId);
  const publicKey = fromBase64Url(response.publicKey);
  if (!credentialId || credentialId.length === 0 || !publicKey) return refuse("bad_encoding");
  // Import it now rather than at the first sign-in, so a key we could never check is refused here.
  if (!(await importPasskey(publicKey, response.algorithm))) return refuse("bad_key");
  return {
    ok: true,
    value: {
      credentialId: response.credentialId,
      publicKey,
      algorithm: response.algorithm,
      signCount: checked.value.signCount,
    },
  };
}

/** The stored key as Web Crypto's, or undefined when it can't be read as one. */
async function importPasskey(
  publicKey: Uint8Array<ArrayBuffer>,
  algorithm: PasskeyAlgorithm,
): Promise<CryptoKey | undefined> {
  const params =
    algorithm === -7
      ? { name: "ECDSA", namedCurve: "P-256" }
      : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  try {
    return await crypto.subtle.importKey("spki", publicKey, params, false, ["verify"]);
  } catch {
    return undefined;
  }
}

/**
 * A sign-in: whether this assertion was signed by the stored credential, and the counter it came
 * with. The signature covers the authenticator data and a hash of the client data, so checking it
 * is what ties the ceremony's challenge and origin to the key that was bound.
 */
export async function checkAssertion(
  response: PasskeyResponse & { signature: string },
  stored: Pick<BoundPasskey, "publicKey" | "algorithm">,
  expect: { challenge: Uint8Array; rp: PasskeyRelyingParty },
): Promise<Checked<{ signCount: number }>> {
  const checked = await checkCeremony(response, { ...expect, type: "webauthn.get" });
  if (!checked.ok) return checked;
  const raw = fromBase64Url(response.signature);
  if (!raw) return refuse("bad_encoding");
  const key = await importPasskey(stored.publicKey, stored.algorithm);
  if (!key) return refuse("bad_key");
  const signature = stored.algorithm === -7 ? rawEcdsaSignature(raw) : raw;
  if (!signature) return refuse("bad_signature");

  const clientData = fromBase64Url(response.clientData);
  if (!clientData) return refuse("bad_encoding");
  const signed = new Uint8Array(checked.value.authData.length + 32);
  signed.set(checked.value.authData, 0);
  signed.set(await sha256Bytes(clientData), checked.value.authData.length);

  const params =
    stored.algorithm === -7 ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" };
  let fine = false;
  try {
    fine = await crypto.subtle.verify(params, key, signature, signed);
  } catch {
    return refuse("bad_signature");
  }
  return fine
    ? { ok: true, value: { signCount: checked.value.signCount } }
    : refuse("bad_signature");
}
