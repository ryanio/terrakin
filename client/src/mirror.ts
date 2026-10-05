import type { LookView, ResidentView, WorldEvent, WorldSnapshot } from "@terrakin/protocol";
import {
  type BlockKind,
  type Crop,
  type Direction,
  LOOK_KEYS,
  lookOf,
  plotKey,
  type Resident,
  shopTiles,
  tileKey,
  type WorldConfig,
} from "@terrakin/sim";

type EventMessage = { seq: number; event: WorldEvent };

/** A made thing on display, as the world shows it. Its `label` is its maker's words. */
export type DisplayView = Omit<NonNullable<WorldSnapshot["displays"]>[number], "x" | "y">;

/** The way someone faces after moving by (dx, dy): the bigger axis wins. Undefined for no move. */
export function facingFrom(dx: number, dy: number): Direction | undefined {
  if (dx === 0 && dy === 0) return undefined;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "e" : "w";
  return dy > 0 ? "s" : "n";
}

/** A resident from the wire, with unset look fields left out rather than undefined. */
export function residentFrom(view: ResidentView): Resident {
  const { theme, pattern, wear, patternMedia, homeArt, homeModel, wearStyle, ...rest } = view;
  const look = { theme, pattern, wear, patternMedia, homeArt, homeModel, wearStyle };
  return { ...rest, ...lookOf(look) };
}

/**
 * The client's read-only copy of the world. It never runs game rules: it only applies the events
 * the server sends. If it ever falls out of step, it asks for a fresh snapshot.
 */
export class Mirror {
  config: WorldConfig;
  commons: { px: number; py: number };
  seq: number;
  residents = new Map<string, Resident>();
  plots = new Map<string, string>(); // plotKey -> ownerId
  coOwners = new Map<string, string[]>(); // plotKey -> residents the owner shares it with
  blocks = new Map<string, BlockKind>(); // tileKey -> block
  /** The tiles the Town Hall stands on. Tapping one opens /town. */
  townHall: { x: number; y: number }[];
  /** The tiles the town shop stands on, once it's open (RFC 0008). Tapping one opens /shop. */
  shop: { x: number; y: number }[];
  townBuilt = new Map<string, string>(); // tileKey -> the proposal that built it
  /** Crops growing in planters (RFC 0005). */
  crops = new Map<string, { crop: Crop; plantedDay: number; readyDay: number }>();
  /** Made things on display on pedestals and frames (RFC 0005 step 3). Labels are untrusted text. */
  displays = new Map<string, DisplayView>();
  /** Today, as the world counts it. A crop is ready once this reaches its `readyDay`. */
  day: number | undefined;
  /** Which way each resident last walked. Only for drawing; nobody faces anywhere in the sim. */
  facing = new Map<string, Direction>();

  constructor(snapshot: WorldSnapshot) {
    this.config = snapshot.config;
    this.commons = snapshot.commons;
    this.seq = snapshot.seq;
    for (const r of snapshot.residents) this.residents.set(r.id, residentFrom(r));
    for (const p of snapshot.plots) {
      this.plots.set(plotKey(p.px, p.py), p.ownerId);
      if (p.coOwners?.length) this.coOwners.set(plotKey(p.px, p.py), [...p.coOwners]);
    }
    for (const b of snapshot.blocks) this.blocks.set(tileKey(b.x, b.y), b.block);
    this.townHall = (snapshot.townHall ?? []).map((t) => ({ ...t }));
    this.shop = (snapshot.shop ?? []).map((t) => ({ ...t }));
    for (const t of snapshot.townBuilt ?? []) this.townBuilt.set(tileKey(t.x, t.y), t.proposal);
    for (const c of snapshot.crops ?? []) {
      this.crops.set(tileKey(c.x, c.y), {
        crop: c.crop,
        plantedDay: c.plantedDay,
        readyDay: c.readyDay,
      });
    }
    for (const d of snapshot.displays ?? []) {
      this.displays.set(tileKey(d.x, d.y), { good: { ...d.good }, by: d.by, day: d.day });
    }
    this.day = snapshot.day;
  }

  isTownHall(x: number, y: number): boolean {
    return this.townHall.some((t) => t.x === x && t.y === y);
  }

  isShop(x: number, y: number): boolean {
    return this.shop.some((t) => t.x === x && t.y === y);
  }

