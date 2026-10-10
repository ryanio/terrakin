/** Hosted events (RFC 0010). */
import { EventResponse, EventsResponse } from "@terrakin/protocol";
import { request } from "./request";

export const eventsApi = {
  /** What's on now, what's coming, and whether you can host. */
  events: () => request("GET", "/v1/events", EventsResponse),
  /** Say you're going to an event, or take it back. */
  going: (id: string, on: boolean) =>
    request(on ? "POST" : "DELETE", `/v1/events/${encodeURIComponent(id)}/going`, EventResponse),
};
