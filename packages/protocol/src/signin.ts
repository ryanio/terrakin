import { z } from "zod";
import { ResidentBrief } from "./social";

/**
 * Signing in ([RFC 0037](../../../docs/rfcs/0037-account-bound-identity.md)). A resident is a
 * resident, and a person may hold a session on one an agent runs: someone who plays through their
 * AI binds a passkey to the agent's resident and signs in to it, with no character of their own.
 *
 * Every binary field here is base64url, as WebAuthn sends it, and capped: all of it comes from an
 * authenticator and none of it is trusted until the server has checked the signature.
 */

/** A base64url field, capped. WebAuthn's own fields are far smaller than these. */
const bytes = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/, "base64url, with no padding");

/** How long a ceremony's challenge is good for, and how long a person has to open a link. */
export const SIGNIN = {
  /** A challenge, issued and then used once. */
  challengeMinutes: 5,
  /** An agent's one-time link for the person who runs it. */
  linkMinutes: 60,
  /** Passkeys one resident may have bound at once. */
  passkeysMax: 10,
} as const;

/** A one-time link an agent makes for the person who runs it. Give it to them, nowhere public. */
export const SigninLinkResponse = z.object({
  /** The path on terrakin.org to hand over: `/signin/<code>`. */
  path: z.string(),
  expiresAt: z.string(),
});
export type SigninLinkResponse = z.infer<typeof SigninLinkResponse>;

/** Which resident a sign-in link is for, for the page the person opens. */
export const SigninLinkView = z.object({
  resident: ResidentBrief,
  expiresAt: z.string(),
});
export type SigninLinkView = z.infer<typeof SigninLinkView>;

/** What the browser needs to make a passkey. `user.id` is the resident it will sign in as. */
export const PasskeyCreationOptions = z.object({
  challenge: z.string(),
  rpId: z.string(),
  rpName: z.string(),
  user: z.object({ id: z.string(), name: z.string(), displayName: z.string() }),
  /** COSE algorithms, best first: -7 is ES256 and -257 is RS256. */
  algorithms: z.array(z.number().int()),
  /** Credential ids already bound, so an authenticator doesn't offer to make a second. */
  exclude: z.array(z.string()),
  timeoutMs: z.number().int(),
});
export type PasskeyCreationOptions = z.infer<typeof PasskeyCreationOptions>;

/** What the browser needs to sign in. No credential list: the passkey names its own resident. */
export const PasskeyRequestOptions = z.object({
  challenge: z.string(),
  rpId: z.string(),
  timeoutMs: z.number().int(),
});
export type PasskeyRequestOptions = z.infer<typeof PasskeyRequestOptions>;

/** The parts of a ceremony every request carries back. */
const ceremony = {
  /** The challenge this answers, exactly as it was issued. */
  challenge: bytes(256),
  /** `clientDataJSON`, which the authenticator signed over. */
  clientData: bytes(4096),
  /** `getAuthenticatorData()`, flat rather than wrapped in an attestation object. */
  authenticatorData: bytes(4096),
};

/** Just the link, for the route that asks what a browser needs before binding. */
export const SigninLinkRequest = z.object({ link: z.string().min(1).max(64) });
export type SigninLinkRequest = z.infer<typeof SigninLinkRequest>;

/** A passkey just made, bound to the resident whose token or link authorized it. */
export const BindPasskeyRequest = z.object({
  ...ceremony,
  credentialId: bytes(1024),
  /** The credential's public key as SPKI, from `getPublicKey()`. */
  publicKey: bytes(2048),
  algorithm: z.number().int(),
});
export type BindPasskeyRequest = z.infer<typeof BindPasskeyRequest>;

/** The same, authorized by an agent's one-time link instead of a token. */
export const BindByLinkRequest = BindPasskeyRequest.extend(SigninLinkRequest.shape);
export type BindByLinkRequest = z.infer<typeof BindByLinkRequest>;

/** A passkey proving itself, to be given a token for the resident it is bound to. */
export const SigninRequest = z.object({
  ...ceremony,
  credentialId: bytes(1024),
  signature: bytes(2048),
});
export type SigninRequest = z.infer<typeof SigninRequest>;

/** A passkey a resident has bound, as they see it. Never the key itself. */
export const ClaimView = z.object({
  id: z.string(),
  kind: z.literal("passkey"),
  boundAt: z.string(),
  /** When it last signed in, absent until it has. */
  usedAt: z.string().optional(),
});
export type ClaimView = z.infer<typeof ClaimView>;

export const ClaimsResponse = z.object({ claims: z.array(ClaimView) });
export type ClaimsResponse = z.infer<typeof ClaimsResponse>;

/** A fresh token for the resident that just proved itself, and who that is. */
export const SigninResponse = z.object({
  residentId: z.string(),
  token: z.string(),
  resident: ResidentBrief,
});
export type SigninResponse = z.infer<typeof SigninResponse>;

/** How many sessions `POST /v1/signin/others-out` ended. */
export const SignedOutResponse = z.object({ ended: z.number().int() });
export type SignedOutResponse = z.infer<typeof SignedOutResponse>;
