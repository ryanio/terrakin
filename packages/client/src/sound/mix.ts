/**
 * What the soundscape plays (decision 0097), worked out from what the world view already knows:
 * the day's phase from the server's clock (decision 0011), the weather and the season (decision
 * 0073), and the events and gestures that reach you. Pure, so the choices are tested without a
 * browser. The engine (`engine.ts`) turns them into sound.
 */
import type { GestureKind, WorldEvent } from "@terrakin/protocol";
import type { BlockKind, GroundKind, Season } from "@terrakin/sim";
import { nightAmount } from "../time";
import type { SkyAmounts } from "../weather";

/** How loud each ambient bed plays, 0 to 1, and how muffled the air is. */
export interface Beds {
  /** A light breeze, always there. */
  breeze: number;
  /** Birdsong, by day. */
  birds: number;
  /** Crickets, at night when it's warm enough. */
  crickets: number;
  /** How likely the owl is to call, deep in the night. */
  owl: number;
  rain: number;
  /** A low hush under snow and fog. */
  hush: number;
  /** How far snow and fog dull the air, 0 to 1. */
  muffle: number;
}

/** 0 at `from`, 1 at `to`, eased between (either way round). */
function ramp(x: number, from: number, to: number): number {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

const clamp = (x: number) => Math.min(1, Math.max(0, x));

/**
 * The beds for a moment: `phase` is the day's (0 dawn, 0.25 noon, 0.5 dusk, 0.75 midnight), or
 * undefined without the server's clock, when it's always day. Birds give way to crickets through
 * dusk and back at dawn, the owl calls only deep in the night, rain quiets both, and snow and fog
 * muffle everything. Crickets sit out the winter.
 */
export function bedLevels(phase: number | undefined, sky: SkyAmounts, season?: Season): Beds {
  const night = phase === undefined ? 0 : nightAmount(phase);
  const { cloud, rain, snow, fog } = sky;
  const day = ramp(night, 0.62, 0.32);
  const dark = ramp(night, 0.45, 0.75);
  const late = ramp(night, 0.7, 0.9);
  const crickets = season === "winter" ? 0 : season === "spring" ? 0.6 : 1;
  return {
    breeze: clamp(0.55 + 0.25 * cloud - 0.2 * snow - 0.35 * fog) * (1 - 0.4 * rain),
    birds:
      day *
      (1 - 0.85 * rain) *
      (1 - 0.6 * snow) *
      (1 - 0.5 * fog) *
      (1 - 0.2 * cloud) *
      (season === "winter" ? 0.5 : 1),
    crickets: crickets * dark * (1 - 0.9 * rain) * (1 - snow) * (1 - 0.4 * fog),
    owl: late * (1 - rain) * (1 - 0.5 * snow),
    rain: clamp(rain),
    hush: clamp(Math.max(snow, 0.8 * fog)),
    muffle: clamp(Math.max(snow, 0.7 * fog)),
  };
}

/** What a footstep sounds like underfoot. */
export type Surface = "grass" | "snow" | "soft" | "sand" | "leaves" | "stone" | "wood" | "rug";

const GROUND_SURFACE: Partial<Record<GroundKind, Surface>> = {
  dirt: "soft",
  sand: "sand",
  moss: "soft",
  leaves: "leaves",
  cobble: "stone",
  stepping_stones: "stone",
  brick: "stone",
  planks: "wood",
  flower_bed: "soft",
  rug: "rug",
};

/** The surface of a tile: its path or floor, or grass, which is snow in winter. */
export function surfaceOf(ground: GroundKind | undefined, season?: Season): Surface {
  if (ground) return GROUND_SURFACE[ground] ?? "soft";
  return season === "winter" ? "snow" : "grass";
}

/** What a block sounds like when it's set down. */
export type Material = "wood" | "stone" | "glass" | "leaf" | "metal" | "soft";

const BLOCK_MATERIAL: Partial<Record<BlockKind, Material>> = {
  stone: "stone",
  glass: "glass",
  leaf: "leaf",
  kitchen: "stone",
  lantern: "metal",
  pedestal: "stone",
  hay_bale: "soft",
  scarecrow: "soft",
  lamp_post: "metal",
  well: "stone",
  stone_wall: "stone",
  snowman: "soft",
  little_fir: "leaf",
};

/** A block's material. Most things are wood. */
function materialOf(block: BlockKind): Material {
  return BLOCK_MATERIAL[block] ?? "wood";
}

/** The three chimes: a wave hello, something warm, and a sparkle for kindness or a gift. */
export type Chime = "wave" | "warm" | "sparkle";

const GESTURE_CHIME: Record<GestureKind, Chime> = {
  wave: "wave",
  high_five: "wave",
  hug: "warm",
  kiss: "warm",
  comfort: "warm",
  gift: "sparkle",
};

/** The chime for a gesture someone sent you. */
export function chimeOf(kind: GestureKind): Chime {
  return GESTURE_CHIME[kind] ?? "wave";
}

/** A small sound for something that happened to you or that you did. */
export type Moment =
  /** Something set down: a block placed (`soft` for a thing picked up). */
  | { kind: "knock"; material: Material; soft?: boolean }
  /** Something taken up: a block removed, a path lifted. */
  | { kind: "lift" }
  /** Ground worked: a path laid, a seed planted. */
  | { kind: "pat"; surface: Surface }
  | { kind: "chime"; chime: Chime };

/**
 * The sound for a world event, or none. Only your own doings and kindness aimed at you make a
 * sound: what other people build, gather, or plant stays quiet, so a busy town never clatters.
 */
export function momentOf(event: WorldEvent, me: string): Moment | undefined {
  switch (event.type) {
    case "block_placed":
      return event.by === me ? { kind: "knock", material: materialOf(event.block) } : undefined;
    case "block_removed":
    case "ground_lifted":
    case "taken_down":
      return event.by === me ? { kind: "lift" } : undefined;
    case "ground_laid":
      return event.by === me ? { kind: "pat", surface: surfaceOf(event.ground) } : undefined;
    case "planted":
      return event.by === me ? { kind: "pat", surface: "soft" } : undefined;
    case "harvested":
      return event.by === me ? { kind: "knock", material: "leaf", soft: true } : undefined;
    case "gathered":
      return event.by === me
        ? { kind: "knock", material: event.kind === "stone" ? "stone" : "wood", soft: true }
        : undefined;
    case "displayed":
      return event.by === me ? { kind: "knock", material: "wood", soft: true } : undefined;
    case "admired":
      return event.maker === me && event.by !== me
        ? { kind: "chime", chime: "sparkle" }
        : undefined;
    case "coins":
      return event.residentId === me &&
        (event.reason === "gift_in" || event.reason === "appreciation")
        ? { kind: "chime", chime: "sparkle" }
        : undefined;
    default:
      return undefined;
  }
}

/** Lets something happen at most once every `gap` seconds of the clock it's given. */
export class RateLimit {
  private last = Number.NEGATIVE_INFINITY;
  constructor(private readonly gap: number) {}

  /** Whether it may happen at `now`; if so, the next may happen `gap` seconds on. */
  take(now: number): boolean {
    if (now - this.last < this.gap) return false;
    this.last = now;
    return true;
  }
}
