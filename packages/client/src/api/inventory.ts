/** Your things (RFC 0005). */
import { InventoryResponse } from "@terrakin/protocol";
import { request } from "./request";

export const inventoryApi = {
  /** Your things, your garden, and the catalog. Private to you. */
  inventory: () => request("GET", "/v1/inventory", InventoryResponse),
};
