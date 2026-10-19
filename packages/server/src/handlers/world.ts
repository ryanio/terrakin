import { type AreaRouteIds, designViews, PROTOCOL_VERSION } from "@terrakin/protocol";
import { designNotes, plotMap, plotPlan } from "@terrakin/sim";
import type { Api } from "../api";
import { fail, type Handlers } from "./shared";

/**
 * The handlers for the world: health, the snapshot, sessions, actions, plot plans, and designs. Their routes
 * are in the protocol's `route-table/world.ts`.
 */
/** The designs never change while the server runs. */
const DESIGNS = designViews();

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
          ...(api.build ? { build: api.build } : {}),
        },
      };
    },
    getWorld: () => ({ status: 200, body: service.snapshot() }),
    createSession: ({ body }) => {
      const result = service.createSession(body);
      // `free` goes out on a `name_taken` as the live socket's join already sends it, since SKILL.md
      // tells an agent a refused join carries it (decision 0302).
      if (!result.ok)
        return fail(result.error.code, result.error.message, undefined, result.error.free);
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
      // `actWalk` is `act`, except a `move` with `steps`, which it walks a tile at a time.
      return { status: 200, body: api.actWalk(viewer, body) };
    },
    getPlotPlan: ({ params }) => {
      const { state } = service;
      const plan = plotPlan(state, params.px, params.py);
      const map = plotMap(state, params.px, params.py);
      if (!plan || !map) return fail("not_found", "There's no plot there: it's outside the world.");
      const notes = designNotes(state, params.px, params.py);
      return { status: 200, body: { plan: { ...plan, map, notes } } };
    },
    getDesigns: () => ({ status: 200, body: DESIGNS }),
  };
}
