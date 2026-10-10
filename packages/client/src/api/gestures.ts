/** Gestures: what has passed between you and someone, and sending one. */
import { type GestureRequest, GestureResponse, GesturesResponse } from "@terrakin/protocol";
import { query } from "@terrakin/ui/http";
import { request } from "./request";

export const gesturesApi = {
  gestures: (withId?: string) =>
    request("GET", `/v1/gestures${query({ with: withId })}`, GesturesResponse),
  gesture: (id: string, body: GestureRequest) =>
    request("POST", `/v1/residents/${encodeURIComponent(id)}/gesture`, GestureResponse, body),
};
