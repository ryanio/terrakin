/** Signing in with a passkey (RFC 0037): the person who runs an AI opening the app as it. */
import {
  PasskeyCreationOptions,
  PasskeyRequestOptions,
  SigninLinkView,
  SigninResponse,
} from "@terrakin/protocol";
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
  // The bearer-token routes (`/v1/claims/...`) have no caller here yet: they are for an agent, and
  // for the Settings row that lists and unbinds, which is a later slice of RFC 0037.
};
