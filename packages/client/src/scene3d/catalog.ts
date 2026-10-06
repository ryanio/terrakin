/**
 * Which item templates "Admire in 3D" knows, and how `/gallery/3d?item=...&media=...` picks one.
 * Pure, so tests pin it. RFC 0005 crafting will name these templates on inventory items.
 */
import { mediaRef } from "./layout";
import { type Flavor, isFlavor } from "./palette";

export const ITEM_TEMPLATES = [
  "jam-lemon",
  "jam-strawberry",
  "jam-berry",
  "jam-apricot",
  "painting",
  "pedestal",
  "lemon-tree",
  // Decor from the town shop (RFC 0008), named as the blocks are. The shop links to these.
  "lantern",
  "frame",
  "fence",
  "bench",
  // Autumn's decor (RFC 0017).
  "hay_bale",
  "scarecrow",
  // Halloween's decor (RFC 0022).
  "bat_bunting",
  "cauldron",
  "candy_bowl",
  // Winter's decor (RFC 0017).
  "snowman",
  "string_lights",
  "little_fir",
  "sled",
] as const;
export type ItemTemplate = (typeof ITEM_TEMPLATES)[number];

export function isItemTemplate(value: unknown): value is ItemTemplate {
  return typeof value === "string" && (ITEM_TEMPLATES as readonly string[]).includes(value);
}

/** The jam flavor a template holds, if it's a jar. */
export function jamFlavor(t: ItemTemplate): Flavor | undefined {
  const f = t.startsWith("jam-") ? t.slice(4) : "";
  return isFlavor(f) ? f : undefined;
}

export interface GalleryRequest {
  /** One item to admire up close, or the whole room when absent. */
  item?: ItemTemplate;
  /** One of our media images to hang in the painting. Never another site's URL. */
  media?: string;
}

/** Read `?item=` and `?media=` from a query string. Unknown items and foreign URLs are ignored. */
export function parseGallery(search: string): GalleryRequest {
  const q = new URLSearchParams(search);
  const out: GalleryRequest = {};
  const item = q.get("item");
  if (isItemTemplate(item)) out.item = item;
  const media = mediaRef(q.get("media"));
  if (media) out.media = media;
  return out;
}
