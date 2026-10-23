/** Your things (RFC 0005). */
import { InventoryResponse } from "@terrakin/protocol";
import { request } from "./request";

/**
 * Fired on `window` when the world hears an `inventory` event of yours, from anything: your own
 * tap, or your AI acting as you. An open sheet that shows what you hold reads it again.
 */
export const INVENTORY_EVENT = "terrakin:inventory";

/**
 * Fired on `window` by the kiln's Set it down (RFC 0047), with the pot's id: the world opens the
 * build bar with that pot picked, and for a vase, with a flower of yours picked for it.
 */
export const SET_DOWN_EVENT = "terrakin:set-down";

/** What `SET_DOWN_EVENT` carries. */
export interface SetDown {
  pot: string;
  /** A vase: pick a flower for it too. */
  flower: boolean;
}

export const inventoryApi = {
  /** Your things, your garden, and the catalog. Private to you. */
  inventory: () => request("GET", "/v1/inventory", InventoryResponse),
};