  /**
   * Apply one server event. Several events can share one seq (one action, many effects).
   * - "applied": done.
   * - "stale": already included in our snapshot; ignored.
   * - "gap": we missed something. The caller should reload the snapshot.
   */
  apply({ seq, event }: EventMessage): "applied" | "stale" | "gap" {
    if (seq < this.seq) return "stale";
    if (seq > this.seq + 1) return "gap";
    this.seq = seq;
    switch (event.type) {
      case "joined":
        this.residents.set(event.resident.id, residentFrom(event.resident));
        break;
      case "left": {
        const r = this.residents.get(event.residentId);
        if (r) r.online = false;
        break;
      }
      case "profile_changed": {
        const r = this.residents.get(event.residentId);
        if (!r) break;
        Object.assign(r, { color: event.color, shape: event.shape, note: event.note });
        // The event carries the whole look: anything it leaves out is unset.
        for (const key of LOOK_KEYS) delete r[key];
        Object.assign(r, lookOf(event));
        break;
      }
      case "moved": {
        const r = this.residents.get(event.residentId);
        if (!r) break;
        const dir = facingFrom(event.x - r.x, event.y - r.y);
        if (dir) this.facing.set(r.id, dir);
        Object.assign(r, { x: event.x, y: event.y });
        break;
      }
      case "plot_claimed":
        this.plots.set(plotKey(event.px, event.py), event.ownerId);
        break;
      case "plot_released": {
        // The sim sends plot_unshared for each co-owner first; this keeps a stale list from
        // outliving the plot if one is ever missed.
        const key = plotKey(event.px, event.py);
        this.plots.delete(key);
        this.coOwners.delete(key);
        break;
      }
      case "hearth_set": {
        const r = this.residents.get(event.residentId);
        if (r) r.hearth = { x: event.x, y: event.y };
        break;
      }
      case "block_placed":
        this.blocks.set(tileKey(event.x, event.y), event.block);
        break;
      case "block_removed":
        this.blocks.delete(tileKey(event.x, event.y));
        break;
      case "plot_shared": {
        const key = plotKey(event.px, event.py);
        this.coOwners.set(key, [...(this.coOwners.get(key) ?? []), event.residentId]);
        break;
      }
      case "plot_unshared": {
        const key = plotKey(event.px, event.py);
        const rest = (this.coOwners.get(key) ?? []).filter((id) => id !== event.residentId);
        if (rest.length > 0) this.coOwners.set(key, rest);
        else this.coOwners.delete(key);
        break;
      }
      case "hearth_cleared": {
        const r = this.residents.get(event.residentId);
        if (r) r.hearth = null;
        break;
      }
      // The event names no tiles; where the shop stands is fixed by the world's size.
      case "shop_opened":
        this.shop = shopTiles(this.config);
        break;
      case "day_started":
        this.day = event.day;
        break;
      case "planted":
        this.crops.set(tileKey(event.x, event.y), {
          crop: event.crop,
          plantedDay: event.plantedDay,
          readyDay: event.readyDay,
        });
        break;
      case "harvested":
        this.crops.delete(tileKey(event.x, event.y));
        break;
      case "displayed":
        this.displays.set(tileKey(event.x, event.y), {
          good: { ...event.good },
          by: event.by,
          day: this.day ?? 0,
        });
        break;
      case "taken_down":
        this.displays.delete(tileKey(event.x, event.y));
        break;
      // The blocks themselves arrive as block_placed and block_removed just before this.
      case "town_built":
        for (const b of event.placed) this.townBuilt.set(tileKey(b.x, b.y), event.proposal);
        for (const t of event.removed) this.townBuilt.delete(tileKey(t.x, t.y));
        break;
    }
    return "applied";
  }

  /** The online resident standing on a tile, if any. */
  residentAt(x: number, y: number): Resident | undefined {
    for (const r of this.residents.values()) if (r.online && r.x === x && r.y === y) return r;
    return undefined;
  }

  ownerAt(x: number, y: number): string | undefined {
    const { plotSize } = this.config;
    return this.plots.get(plotKey(Math.floor(x / plotSize), Math.floor(y / plotSize)));
  }

  /** Residents the owner shares the plot under a tile with. Empty if it isn't shared. */
  coOwnersAt(x: number, y: number): readonly string[] {
    const { plotSize } = this.config;
    return this.coOwners.get(plotKey(Math.floor(x / plotSize), Math.floor(y / plotSize))) ?? [];
  }
}
