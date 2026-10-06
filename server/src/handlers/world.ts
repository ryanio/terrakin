import { type AreaRouteIds, PROTOCOL_VERSION } from "@terrakin/protocol";
import { plotPlan } from "@terrakin/sim";
import type { Api } from "../api";
import { fail, type Handlers } from "./shared";

/**
 * The handlers for the world: health, the snapshot, sessions, actions, and plot plans. Their routes
 * are in the protocol's `route-table/world.ts`.
 */
export function worldHandlers(api: Api): Pick<Handlers, AreaRouteIds["world"]> {
  const { service } = api;
  return {
    getHealth: () => {
      const snapshot = service.snapshotInfo();
      return {
        status: 200,
        body: {
          ok: true,
          v: PROTOCOL_VERSION,
          seq: service.state.seq,
          hash: service.hash(),
          online: service.onlineCount(),
          ...(snapshot ? { snapshot } : {}),
        },
      };
    },
    getWorld: () => ({ status: 200, body: service.snapshot() }),
    createSession: ({ body }) => {
      const result = service.createSession(body);
      if (!result.ok) return fail(result.error.code, result.error.message);
      if (!result.residentId || !result.token) return fail("internal", "No session.");
      return {
        status: 201,
        body: { residentId: result.residentId, token: result.token, world: service.snapshot() },
      };
    },
    deleteSession: ({ viewer }) => {
      service.leave(viewer);
      return { status: 204 };
    },
    act: ({ viewer, body }) => {
      // A dry run never brings anyone online: `act` checks it as if they were.
      if (!body.dry) service.arrive(viewer, body.type);
      return { status: 200, body: service.act(viewer, body) };
    },
    getPlotPlan: ({ params }) => {
      const plan = plotPlan(service.state, params.px, params.py);
      if (!plan) return fail("not_found", "There's no plot there: it's outside the world.");
      return { status: 200, body: { plan } };
    },
  };
}
