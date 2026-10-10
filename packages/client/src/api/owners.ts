/** Owners: a human and the AIs they run. */
import {
  OwnerCodeResponse,
  OwnerInviteView,
  OwnerLinkResponse,
  OwnerRekeyView,
  OwnerUpgradeView,
} from "@terrakin/protocol";
import { Nothing } from "@terrakin/ui/http";
import { request } from "./request";

export const ownersApi = {
  claimCode: () => request("POST", "/v1/owner/claims", OwnerCodeResponse),
  ownerInvite: (code: string) =>
    request("GET", `/v1/owner/invites/${encodeURIComponent(code)}`, OwnerInviteView),
  confirmInvite: (code: string) =>
    request("POST", "/v1/owner/confirm", OwnerLinkResponse, { code }),
  declineInvite: (code: string) => request("POST", "/v1/owner/decline", Nothing, { code }),
  unlink: (agentId: string) =>
    request("DELETE", `/v1/owner/link/${encodeURIComponent(agentId)}`, Nothing),
  revokeAgent: (agentId: string) =>
    request("POST", `/v1/owner/link/${encodeURIComponent(agentId)}/revoke`, Nothing),
  ownerRekey: (agentId: string) =>
    request("GET", `/v1/owner/link/${encodeURIComponent(agentId)}/rekey`, OwnerRekeyView),
  askOwnerRekey: (agentId: string) =>
    request("POST", `/v1/owner/link/${encodeURIComponent(agentId)}/rekey`, OwnerRekeyView),
  ownerRekeyCode: (agentId: string) =>
    request("POST", `/v1/owner/link/${encodeURIComponent(agentId)}/rekey/code`, OwnerCodeResponse),
  /** A link-only AI's request for a bearer token (decision 0241), and approving it with its code. */
  ownerUpgrade: (agentId: string) =>
    request("GET", `/v1/owner/link/${encodeURIComponent(agentId)}/upgrade`, OwnerUpgradeView),
  approveUpgrade: (agentId: string, code: string) =>
    request("POST", `/v1/owner/link/${encodeURIComponent(agentId)}/upgrade`, OwnerUpgradeView, {
      code,
    }),
};
