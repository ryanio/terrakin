/** Getting started: a newcomer's first-visit steps. */
import { FirstVisitResponse } from "@terrakin/protocol";
import { request } from "./request";

export const firstVisitApi = {
  /** Your first-visit steps, done and left, and the suggestions you've tried. Checks nothing in. */
  firstVisit: () => request("GET", "/v1/first-visit", FirstVisitResponse),
};
