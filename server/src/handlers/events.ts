import type { AreaRouteIds } from "@terrakin/protocol";
import { findEvent, isTownEvent } from "@terrakin/sim";
import type { Api } from "../api";
import { eventsView } from "../events";
import { fail, type Handlers } from "./shared";

/**
 * The handlers for hosted events (RFC 0010). Their routes are in the protocol's
 * `route-table/events.ts`.
 */
export function eventHandlers(api: Api): Pick<Handlers, AreaRouteIds["events"]> {
  const { service } = api;
  const social = () => api.requireSocial();
  return {
    getEvents: ({ viewer, query }) => ({
      status: 200,
      body: eventsView(service.state, social().eventContext(viewer), viewer, query),
    }),
    getEvent: ({ viewer, params }) => {
      const e = findEvent(service.state, params.id);
      const ctx = social().eventContext(viewer);
      if (!e || (!isTownEvent(e) && ctx.hidden(e.host))) return fail("not_found", "No such event.");
      return { status: 200, body: api.eventResponse(e, viewer) };
    },
    markGoing: ({ viewer, params }) => api.setGoing(viewer, params.id, true),
    unmarkGoing: ({ viewer, params }) => api.setGoing(viewer, params.id, false),
  };
}
