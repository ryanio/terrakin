import type { AreaRouteIds } from "@terrakin/protocol";
import type { Api } from "../api";
import { relyingPartyOf } from "../claims";
import { fail, fromResult, type Handlers } from "./shared";

/**
 * Signing in with a passkey (RFC 0037). Their routes are in the protocol's
 * `route-table/signin.ts`, and the ceremonies themselves in `claims.ts` and `passkeys.ts`.
 *
 * A passkey is scoped to the host the request came to, so every handler that runs a ceremony reads
 * the relying party off the request's own origin. An origin we can't read is a refusal rather than
 * a guess, since binding to the wrong host would make a passkey that can never sign in.
 */
export function signinHandlers(api: Api): Pick<Handlers, AreaRouteIds["signin"]> {
  const claims = () => api.requireClaims();
  const rpOr = (origin: string) =>
    relyingPartyOf(origin) ?? fail("bad_request", "We couldn't tell which site this came from.");
  const isFailure = (value: unknown): value is ReturnType<typeof fail> =>
    typeof value === "object" && value !== null && "error" in value;

  return {
    createSigninLink: ({ viewer }) =>
      fromResult(claims().makeLink(viewer), (link) => ({ status: 201 as const, body: link })),
    getSigninLink: ({ params }) =>
      fromResult(claims().linkView(params.code), (view) => ({ status: 200 as const, body: view })),
    beginBindByLink: ({ body, origin }) => {
      const rp = rpOr(origin);
      if (isFailure(rp)) return rp;
      return fromResult(claims().beginBindByLink(body.link, rp), (options) => ({
        status: 200 as const,
        body: options,
      }));
    },
    finishBindByLink: async ({ body, origin }) => {
      const rp = rpOr(origin);
      if (isFailure(rp)) return rp;
      return fromResult(await claims().finishBindByLink(body, rp), (session) => ({
        status: 201 as const,
        body: session,
      }));
    },
    beginSignin: ({ origin }) => {
      const rp = rpOr(origin);
      if (isFailure(rp)) return rp;
      return { status: 200 as const, body: claims().beginSignin(rp) };
    },
    finishSignin: async ({ body, origin }) => {
      const rp = rpOr(origin);
      if (isFailure(rp)) return rp;
      return fromResult(await claims().finishSignin(body, rp), (session) => ({
        status: 200 as const,
        body: session,
      }));
    },
    beginBindPasskey: ({ viewer, origin }) => {
      const rp = rpOr(origin);
      if (isFailure(rp)) return rp;
      return fromResult(claims().beginBind(viewer, rp), (options) => ({
        status: 200 as const,
        body: options,
      }));
    },
    finishBindPasskey: async ({ viewer, body, origin }) => {
      const rp = rpOr(origin);
      if (isFailure(rp)) return rp;
      return fromResult(await claims().finishBind(viewer, body, rp), (claim) => ({
        status: 201 as const,
        body: claim,
      }));
    },
    getClaims: ({ viewer, tokenHash }) => ({
      status: 200 as const,
      body: claims().list(viewer, tokenHash),
    }),
    signOutOthers: ({ viewer, tokenHash }) =>
      // Unreachable without a token: the route is `auth: "bearer"`, so the dispatcher has one.
      tokenHash === undefined
        ? fail("unauthorized", "Send the token you want to keep.")
        : {
            status: 200 as const,
            body: { ended: api.service.revokeOtherTokens(viewer, tokenHash) },
          },
    removeClaim: ({ viewer, params }) =>
      fromResult(claims().remove(viewer, params.id), () => ({ status: 204 as const })),
  };
}
