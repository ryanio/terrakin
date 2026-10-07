import type { AreaRouteIds } from "@terrakin/protocol";
import type { Api } from "../api";
import type { LinkRouteId } from "../links";
import { fromResult, type Handlers } from "./shared";

/**
 * The handlers for owners and their AIs (decision 0031). The owner link routes are in
 * `links/keys.ts`. Their routes are in the protocol's `route-table/owners.ts`.
 */
export function ownerHandlers(
  api: Api,
): Pick<Handlers, Exclude<AreaRouteIds["owners"], LinkRouteId>> {
  const owners = () => api.requireOwners();
  return {
    createOwnerClaim: ({ viewer }) =>
      fromResult(owners().createClaim(viewer), (code) => ({ status: 201 as const, body: code })),
    acceptOwnerClaim: ({ viewer, body }) =>
      fromResult(owners().accept(viewer, body.code), (link) => ({
        status: 200 as const,
        body: link,
      })),
    createOwnerInvite: ({ viewer }) =>
      fromResult(owners().createInvite(viewer), (invite) => ({
        status: 201 as const,
        body: invite,
      })),
    getOwnerInvite: ({ params }) =>
      fromResult(owners().preview(params.code), (invite) => ({
        status: 200 as const,
        body: invite,
      })),
    confirmOwnerInvite: ({ viewer, body }) =>
      fromResult(owners().confirm(viewer, body.code), (link) => ({
        status: 200 as const,
        body: link,
      })),
    declineOwnerInvite: ({ body }) =>
      fromResult(owners().decline(body.code), () => ({ status: 204 as const })),
    unlinkOwner: ({ viewer, params }) =>
      fromResult(owners().unlink(viewer, params.id), () => ({ status: 204 as const })),
    revokeAgentAccess: ({ viewer, params }) =>
      fromResult(owners().revoke(viewer, params.id), () => ({ status: 204 as const })),
    getOwnerRekey: ({ viewer, params }) =>
      fromResult(owners().rekeyView(viewer, params.id), (view) => ({
        status: 200 as const,
        body: view,
      })),
    askOwnerRekey: ({ viewer, params }) =>
      fromResult(owners().askRekey(viewer, params.id), (view) => ({
        status: 201 as const,
        body: view,
      })),
    createOwnerRekeyCode: ({ viewer, params }) =>
      fromResult(owners().rekeyCode(viewer, params.id), (code) => ({
        status: 201 as const,
        body: code,
      })),
    createRekeyCode: ({ viewer, params }) =>
      fromResult(owners().maintainerRekey(viewer, params.id), (code) => ({
        status: 201 as const,
        body: code,
      })),
    redeemRekey: ({ body }) =>
      fromResult(owners().rekey(body.code), (fresh) => ({ status: 200 as const, body: fresh })),
  };
}
