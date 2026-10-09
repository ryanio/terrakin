import {
  everyoneIn,
  facingFrom,
  type PetView,
  type ResidentView,
  ROUTINE_LIMITS,
  type WorldEvent,
  type WorldSnapshot,
} from "@terrakin/protocol";
import {
  type BlockKind,
  type Crop,
  type Direction,
  type FindKind,
  type Ground,
  type GroundKind,
  groundOf,
  LOOK_KEYS,
  lookOf,
  mayGatherOn,
  type Pet,
  type PickupKind,
  pickupOn,
  plotKey,
  type Resident,
  STOREYS,
  type StepRoutine,
  shopTiles,
  tileKey,
  type WorldConfig,
} from "@terrakin/sim";
import type { EventMark } from "./event-format";
import { type Dozer, dozers } from "./scene3d/layout";
import type { StoreyLayers } from "./storeys";

type EventMessage = { seq: number; event: WorldEvent };

/** A made thing on display, as the world shows it. Its `label` is its maker's words. */
export type DisplayView = Omit<NonNullable<WorldSnapshot["displays"]>[number], "x" | "y">;

/** A find on display (RFC 0021): its kind, who put it up, and the day it went up. No words. */
export interface ShownFindView {
  kind: FindKind;
  by: string;
  day: number;
}

/** A pet from the wire, with unset fields left out rather than undefined. */
function petFrom(view: PetView): Pet {
  const { adoptedDay, renamedDay, treat, ...rest } = view;
  return {
    ...rest,
    ...(adoptedDay === undefined ? {} : { adoptedDay }),
    ...(renamedDay === undefined ? {} : { renamedDay }),
    ...(treat ? { treat: { ...treat } } : {}),
  };
}

