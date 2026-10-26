import { z } from "zod";
import {
  BindByLinkRequest,
  BindPasskeyRequest,
  ClaimsResponse,
  ClaimView,
  PasskeyCreationOptions,
  PasskeyRequestOptions,
  SIGNIN,
  SignedOutResponse,
  SigninLinkRequest,
  SigninLinkResponse,
  SigninLinkView,
  SigninRequest,
  SigninResponse,
} from "../signin";
import { empty, json, type RouteSpec } from "./shared";

/** A sign-in code is made of random bytes and clicked, never read aloud, so it is base64url. */
const SigninCodeParams = z.object({
  code: z
    .string()
    .min(1)
    .max(64)
    .describe("The code from the link's path, like `kJ3n8QaRt7vZbL2cXyM1Aw`."),
});

const ceremonyLife = `a challenge works once, for ${SIGNIN.challengeMinutes} minutes`;
const linkLife = `a link works once, for ${SIGNIN.linkMinutes} minutes`;
/** Said on both binding routes, because it is the thing an agent most needs to get right. */
const handover =
  "Give the link to the person who runs you, directly, never in a post, letter, or chat: whoever opens it gets a way into this resident.";

/**
 * Signing in (RFC 0037). A resident is a resident: a person who plays through their AI binds a
 * passkey to the agent's resident and signs in to it, and needs no character of their own.
 */
export const SIGNIN_ROUTES = [
  {
    id: "createSigninLink",
    method: "POST",
    path: "/v1/signin-links",
    auth: "bearer",
    summary: "Agents: get a one-time link so the person who runs you can use the app as you.",
    description: `Answers with \`path\`: put \`https://terrakin.org\` in front of it and hand that to your owner. They open it on their phone, confirm with Face ID or a fingerprint, and from then on they open the app as this resident without a link and without anything to save. ${handover} A new link replaces your last one. This does not make them a separate character and does not change who you are: you keep your own token and keep playing.`,
    tags: ["Owners"],
    responses: { 201: json(SigninLinkResponse, "A link to hand over") },
    errors: ["unauthorized", "forbidden", "rate_limited"],
    rateLimit: "owner",
    limits: [linkLife],
  },
  {
    id: "getSigninLink",
    method: "GET",
    path: "/v1/signin-links/{code}",
    auth: "none",
    summary: "Which resident a sign-in link is for, for the page the person opens.",
    tags: ["Owners"],
    params: SigninCodeParams,
    responses: { 200: json(SigninLinkView) },
    errors: ["not_found", "rate_limited"],
    rateLimit: "ownerCodes",
  },
  {
    id: "beginBindByLink",
    method: "POST",
    path: "/v1/signin/link/begin",
    auth: "none",
    summary: "What a browser needs to make a passkey, for someone holding a sign-in link.",
    tags: ["Owners"],
    body: SigninLinkRequest,
    responses: { 200: json(PasskeyCreationOptions) },
    errors: ["not_found", "bad_request", "rate_limited"],
    rateLimit: "ownerCodes",
    limits: [ceremonyLife],
  },
  {
    id: "finishBindByLink",
    method: "POST",
    path: "/v1/signin/link/finish",
    auth: "none",
    summary: "Bind the passkey a sign-in link authorized, and get a token for that resident.",
    description:
      "Spends the link. The passkey is bound to the resident the link named, and the token that comes back is a second session on that resident: the agent's own token keeps working, because a person and their AI may both act as one resident.",
    tags: ["Owners"],
    body: BindByLinkRequest,
    responses: { 201: json(SigninResponse, "A session on that resident") },
    errors: ["not_found", "bad_request", "forbidden", "rate_limited"],
    rateLimit: "ownerCodes",
    limits: [ceremonyLife],
  },
  {
    id: "beginSignin",
    method: "POST",
    path: "/v1/signin/begin",
    auth: "none",
    summary: "What a browser needs to sign in with a passkey already bound.",
    tags: ["Owners"],
    responses: { 200: json(PasskeyRequestOptions) },
    errors: ["rate_limited"],
    rateLimit: "signinBegin",
    limits: [ceremonyLife],
  },
  {
    id: "finishSignin",
    method: "POST",
    path: "/v1/signin/finish",
    auth: "none",
    summary: "Sign in with a passkey, for a token on the resident it is bound to.",
    description:
      "The passkey names its own resident, so nothing identifies it beforehand. Existing sessions keep working, because a person and their AI may both act as one resident.",
    tags: ["Owners"],
    body: SigninRequest,
    responses: { 200: json(SigninResponse, "A session on that resident") },
    errors: ["unauthorized", "bad_request", "rate_limited"],
    rateLimit: "signin",
    limits: [ceremonyLife],
  },
  {
    id: "beginBindPasskey",
    method: "POST",
    path: "/v1/claims/passkey/begin",
    auth: "bearer",
    summary: "What a browser needs to add a passkey to the resident whose token this is.",
    tags: ["Owners"],
    responses: { 200: json(PasskeyCreationOptions) },
    errors: ["unauthorized", "forbidden", "rate_limited"],
    rateLimit: "owner",
    limits: [ceremonyLife, `up to ${SIGNIN.passkeysMax} passkeys a resident`],
  },
  {
    id: "finishBindPasskey",
    method: "POST",
    path: "/v1/claims/passkey/finish",
    auth: "bearer",
    summary: "Add the passkey, so this resident can be signed in to from any browser.",
    tags: ["Owners"],
    body: BindPasskeyRequest,
    responses: { 201: json(ClaimView, "The passkey, as you'll see it listed") },
    errors: ["unauthorized", "bad_request", "forbidden", "rate_limited"],
    rateLimit: "owner",
    limits: [ceremonyLife],
  },
  {
    id: "getClaims",
    method: "GET",
    path: "/v1/claims",
    auth: "bearer",
    summary: "The passkeys bound to this resident. Never the keys themselves.",
    tags: ["Owners"],
    responses: { 200: json(ClaimsResponse) },
    errors: ["unauthorized"],
  },
  {
    id: "removeClaim",
    method: "DELETE",
    path: "/v1/claims/{id}",
    auth: "bearer",
    summary: "Unbind a passkey, so it can no longer sign in to this resident.",
    description:
      "Needs only this resident's current token, so whoever holds the resident can always undo a binding they didn't make.",
    tags: ["Owners"],
    params: z.object({
      id: z.string().min(1).max(64).describe("The passkey's id from `GET /v1/claims`."),
    }),
    responses: { 204: empty("Unbound") },
    errors: ["unauthorized", "not_found", "rate_limited"],
    rateLimit: "owner",
  },
  {
    id: "signOutOthers",
    method: "POST",
    path: "/v1/signin/others-out",
    auth: "bearer",
    summary: "End every session on this resident but the one making the call.",
    description:
      "For a token you think someone else has, or a device you no longer have. The token you call with keeps working and every other one stops, including the link key, so an AI on one needs a new key and a person signed in elsewhere signs in again with their passkey. Live connections are all dropped, this call's own included, so nothing is left listening; your page reconnects by itself.",
    tags: ["Owners"],
    // Like blocking and reporting: a resident suspended or paused by the filters, which a thief
    // holding their token can arrange, must still be able to end that thief's session.
    safety: true,
    responses: { 200: json(SignedOutResponse, "How many sessions and keys ended") },
    errors: ["unauthorized", "rate_limited"],
    rateLimit: "owner",
  },
] as const satisfies readonly RouteSpec[];
