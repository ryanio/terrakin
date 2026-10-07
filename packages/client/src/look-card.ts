/**
 * Looking at a place a link named (decision 0162): where that place is on the map now, what the
 * card over it says, and what Go there sends. The card names what's there (a resident, or a plot
 * and its name) and offers Go there and Back to me, or, for someone with no character yet, a way to
 * step inside first. Opening a link never acts: Go there is a tap, and the server decides it.
 * Names are residents' words: text only.
 */
import { canBuildOn, plotKey, plotOf, type Tile, type WorldConfig } from "@terrakin/sim";
import { profilePath } from "@terrakin/ui/paths";
import type { Dozer } from "./scene3d/layout";
import { plotTitles } from "./visits";
import type { LookTarget } from "./world-link";

/** What `placeOf` reads of the world: a mirror, or a plain copy of one in tests. */
export interface LookWorld {
  config: WorldConfig;
  commons: { px: number; py: number };
  residents: ReadonlyMap<
    string,
    { id: string; name: string; online: boolean; x: number; y: number; hearth: Tile | null }
  >;
  plots: ReadonlyMap<string, string>;
  coOwners: ReadonlyMap<string, readonly string[]>;
  plotNames: ReadonlyMap<string, string>;
  outOnRoutine(me?: string): readonly { r: { id: string }; routine: string }[];
  asleep(me?: string): readonly Dozer<{ id: string }>[];
}

/** A place on the map to look at, as it is now. */
export interface Place {
  /** The tile to look at. */
  x: number;
  y: number;
  /** The plot that tile is on. */
  px: number;
  py: number;
  /** What's there: a resident's name, or the plot's. Residents' words. */
  title: string;
  /** A line under the title, or null. */
  line: string | null;
  /** Whose profile the title opens, if anyone's. */
  profile: string | null;
  /** The resident looked at, while the map draws them walking: the camera follows their figure. */
  follow?: string;
}

const AWAY_LINE = { stroll: "Out on a stroll", home: "Just walked home" } as const;

/**
 * Where a link's place is on the map now, and what to call it, or undefined when it isn't there: a
 * resident the world doesn't know or doesn't draw (away with no hearth), or a plot off the map. A
 * resident is where the map draws them: up and about, out on a routine, or asleep at their hearth.
 */
export function placeOf(world: LookWorld, target: LookTarget, me?: string): Place | undefined {
  const { plotSize } = world.config;
  if (target.kind === "plot") {
    const { px, py } = target;
    if (px * plotSize >= world.config.width || py * plotSize >= world.config.height)
      return undefined;
    const middle = Math.floor(plotSize / 2);
    const at = { x: px * plotSize + middle, y: py * plotSize + middle, px, py };
    if (px === world.commons.px && py === world.commons.py)
      return { ...at, title: "The Commons", line: null, profile: null };
    const owner = world.plots.get(plotKey(px, py));
    if (owner === undefined)
      return { ...at, title: "An empty plot", line: "Nobody lives here yet.", profile: null };
    return { ...at, ...plotWords(world, px, py, me), profile: owner };
  }
  const r = world.residents.get(target.id);
  if (!r) return undefined;
  const near = (x: number, y: number, line: string | null, follow: boolean): Place => ({
    x,
    y,
    ...plotOf(world.config, x, y),
    title: r.name,
    line,
    profile: r.id,
    ...(follow ? { follow: r.id } : {}),
  });
  if (r.online) return near(r.x, r.y, whereLine(world, r.x, r.y, me), true);
  const out = world.outOnRoutine(me).find((o) => o.r.id === r.id);
  if (out) return near(r.x, r.y, AWAY_LINE[out.routine === "stroll" ? "stroll" : "home"], true);
  const asleep = world.asleep(me).find((d) => d.r.id === r.id);
  if (asleep) return near(asleep.x, asleep.y, "Asleep at home", false);
  return undefined;
}