/** A resident from the wire, with unset look fields left out rather than undefined. */
function residentFrom(view: ResidentView): Resident {
  // `facing` and `routine` are for drawing; the mirror keeps them outside the resident.
  const {
    storey,
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
    routine,
    pet,
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
  return {
    ...rest,
    ...lookOf(look),
    ...(pet ? { pet: petFrom(pet) } : {}),
    // Upstairs (RFC 0028); absent on the ground floor.
    ...(storey ? { storey } : {}),
  };
}

/** One storey above the ground floor (RFC 0028): its blocks and its floors, by tileKey. */
export interface StoreyLayer {
  blocks: Map<string, BlockKind>;
  paving: Map<string, GroundKind>;
}

const NO_STOREY: Readonly<StoreyLayer> = { blocks: new Map(), paving: new Map() };

/** How long an away resident is out after a routine's step reaches us, before they sleep again. */
export const OUT_MS = ROUTINE_LIMITS.awakeMinutes * 60_000;

/** An away resident out on a routine (RFC 0009): which one, and when its last step reached us. */
export interface OutOnRoutine {
  r: Resident;
  routine: StepRoutine;
}

/**
 * The client's read-only copy of the world. It never runs game rules: it only applies the events
 * the server sends. If it ever falls out of step, it asks for a fresh snapshot.
 */
export class Mirror {
  config: WorldConfig;
  commons: { px: number; py: number };
  seq: number;
  /** Everyone on the map, the townsfolk included. */
  residents = new Map<string, Resident>();
  /** The townsfolk among `residents`, never counted as residents. */
  townsfolk: ReadonlySet<string>;
  /** Unused records of a name someone else has (`repeatJoins`), left out of the count too. */
  repeatJoins: ReadonlySet<string>;
  plots = new Map<string, string>(); // plotKey -> ownerId
  coOwners = new Map<string, string[]>(); // plotKey -> residents the owner shares it with
  blocks = new Map<string, BlockKind>(); // tileKey -> block
  /** Paths and floors under the blocks (RFC 0016), by tileKey. Nobody walks differently for them. */
  paving = new Map<string, GroundKind>();
  /**
   * Each storey above the ground floor (RFC 0028), by its number. `blocks` and `paving` are the
   * ground floor's, which is what everything but the map's storeys reads.
   */
  upstairs = new Map<number, StoreyLayer>();
  /** How many storeys each plot added above its ground floor, by plotKey. */
  storeys = new Map<string, number>();
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
  /** Plots' names (`name_plot`, decision 0121), by plotKey. Residents' words: text only. */
  plotNames = new Map<string, string>();
  /** Made things on display on pedestals and frames (RFC 0005 step 3). Labels are untrusted text. */
  displays = new Map<string, DisplayView>();
  /** Finds on display on pedestals and frames (RFC 0021), by tileKey. */
  shownFinds = new Map<string, ShownFindView>();
  /** Tiles picked clean today, so a pickup that's gone isn't drawn (phase 1 gathering). */
  gathered = new Set<string>();
  /** Whether a claimed plot's pickups are for its owner and co-owners only (`plot_pickups_owned`). */
  plotPickupsOwned = false;
  /** Whether finds lie on the ground (`finds_opened`, RFC 0021), so `pickupAt` draws them too. */
  findsOpen = false;
  /**
   * Whether recipes are learned (`recipes_opened`, RFC 0024): `teach` works, and `pickupAt` draws
   * recipe pages. What anyone knows isn't here; `inventory.recipes` and profiles say that.
   */
  recipesOpen = false;
  /** Today, as the world counts it. A crop is ready once this reaches its `readyDay`. */
  day: number | undefined;
  /** Which way each resident last walked. Only for drawing; nobody faces anywhere in the sim. */
  facing = new Map<string, Direction>();
  /** Who is asleep at home and where, worked out again after any event (`asleep`). */
  #dozing: { me: string | undefined; list: readonly Dozer<Resident>[] } | undefined;
  /** Events on the calendar (RFC 0010): where and when, never their words. By id. */
  events = new Map<string, EventMark>();
  /** Game tables standing in the Commons (RFC 0011), by id. Tapping one opens its page. */
  tables = new Map<string, { x: number; y: number; playing: boolean }>();
  /**
   * Away residents out on a routine (decision 0083): the routine, and when its last step reached
   * this copy, on `clock`. They're drawn where they are, awake, until `OUT_MS` after it.
   */
  #out = new Map<string, { routine: StepRoutine; at: number }>();
  readonly #clock: () => number;

  /** `clock` times routine steps for drawing; the default is the page's own. */
  constructor(snapshot: WorldSnapshot, clock: () => number = () => performance.now()) {
    this.#clock = clock;
    this.config = snapshot.config;
    this.commons = snapshot.commons;
    this.seq = snapshot.seq;
    this.townsfolk = new Set(snapshot.townsfolk ?? []);
    this.repeatJoins = new Set(snapshot.repeatJoins ?? []);
    for (const r of everyoneIn(snapshot)) {
      this.residents.set(r.id, residentFrom(r));
      if (r.facing) this.facing.set(r.id, r.facing);
      if (!r.online && r.routine) this.#out.set(r.id, { routine: r.routine, at: clock() });
    }
    for (const p of snapshot.plots) {
      this.plots.set(plotKey(p.px, p.py), p.ownerId);
      if (p.coOwners?.length) this.coOwners.set(plotKey(p.px, p.py), [...p.coOwners]);
      if (p.gallery) this.galleries.add(plotKey(p.px, p.py));
      if (p.name !== undefined) this.plotNames.set(plotKey(p.px, p.py), p.name);
      if (p.storeys) this.storeys.set(plotKey(p.px, p.py), p.storeys);
    }
    for (const b of snapshot.blocks) this.blocksAt(b.storey).set(tileKey(b.x, b.y), b.block);
    for (const g of snapshot.ground ?? []) {
      this.pavingAt(g.storey).set(tileKey(g.x, g.y), g.ground);
    }
    this.townHall = snapshot.townHall.map((t) => ({ ...t }));
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
    for (const f of snapshot.displayedFinds ?? []) {
      this.shownFinds.set(tileKey(f.x, f.y), { kind: f.kind, by: f.by, day: f.day });
    }
    for (const t of snapshot.gathered ?? []) this.gathered.add(tileKey(t.x, t.y));
    this.plotPickupsOwned = snapshot.plotPickupsOwned === true;
    this.findsOpen = snapshot.findsOpen === true;
    this.recipesOpen = snapshot.recipesOpen === true;
    this.day = snapshot.day;
    for (const t of snapshot.tables ?? []) {
      this.tables.set(t.id, { x: t.x, y: t.y, playing: t.status === "playing" });
    }
    for (const e of snapshot.events ?? []) {
      this.events.set(e.id, {
        id: e.id,
        px: e.px,
        py: e.py,
        status: e.status,
        startsAt: e.startsAt,
        ...(e.town ? { town: true as const } : {}),
      });
    }
  }

  /** A storey's layer, made when it first has something. */
  #layer(storey: number): StoreyLayer {
    let layer = this.upstairs.get(storey);
    if (!layer) {
      layer = { blocks: new Map(), paving: new Map() };
      this.upstairs.set(storey, layer);
    }
    return layer;
  }

  /** The blocks on a storey (absent or 0: the ground floor's), to change. */
  blocksAt(storey: number | undefined): Map<string, BlockKind> {
    return storey ? this.#layer(storey).blocks : this.blocks;
  }

  /** The paths and floors on a storey (absent or 0: the ground floor's), to change. */
  pavingAt(storey: number | undefined): Map<string, GroundKind> {
    return storey ? this.#layer(storey).paving : this.paving;
  }

  /** A storey above the ground floor as it is, to read: empty until something is on it. */
  storey(storey: number): Readonly<StoreyLayer> {
    return this.upstairs.get(storey) ?? NO_STOREY;
  }

  /** Whether anything stands or lies on any storey above the ground floor. */
  hasUpstairs(): boolean {
    for (const layer of this.upstairs.values()) {
      if (layer.blocks.size > 0 || layer.paving.size > 0) return true;
    }
    return false;
  }

  /** The storeys above the ground floor, as the map's cutaway reads them (`storeys.ts`). */
  layers(): StoreyLayers {
    return {
      top: STOREYS.max,
      has: (storey, x, y) => {
        const layer = this.upstairs.get(storey);
        const key = tileKey(x, y);
        return layer !== undefined && (layer.blocks.has(key) || layer.paving.has(key));
      },
      floor: (storey, x, y) => this.upstairs.get(storey)?.paving.has(tileKey(x, y)) === true,
    };
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
    this.#dozing = undefined;
    switch (event.type) {
      case "joined":
        this.residents.set(event.resident.id, residentFrom(event.resident));
        this.#out.delete(event.resident.id);
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
        // Up or down a storey (RFC 0028): absent on the ground floor.
        if (event.storey) r.storey = event.storey;
        else delete r.storey;
        if (event.routine) this.#out.set(r.id, { routine: event.routine, at: this.#clock() });
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
        // A plot's name goes with it (decision 0121), and so do its storeys (RFC 0028).
        this.plotNames.delete(key);
        this.storeys.delete(key);
        break;
      }
      case "storey_added":
        this.storeys.set(plotKey(event.px, event.py), event.storey);
        break;
      case "plot_named": {
        const key = plotKey(event.px, event.py);
        if (event.name === null) this.plotNames.delete(key);
        else this.plotNames.set(key, event.name);
        break;
      }
      case "plot_name_removed":
        this.plotNames.delete(plotKey(event.px, event.py));
        break;
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
      // On the storey each names (RFC 0028): absent is the ground floor.
      case "block_placed":
        this.blocksAt(event.storey).set(tileKey(event.x, event.y), event.block);
        break;
      case "block_removed":
        this.blocksAt(event.storey).delete(tileKey(event.x, event.y));
        break;
      case "ground_laid":
        this.pavingAt(event.storey).set(tileKey(event.x, event.y), event.ground);
        break;
      case "ground_lifted":
        this.pavingAt(event.storey).delete(tileKey(event.x, event.y));
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
      case "find_displayed":
        this.shownFinds.set(tileKey(event.x, event.y), {
          kind: event.kind,
          by: event.by,
          day: this.day ?? 0,
        });
        break;
      case "taken_down":
      case "display_removed":
        this.displays.delete(tileKey(event.x, event.y));
        this.shownFinds.delete(tileKey(event.x, event.y));
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
      // Pets (RFC 0019). Where a pet is drawn is up to `pets.ts`; the mirror keeps what it is.
      case "pet_adopted": {
        const r = this.residents.get(event.residentId);
        if (r) r.pet = petFrom(event.pet);
        break;
      }
      case "pet_renamed":
      case "pet_groomed":
      case "pet_treated": {
        const r = this.residents.get(event.residentId);
        if (!r?.pet) break;
        if (event.type === "pet_renamed") {
          const day = event.day === undefined ? {} : { renamedDay: event.day };
          r.pet = { ...r.pet, name: event.name, ...day };
        } else if (event.type === "pet_groomed") r.pet = { ...r.pet, coat: event.coat };
        else r.pet = { ...r.pet, treat: { day: this.day ?? 0, by: event.by, kind: event.kind } };
        break;
      }
      case "plot_pickups_owned":
        this.plotPickupsOwned = true;
        break;
      case "finds_opened":
        this.findsOpen = true;
        break;
      case "recipes_opened":
        this.recipesOpen = true;
        break;
      case "repeat_joins_retired": {
        const gone = new Set(event.ids);
        for (const id of gone) {
          this.residents.delete(id);
          this.facing.delete(id);
          this.#out.delete(id);
        }
        this.repeatJoins = new Set([...this.repeatJoins].filter((id) => !gone.has(id)));
        break;
      }
      case "resident_merged":
        this.residents.delete(event.from);
        this.facing.delete(event.from);
        this.#out.delete(event.from);
        this.repeatJoins = new Set([...this.repeatJoins].filter((id) => id !== event.from));
        break;
      case "event_scheduled":
        this.events.set(event.event, {
          id: event.event,
          px: event.px,
          py: event.py,
          status: "scheduled",
          startsAt: event.startsAt,
          ...(event.town ? { town: true as const } : {}),
        });
        break;
      case "event_started": {
        const e = this.events.get(event.event);
        if (e) e.status = "live";
        break;
      }
      case "event_ended":
      case "event_cancelled":
        this.events.delete(event.event);
        break;
      case "table_opened":
        this.tables.set(event.table, { x: event.x, y: event.y, playing: false });
        break;
      case "game_started": {
        const t = this.tables.get(event.table);
        if (t) t.playing = true;
        break;
      }
      case "game_over":
      case "table_closed":
        this.tables.delete(event.table);
        break;
      // The blocks themselves arrive as block_placed and block_removed just before this.
      case "town_built":
        for (const b of event.placed) this.townBuilt.set(tileKey(b.x, b.y), event.proposal);
        for (const t of event.removed) this.townBuilt.delete(tileKey(t.x, t.y));
        break;
    }
    return "applied";
  }

  /** The game table standing on a tile, if any, by id. */
  tableAt(x: number, y: number): string | undefined {
    for (const [id, t] of this.tables) if (t.x === x && t.y === y) return id;
    return undefined;
  }

  /** The online resident standing on a tile, if any. */
  residentAt(x: number, y: number): Resident | undefined {
    for (const r of this.residents.values()) if (r.online && r.x === x && r.y === y) return r;
    return undefined;
  }

  /** Forget routine walks that ended, so those residents sleep at home again. */
  #settle() {
    const now = this.#clock();
    for (const [id, out] of this.#out) {
      if (now - out.at < OUT_MS && this.residents.get(id)?.online === false) continue;
      this.#out.delete(id);
      this.#dozing = undefined;
    }
  }

  /**
   * Away residents out on a routine right now (RFC 0009, decision 0083), leaving out `me`: drawn
   * where the server has them, awake and faded, until `OUT_MS` after the routine's last step, and
   * never counted as here.
   */
  outOnRoutine(me?: string): OutOnRoutine[] {
    this.#settle();
    const list: OutOnRoutine[] = [];
    for (const [id, out] of this.#out) {
      const r = this.residents.get(id);
      if (r && id !== me) list.push({ r, routine: out.routine });
    }
    return list;
  }

  /**
   * Residents away from the world, drawn asleep at their hearths, and where (`dozers` in
   * `scene3d/layout.ts`), leaving out `me` and anyone out on a routine. Drawing only: they're
   * never "here" (decision 0086).
   */
  asleep(me?: string): readonly Dozer<Resident>[] {
    this.#settle();
    const seen = this.#dozing;
    if (seen && seen.me === me) return seen.list;
    const hearths = new Set<string>();
    for (const r of this.residents.values())
      if (r.hearth) hearths.add(tileKey(r.hearth.x, r.hearth.y));
    const { width, height } = this.config;
    const free = (x: number, y: number) =>
      x >= 0 &&
      y >= 0 &&
      x < width &&
      y < height &&
      !this.blocks.has(tileKey(x, y)) &&
      !hearths.has(tileKey(x, y));
    const home = [...this.residents.values()].filter((r) => !this.#out.has(r.id));
    const list = dozers(home, free, me);
    this.#dozing = { me, list };
    return list;
  }

  /**
   * The fallen branch, loose stone, find, or recipe page lying on a tile today, from the sim's own
   * spawn.
   */
  pickupAt(x: number, y: number): PickupKind | null {
    if (this.day === undefined) return null;
    const key = tileKey(x, y);
    return pickupOn(this.config, x, y, this.day, {
      built: this.blocks.has(key),
      picked: this.gathered.has(key),
      finds: this.findsOpen,
      pages: this.recipesOpen,
    });
  }

  /** Whether a resident may pick up what lies on a tile: the sim's own rule, asked of this copy. */
  mayGatherAt(x: number, y: number, residentId: string): boolean {
    const ownerId = this.ownerAt(x, y);
    const plot = ownerId ? { ownerId, coOwners: [...this.coOwnersAt(x, y)] } : undefined;
    return mayGatherOn(plot, residentId, this.plotPickupsOwned);
  }

  /** Whether someone's hearth is on this tile. */
  hearthAt(x: number, y: number): boolean {
    for (const r of this.residents.values()) if (r.hearth?.x === x && r.hearth.y === y) return true;
    return false;
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
