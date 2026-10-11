/** Bounties (RFC 0008). */
import { BountiesResponse } from "@terrakin/protocol";
import { request } from "./request";

export const bountiesApi = {
  /** Work residents and the town pay coins for. */
  bounties: () => request("GET", "/v1/bounties", BountiesResponse),
};