/** A plot's name over whose it is, or whose it is alone (decision 0121). */
function plotWords(
  world: LookWorld,
  px: number,
  py: number,
  me: string | undefined,
): { title: string; line: string | null } {
  const key = plotKey(px, py);
  const owner = world.plots.get(key) ?? "";
  const coOwners = world.coOwners.get(key) ?? [];
  const mine = me !== undefined && canBuildOn({ ownerId: owner, coOwners: [...coOwners] }, me);
  const name = world.plotNames.get(key);
  const names = [owner, ...coOwners].map((id) => world.residents.get(id)?.name ?? "A neighbor");
  const words = plotTitles({ name }, names);
  const whose = mine ? "Your plot" : words.whose;
  return name
    ? { title: name, line: whose }
    : { title: mine ? "Your plot" : words.title, line: null };
}

/** Where a resident up and about stands: the Commons, or the plot they're on, in words. */
function whereLine(world: LookWorld, x: number, y: number, me: string | undefined): string | null {
  const { px, py } = plotOf(world.config, x, y);
  if (px === world.commons.px && py === world.commons.py) return "In the Commons";
  if (!world.plots.has(plotKey(px, py))) return null;
  return `At ${plotWords(world, px, py, me).title}`;
}

/** What Go there sends: a visit to a neighbor's door, home to your own hearth, or a walk. */
export type Way =
  | { type: "visit"; px: number; py: number }
  | { type: "home" }
  | { type: "walk"; to: Tile };

/**
 * How to get to a place. A plot someone else lives on is a `visit`, which lands you at its door
 * (decision 0091); your own plot with your hearth on it is `home` (decision 0009); the Commons and
 * plots nobody lives on are a walk, since `visit` only goes to a lived-in plot.
 */
export function wayThere(
  world: Pick<LookWorld, "config" | "plots" | "coOwners" | "residents">,
  place: Pick<Place, "x" | "y" | "px" | "py">,
  me: string,
): Way {
  const key = plotKey(place.px, place.py);
  const ownerId = world.plots.get(key);
  if (ownerId !== undefined) {
    const plot = { ownerId, coOwners: [...(world.coOwners.get(key) ?? [])] };
    if (!canBuildOn(plot, me)) return { type: "visit", px: place.px, py: place.py };
    const hearth = world.residents.get(me)?.hearth;
    const home = hearth ? plotOf(world.config, hearth.x, hearth.y) : undefined;
    if (home && home.px === place.px && home.py === place.py) return { type: "home" };
  }
  return { type: "walk", to: { x: place.x, y: place.y } };
}

export interface LookCardOptions {
  /** Go there: the world sends it. */
  go(): void;
  /** Back to me: the camera follows you again. */
  back(): void;
  /** Someone with no character yet: the join form. */
  join(): void;
}

export interface LookCard {
  /** Show the place, with Go there and Back to me, or with a way in for someone not in yet. */
  show(place: Place, joined: boolean): void;
  hide(): void;
  /** How far down the screen the card reaches, in CSS pixels: 0 while it's hidden. */
  bottom(): number;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The card at the top of the world while you look at a place a link named. */
export function lookCard(o: LookCardOptions): LookCard {
  const el = $("look-card");
  const title = $<HTMLAnchorElement>("look-card-title");
  const line = $("look-card-line");
  const go = $<HTMLButtonElement>("look-go");
  const back = $<HTMLButtonElement>("look-back");
  const join = $<HTMLButtonElement>("look-join");
  /** What the card shows now, so a still frame changes nothing. */
  let shown = "";

  go.addEventListener("click", () => o.go());
  back.addEventListener("click", () => o.back());
  join.addEventListener("click", () => o.join());

  return {
    show(place, joined) {
      const look = `${joined} ${place.title} ${place.line} ${place.profile}`;
      if (look === shown) return;
      shown = look;
      title.textContent = place.title;
      if (place.profile) title.href = profilePath(place.profile);
      else title.removeAttribute("href");
      line.textContent = place.line ?? "";
      line.hidden = place.line === null;
      go.hidden = !joined;
      back.hidden = !joined;
      join.hidden = joined;
      el.hidden = false;
    },
    hide() {
      shown = "";
      el.hidden = true;
    },
    bottom: () => (el.hidden ? 0 : el.getBoundingClientRect().bottom),
  };
}
