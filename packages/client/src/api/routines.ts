/** Offline routines (RFC 0009). */
import { RoutinesResponse } from "@terrakin/protocol";
import { query } from "@terrakin/ui/http";
import { request } from "./request";

export const routinesApi = {
  /** Your routines and what they did while you were away, a page at a time. */
  routines: (before?: string) =>
    request("GET", `/v1/routines${query({ before })}`, RoutinesResponse),
};
