/** Invites: making a link for a friend, reading one, and accepting it. */
import {
  type AcceptInviteRequest,
  AcceptInviteResponse,
  InviteDetailsResponse,
  InviteResponse,
} from "@terrakin/protocol";
import { request } from "./request";

export const invitesApi = {
  createInvite: (share: boolean) =>
    request("POST", "/v1/invites", InviteResponse, share ? { share: true } : {}),
  invite: (code: string) =>
    request("GET", `/v1/invites/${encodeURIComponent(code)}`, InviteDetailsResponse),
  acceptInvite: (code: string, body: AcceptInviteRequest) =>
    request("POST", `/v1/invites/${encodeURIComponent(code)}/accept`, AcceptInviteResponse, body),
};
