/**
 * The browser half of a passkey (RFC 0037). WebAuthn speaks in `ArrayBuffer`s and the API in
 * base64url, so this is the translation and nothing else: no checks live here, because every one
 * of them is the server's (`packages/server/src/passkeys.ts`).
 *
 * The public key goes up as SPKI from `getPublicKey()` rather than inside the attestation object,
 * so the server never parses CBOR. Both are on every browser that has passkeys at all.
 */
import type { PasskeyCreationOptions, PasskeyRequestOptions } from "@terrakin/protocol";

const toBase64Url = (bytes: ArrayBuffer) => {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (text: string) => {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

/** Whether this browser can make and use a passkey at all. */
export const passkeysWork = () =>
  typeof PublicKeyCredential === "function" && typeof navigator.credentials?.create === "function";

/** What a refused or abandoned ceremony is called, so a page can tell the two apart. */
export type PasskeyFailure = "cancelled" | "unsupported" | "failed";

class PasskeyError extends Error {
  constructor(readonly why: PasskeyFailure) {
    super(why);
  }
}

const failureOf = (error: unknown): PasskeyFailure => {
  const name = (error as { name?: unknown } | null)?.name;
  // The browser says NotAllowedError both for "the person closed it" and for a timeout, which
  // read the same to someone standing there: nothing happened, try again.
  if (name === "NotAllowedError" || name === "AbortError") return "cancelled";
  if (name === "NotSupportedError") return "unsupported";
  return "failed";
};

/** What a refused ceremony says, for someone standing at the prompt it just closed. */
const WHY: Record<PasskeyFailure, string> = {
  cancelled: "Nothing happened. Try again and confirm when your device asks.",
  unsupported: "This browser can't use a passkey. Try it on your phone, or in a newer browser.",
  failed: "Your device couldn't finish that. Try again.",
};

/** A thrown ceremony in words. Anything that isn't ours reads as a device that couldn't finish. */
export const passkeyWhy = (error: unknown): string =>
  WHY[error instanceof PasskeyError ? error.why : "failed"];

/** The same words, for a caller that checked `passkeysWork` before it started a ceremony. */
export const noPasskeys = (): string => WHY.unsupported;

/** Make a passkey for these options, as the API wants it back. */
export async function makePasskey(options: PasskeyCreationOptions) {
  if (!passkeysWork()) throw new PasskeyError("unsupported");
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge: fromBase64Url(options.challenge),
        rp: { id: options.rpId, name: options.rpName },
        user: {
          id: fromBase64Url(options.user.id),
          name: options.user.name,
          displayName: options.user.displayName,
        },
        pubKeyCredParams: options.algorithms.map((alg) => ({ type: "public-key", alg })),
        excludeCredentials: options.exclude.map((id) => ({
          type: "public-key",
          id: fromBase64Url(id),
        })),
        // Discoverable, so signing in later needs no name and no list: the passkey says who it is.
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        attestation: "none",
        timeout: options.timeoutMs,
      },
    });
  } catch (error) {
    throw new PasskeyError(failureOf(error));
  }
  const made = credential as PublicKeyCredential | null;
  const response = made?.response as AuthenticatorAttestationResponse | undefined;
  const publicKey = response?.getPublicKey?.();
  const algorithm = response?.getPublicKeyAlgorithm?.();
  if (!made || !response || !publicKey || algorithm === undefined) {
    throw new PasskeyError("unsupported");
  }
  return {
    challenge: options.challenge,
    credentialId: toBase64Url(made.rawId),
    publicKey: toBase64Url(publicKey),
    algorithm,
    clientData: toBase64Url(response.clientDataJSON),
    authenticatorData: toBase64Url(response.getAuthenticatorData()),
  };
}

/** Prove a passkey this browser already holds, as the API wants it back. */
export async function provePasskey(options: PasskeyRequestOptions) {
  if (!passkeysWork()) throw new PasskeyError("unsupported");
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge: fromBase64Url(options.challenge),
        rpId: options.rpId,
        userVerification: "required",
        timeout: options.timeoutMs,
      },
    });
  } catch (error) {
    throw new PasskeyError(failureOf(error));
  }
  const used = credential as PublicKeyCredential | null;
  const response = used?.response as AuthenticatorAssertionResponse | undefined;
  if (!used || !response) throw new PasskeyError("failed");
  return {
    challenge: options.challenge,
    credentialId: toBase64Url(used.rawId),
    clientData: toBase64Url(response.clientDataJSON),
    authenticatorData: toBase64Url(response.authenticatorData),
    signature: toBase64Url(response.signature),
  };
}
