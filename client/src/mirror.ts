import {
  facingFrom,
  type ResidentView,
  type WorldEvent,
  type WorldSnapshot,
} from "@terrakin/protocol";
import {
  type BlockKind,
  type Crop,
  type Direction,
  type Ground,
  groundOf,
  LOOK_KEYS,
  lookOf,
  mayGatherOn,
  pickupOn,
  plotKey,
  type Resident,
  type ResourceKind,
  shopTiles,
  tileKey,
  type WorldConfig,
} from "@terrakin/sim";

type EventMessage = { seq: number; event: WorldEvent };

/** A made thing on display, as the world shows it. Its `label` is its maker's words. */
export type DisplayView = Omit<NonNullable<WorldSnapshot["displays"]>[number], "x" | "y">;

/** A resident from the wire, with unset look fields left out rather than undefined. */
export function residentFrom(view: ResidentView): Resident {
  // `facing` is for drawing; the mirror keeps it in `facing`, outside the resident.
  const {
    theme,
    pattern,
    wear,
    patternMedia,
    homeArt,
    homeModel,
    wearStyle,
    hair,
    hairColor,
    facing,
    ...rest
  } = view;
  const look = {
    theme,
    pattern,
    wear,
    patternMedia,
    homeArt,
    homeModel,
    wearStyle,
    hair,
    hairColor,
  };
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
  /** Whether the Town Hall and the shop stop walkers (`solid_buildings`). */
  solidBuildings: boolean;
  private walkable: Ground | undefined;
  townBuilt = new Map<string, string>(); // tileKey -> the proposal that built it
  /** Crops growing in planters (RFC 0005). */
  crops = new Map<string, { crop: Crop; plantedDay: number; readyDay: number }>();
  /** Plots opened as galleries (`set_gallery`), by plotKey. */
  galleries = new Set<string>();
  /** Made things on display on pedestals and frames (RFC 0005 step 3). Labels are untrusted text. */
  displays = new Map<string, DisplayView>();
  /** Tiles picked clean today, so a pickup that's gone isn't drawn (phase 1 gathering). */
  gathered = new Set<string>();
  /** Whether a claimed plot's pickups are for its owner and co-owners only (`plot_pickups_owned`). */
  plotPickupsOwned = false;
  /** Today, as the world counts it. A crop is ready once this reaches its `readyDay`. */
  day: number | undefined;
  /** Which way each resident last walked. Only for drawing; nobody faces anywhere in the sim. */
  facing = new Map<string, Direction>();

  constructor(snapshot: WorldSnapshot) {
    this.config = snapshot.config;
    this.commons = snapshot.commons;
    this.seq = snapshot.seq;
    for (const r of snapshot.residents) {
      this.residents.set(r.id, residentFrom(r));
      if (r.facing) this.facing.set(r.id, r.facing);
    }
    for (const p of snapshot.plots) {
      this.plots.set(plotKey(p.px, p.py), p.ownerId);
      if (p.coOwners?.length) this.coOwners.set(plotKey(p.px, p.py), [...p.coOwners]);
      if (p.gallery) this.galleries.add(plotKey(p.px, p.py));
    }
    for (const b of snapshot.blocks) this.blocks.set(tileKey(b.x, b.y), b.block);
    this.townHall = (snapshot.townHall ?? []).map((t) => ({ ...t }));
    this.shop = (snapshot.shop ?? []).map((t) => ({ ...t }));
    this.solidBuildings = snapshot.solidBuildings === true;
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
    for (const t of snapshot.gathered ?? []) this.gathered.add(tileKey(t.x, t.y));
    this.plotPickupsOwned = snapshot.plotPickupsOwned === true;
    this.day = snapshot.day;
  }

  isTownHall(x: number, y: number): boolean {
    return this.townHall.some((t) => t.x === x && t.y === y);
  }

  isShop(x: number, y: number): boolean {
    return this.shop.some((t) => t.x === x && t.y === y);
  }

  /** The ground as the sim's walking rule sees it, so a step is checked here as it is there. */
  ground(): Ground {
    this.walkable ??= groundOf({
      config: this.config,
      hasBlock: (x, y) => this.blocks.has(tileKey(x, y)),
      solidBuildings: this.solidBuildings,
      shopOpen: this.shop.length > 0,
    });
    return this.walkable;
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
        this.galleries.delete(key);
        break;
      }
      case "gallery_set": {
        const key = plotKey(event.px, event.py);
        if (event.open) this.galleries.add(key);
        else this.galleries.delete(key);
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
        this.walkable = undefined;
        break;
      case "buildings_solid":
        this.solidBuildings = true;
        this.walkable = undefined;
        break;
      case "day_started":
        this.day = event.day;
        // A new day grows every tile's pickup back.
        this.gathered.clear();
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
      case "display_removed":
        this.displays.delete(tileKey(event.x, event.y));
        break;
      case "picture_removed":
        for (const shown of this.displays.values()) {
          if (!event.items.includes(shown.good.id)) continue;
          delete shown.good.media;
          delete shown.good.model;
        }
        break;
      case "admired": {
        const shown = this.displays.get(tileKey(event.x, event.y));
        if (shown?.good.id === event.item) shown.good.admired = event.admired;
        break;
      }
      case "gathered":
        this.gathered.add(tileKey(event.x, event.y));
        break;
      case "plot_pickups_owned":
        this.plotPickupsOwned = true;
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

  /** The fallen branch or loose stone lying on a tile today, from the sim's own spawn. */
  pickupAt(x: number, y: number): ResourceKind | null {
    if (this.day === undefined) return null;
    const key = tileKey(x, y);
    return pickupOn(this.config, x, y, this.day, {
      built: this.blocks.has(key),
      picked: this.gathered.has(key),
    });
  }

  /** Whether a resident may pick up what lies on a tile: the sim's own rule, asked of this copy. */
  mayGatherAt(x: number, y: number, residentId: string): boolean {
    const ownerId = this.ownerAt(x, y);
    const plot = ownerId ? { ownerId, coOwners: [...this.coOwnersAt(x, y)] } : undefined;
    return mayGatherOn(plot, residentId, this.plotPickupsOwned);
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
