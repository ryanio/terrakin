/** The town shop (RFC 0008). */
import { ShopResponse } from "@terrakin/protocol";
import { request } from "./request";

export const shopApi = {
  /** What the shop sells and what the town buys today. */
  shop: () => request("GET", "/v1/shop", ShopResponse),
};
