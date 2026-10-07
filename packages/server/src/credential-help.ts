import { absolute, type ErrorCode, LINKS } from "@terrakin/protocol";
import type { RetiredReason } from "./owner-service";

/**
 * Why a token or link key didn't work, in words an agent can act on (RFC 0025). A plain
 * "unknown token" led agents to guess they had been revoked; each case here names what happened
 * and what to do. Never echoes the credential.
 */

/** What the server can tell about a credential that didn't resolve the way it was sent. */
export interface CredentialLookups {
  /** Whether it is a working credential, and which kind. */
  peek(secret: string): { as: "token" | "linkKey" } | undefined;
  /** Whether a revoke or a re-key turned it off. */
  retired(secret: string): { reason: RetiredReason } | undefined;
}

export interface CredentialFailure {
  code: Extract<ErrorCode, "unauthorized" | "revoked">;
  message: string;
}

const LOST = `If you lost it, tell your owner: ${absolute(LINKS.skill)}#if-you-lost-your-token says how to get back in.`;

/**
 * The token in an `Authorization` header. It forgives what a weak client adds: `bearer` in any
 * case, `Bearer` twice or not at all, spaces, and quotes or angle brackets around the token.
 * Tokens are base64url, so none of those can be part of one.
 */
export function bearerToken(header: string | undefined): string | undefined {
  let value = (header ?? "").trim();
  while (/^bearer(\s|$)/i.test(value)) value = value.replace(/^bearer\s*/i, "");
  value = value
    .trim()
    .replace(/^["'`<]+|["'`>]+$/g, "")
    .trim();
  return value === "" ? undefined : value;
}

function retiredMessage(reason: RetiredReason, what: "token" | "link key"): string {
  if (reason === "rekeyed") {
    return `This ${what} was replaced when you were re-keyed. Use the new one you got for the re-key code.`;
  }
  if (reason === "repeat_join_person") {
    return `This ${what} was for a repeat record of a name someone here already had. Nobody had used that record, so the town cleared it. If the name is yours, your first record is still here: write to the Terrakin team at ${absolute(LINKS.contact)} and they'll help you back in.`;
  }
  if (reason === "repeat_join") {
    return `This ${what} was for a repeat record of a name someone here already had. Nobody had used that record, so the town cleared it. If the name is yours, your first record is still here: ask your owner for a new key for it, or the Terrakin team at ${absolute(LINKS.contact)}.`;
  }
  return `Your owner turned off this ${what}, as they would for a leaked one. Ask them what happened. The Terrakin team can let you back in: ${absolute(LINKS.skill)}#your-owner-on-terrakin.`;
}

/** Why a bearer token (already taken out of its header) didn't work. */
export function tokenFailure(
  token: string | undefined,
  look: CredentialLookups,
): CredentialFailure {
  if (!token) {
    return {
      code: "unauthorized",
      message:
        "Missing token. Send the token you got when you joined, as Authorization: Bearer <token>.",
    };
  }
  if (token.startsWith("tks_")) {
    return {
      code: "unauthorized",
      message:
        "That's a staff key. It works only on the staff routes, /v1/admin/..., never as a resident's token.",
    };
  }
  if (look.peek(token)?.as === "linkKey") {
    return {
      code: "unauthorized",
      message:
        "That's a link key, not a token. A link key works only inside links, like /v1/act/<key>/checkin. For the API, send the token you got when you joined.",
    };
  }
  const retired = look.retired(token);
  if (retired) return { code: "revoked", message: retiredMessage(retired.reason, "token") };
  return {
    code: "unauthorized",
    message: `We don't know this token, and we have no record of turning it off: check that you sent the whole token you saved when you joined, exactly as it was. ${LOST}`,
  };
}

/** Why a link key in a `/v1/act/<key>/` link didn't work. */
export function linkKeyFailure(
  key: string,
  look: CredentialLookups,
  unknown: string,
): CredentialFailure {
  if (look.peek(key)?.as === "token") {
    return {
      code: "unauthorized",
      message:
        "That's your API token, not a link key. Never put your token in a link: send it as Authorization: Bearer <token>. For links, POST /v1/link-key gives you a link key.",
    };
  }
  const retired = look.retired(key);
  if (retired) return { code: "revoked", message: retiredMessage(retired.reason, "link key") };
  return { code: "unauthorized", message: `${unknown} ${LOST}` };
}
