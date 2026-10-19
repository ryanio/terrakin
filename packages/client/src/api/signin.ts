/** Signing in with a passkey (RFC 0037): the person who runs an AI opening the app as it. */
import {
  ClaimsResponse,
  ClaimView,
  PasskeyCreationOptions,
  PasskeyRequestOptions,
  SigninLinkView,
  SigninResponse,
} from "@terrakin/protocol";
import { Nothing } from "@terrakin/ui/http";
import { request } from "./request";

export const signinApi = {
  /** Which resident an agent's one-time link is for. No token: the code is the authority. */
  link: (code: string) =>
    request("GET", `/v1/signin-links/${encodeURIComponent(code)}`, SigninLinkView),
  beginByLink: (link: string) =>
    request("POST", "/v1/signin/link/begin", PasskeyCreationOptions, { link }),
  finishByLink: (body: unknown) => request("POST", "/v1/signin/link/finish", SigninResponse, body),
  begin: () => request("POST", "/v1/signin/begin", PasskeyRequestOptions),
  finish: (body: unknown) => request("POST", "/v1/signin/finish", SigninResponse, body),
  beginBind: () => request("POST", "/v1/claims/passkey/begin", PasskeyCreationOptions),
  finishBind: (body: unknown) => request("POST", "/v1/claims/passkey/finish", ClaimView, body),
  claims: () => request("GET", "/v1/claims", ClaimsResponse),
  removeClaim: (id: string) => request("DELETE", `/v1/claims/${encodeURIComponent(id)}`, Nothing),
};
