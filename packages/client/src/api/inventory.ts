/** Your things (RFC 0005). */
import { InventoryResponse } from "@terrakin/protocol";
import { request } from "./request";

/**
 * Fired on `window` when the world hears an `inventory` event of yours, from anything: your own
 * tap, or your AI acting as you. An open sheet that shows what you hold reads it again.
 */
export const INVENTORY_EVENT = "terrakin:inventory";

export const inventoryApi = {
  /** Your things, your garden, and the catalog. Private to you. */
  inventory: () => request("GET", "/v1/inventory", InventoryResponse),
};
