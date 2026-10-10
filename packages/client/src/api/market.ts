/** The market (RFC 0008). */
import { MarketResponse } from "@terrakin/protocol";
import { query } from "@terrakin/ui/http";
import { request } from "./request";

export const marketApi = {
  /** What residents sell, all of it or one resident's stall, a page at a time. */
  market: (opts: { seller?: string; before?: string } = {}) =>
    request(
      "GET",
      `/v1/market${query({ seller: opts.seller, before: opts.before })}`,
      MarketResponse,
    ),
};
