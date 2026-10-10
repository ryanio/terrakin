import {
  type LookCard,
  type NearCard,
  type PlacedFigure,
  type PlotArea,
  type PlotCard,
  RESIDENT_HEX,
} from "@terrakin/cards";
import {
  alphaHex,
  blocksOn,
  DAY_LENGTH_MS,
  dayPhase,
  FLOORS,
  groundOn,
  isCommons,
  nightAmount,
  type PetCoat,
  type PetKind,
  petBed,
  petShapes,
  plotKey,
  plotOf,
  type Resident,
  residentById,
  skyAt,
  standingFloor,
  THEME_INFO,
  THEME_TINT_ALPHA,
  type ThemePalette,
  tileKey,
  timeOfDay,
  WEAR_INFO,
  type WorldState,
  worldGround,
} from "@terrakin/sim";
import { type EdgeLook, figureDrawing, hairName } from "@terrakin/ui/figure-svg";
import {
  areaOf,
  drawnFromAbove,
  materializePlot,
  type PlotPhotoSpec,
  petPicture,
  plotInk,
  plotSpecOf,
} from "./plot-photo";

/**
 * Pictures by link (decision 0160): public PNGs an agent can paste into a chat so its person sees
 * the world. Three of them, each a card drawn like the link previews (`og.ts` serves them):
 *
 *   /og/plot/<px>-<py>.png     a plot as it looks now, with whoever is standing on it
 *   /og/look/<residentId>.png  a resident in their look, with their pet
 *   /og/near/<residentId>.png  the map around where a resident is right now
 *
 * This file builds each picture's data from world state alone (`pictureSpec`, which the World
 * object runs: cheap, no drawing) and turns it into a card (`materializePicture`, which the Worker
 * runs, or Node in-process: the figures are drawn and the home picture loaded there). Uploaded art
 * shows only in a plot picture, only as its owner's home picture, and never for an owner staff
 * suspended or whose pictures staff removed (`artShown`).
 */

export type PictureRoute =
  | { kind: "plot"; px: number; py: number }
  | { kind: "look"; id: string }
  | { kind: "near"; id: string };

/**
 * A resident's figure before it's drawn: where their feet are, in tiles, their look, and whether
 * flooring the picture draws over them hides them, so they're drawn faded (RFC 0028).
 */
interface SpecFigure {
  x: number;
  y: number;
  look: EdgeLook;
  faded?: true;
}

type PlotPictureSpec = Omit<PlotPhotoSpec, "figures"> & { figures?: SpecFigure[] };
export type NearSpec = Omit<NearCard, "area"> & {
  area: Omit<PlotArea, "figures"> & { figures: SpecFigure[] };
};
export type LookSpec = Omit<LookCard, "figure" | "pet"> & {
  look: EdgeLook;
  pet?: { kind: PetKind; coat: PetCoat } | undefined;
};
export type PictureSpec = PlotPictureSpec | NearSpec | LookSpec;

export interface PictureOptions {
  /** The server's clock, for the light and the sky over `near`. */
  nowMs: number;
  /** Whether staff hold back a resident's words (a quarantine): a plot name they gave stays out. */
  held: (id: string) => boolean;
  /**
   * Whether `mediaId`, an upload of resident `id`, may show: they aren't suspended, staff never
   * removed their pictures, and the upload is still theirs and not purged. A purge then changes the
   * picture's data, so a cached PNG with the art in it is never served again.
   */
  artShown: (id: string, mediaId: string) => boolean;
}

/** The map around someone, in tiles: as wide as the photo is, about 2.4 to 1. */
const NEAR_COLS = 24;
const NEAR_ROWS = 10;
/** Most figures a picture draws, nearest first. Each costs a few hundred shapes. */
const MAX_FIGURES = 16;
/** Where a figure's feet are in its tile, as the map stands it. */
const FEET = 0.88;

/** A resident's look as a picture draws it: no uploaded pattern tile, ever. */
export function edgeLook(r: Resident): EdgeLook {
  const styles = r.wearStyle
    ? Object.fromEntries(
        Object.entries(r.wearStyle).filter(
          (e): e is [string, NonNullable<(typeof e)[1]>] => e[1] != null,
        ),
      )
    : undefined;
  return {
    color: r.color,
    shape: r.shape,
    ...(r.theme ? { theme: r.theme } : {}),
    ...(r.pattern ? { pattern: r.pattern } : {}),
    ...(r.wear?.length ? { wear: [...r.wear] } : {}),
    ...(styles && Object.keys(styles).length ? { wearStyle: styles } : {}),
    ...(r.hair ? { hair: r.hair } : {}),
    ...(r.hairColor ? { hairColor: r.hairColor } : {}),
  };
}

/**
 * Whether a picture from above draws flooring or a block over someone on `floor` at (x, y), as the
 * map's `underFlooring` has it for every plot but the one you stand on.
 */
function underFlooring(state: WorldState, x: number, y: number, floor: number): boolean {
  const key = tileKey(x, y);
  for (let above = floor + 1; above <= FLOORS.max; above++) {
    if (blocksOn(state, above)[key] !== undefined || groundOn(state, above)[key] !== undefined) {
      return true;
    }
  }
  return false;
}

/** Online residents standing in the box from (x0, y0), `cols` by `rows`, nearest `here` first. */
function figuresIn(
  state: WorldState,
  x0: number,
  y0: number,
  cols: number,
  rows: number,
  here: { x: number; y: number },
): SpecFigure[] {
  return Object.values(state.residents)
    .filter((r) => r.online && r.x >= x0 && r.x < x0 + cols && r.y >= y0 && r.y < y0 + rows)
    .sort(
      (a, b) =>
        Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y) ||
        (a.id < b.id ? -1 : 1),
    )
    .slice(0, MAX_FIGURES)
    .map((r) => ({
      x: r.x - x0 + 0.5,
      y: r.y - y0 + FEET,
      look: edgeLook(r),
      ...(underFlooring(state, r.x, r.y, standingFloor(r)) ? { faded: true as const } : {}),
    }));
}

/** A plot as it looks now, with whoever stands on it. Undefined for a plot nobody has claimed. */
function plotPicture(
  state: WorldState,
  px: number,
  py: number,
  o: PictureOptions,
): PlotPictureSpec | undefined {
  const plot = state.plots[plotKey(px, py)];
  if (!plot || plot.px !== px || plot.py !== py) return undefined;
  const art = state.residents[plot.ownerId]?.homeArt;
  const spec = plotSpecOf(state, plot, o.held, art !== undefined && o.artShown(plot.ownerId, art));
  const S = state.config.plotSize;
  const x0 = px * S;
  const y0 = py * S;
  const figures = figuresIn(state, x0, y0, S, S, { x: x0 + S / 2, y: y0 + S / 2 });
  return figures.length ? { ...spec, figures } : spec;
}

/** "Lemon outfit", "Auburn bob", "Straw hat and boots", "With their cat", as each applies. */
function lookFacts(r: Resident): string[] {
  const facts: string[] = [];
  if (r.theme && THEME_INFO[r.theme]) facts.push(`${THEME_INFO[r.theme].label} outfit`);
  const hair = r.hair ? hairName(r.hair, r.hairColor) : undefined;
  if (hair) facts.push(hair);
  const wear = (r.wear ?? []).flatMap((w) => (WEAR_INFO[w] ? [WEAR_INFO[w].label] : []));
  if (wear.length) {
    const words = wear.map((w, i) => (i === 0 ? w : w.toLowerCase()));
    facts.push(
      words.length === 1
        ? (words[0] ?? "")
        : `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`,
    );
  }
  if (r.pet) facts.push(`With their ${r.pet.kind}`);
  return facts;
}

/** A resident in their look. Undefined for nobody. */
function lookPicture(state: WorldState, id: string): LookSpec | undefined {
  const r = residentById(state, id);
  if (!r) return undefined;
  const palette: ThemePalette | undefined = r.theme ? THEME_INFO[r.theme]?.palette : undefined;
  return {
    kind: "look",
    name: r.name,
    ...(r.kind === "agent" ? { agent: true } : {}),
    ...(state.townsfolk?.includes(r.id) ? { townsfolk: true } : {}),
    look: edgeLook(r),
    ...(r.pet ? { pet: { kind: r.pet.kind, coat: r.pet.coat } } : {}),
    ground: palette?.ground ?? RESIDENT_HEX[r.color] ?? "#a5c682",
    facts: lookFacts(r),
  };
}

const TIME_WORDS = { dawn: "Dawn", day: "Day", dusk: "Dusk", night: "Night" } as const;
const WEATHER_WORDS = {
  clear: "Clear",
  cloudy: "Cloudy",
  rain: "Rain",
  fog: "Fog",
  snow: "Snow",
} as const;

/**
 * The map around where a resident is: centered on them while they're in the world, else on their
 * hearth (or where they last stood), kept inside the world's edge. Their neighbors' figures, the
 * light on the map's clock, and the sky. Undefined for nobody. No uploaded art at all.
 */
function nearPicture(state: WorldState, id: string, o: PictureOptions): NearSpec | undefined {
  const r = residentById(state, id);
  if (!r) return undefined;
  const { config } = state;
  const cols = Math.min(NEAR_COLS, config.width);
  const rows = Math.min(NEAR_ROWS, config.height);
  const here = r.online ? { x: r.x, y: r.y } : (r.hearth ?? { x: r.x, y: r.y });
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const x0 = clamp(here.x - Math.floor(cols / 2), config.width - cols);
  const y0 = clamp(here.y - Math.floor(rows / 2), config.height - rows);
  const inBox = (t: { x: number; y: number } | null | undefined): t is { x: number; y: number } =>
    !!t && t.x >= x0 && t.x < x0 + cols && t.y >= y0 && t.y < y0 + rows;

  // Each plot's owner's theme, looked up once per plot.
  const themes = new Map<string, ThemePalette | undefined>();
  const paletteAt = (x: number, y: number) => {
    const { px, py } = plotOf(config, x, y);
    const key = plotKey(px, py);
    if (!themes.has(key)) {
      const owner = state.plots[key] ? state.residents[state.plots[key].ownerId] : undefined;
      themes.set(key, owner?.theme ? THEME_INFO[owner.theme]?.palette : undefined);
    }
    return themes.get(key);
  };
  const commons = (x: number, y: number) => {
    const { px, py } = plotOf(config, x, y);
    return isCommons(config, px, py);
  };
  const area = areaOf(state, x0, y0, cols, rows, paletteAt, commons);
  const floors = drawnFromAbove(area.floors);

  // Each themed plot's tint, cut to the box.
  const S = config.plotSize;
  const tints: NonNullable<PlotArea["tints"]> = [];
  for (let py = Math.floor(y0 / S); py * S < y0 + rows; py++) {
    for (let px = Math.floor(x0 / S); px * S < x0 + cols; px++) {
      const palette = paletteAt(px * S, py * S);
      if (!palette || !state.plots[plotKey(px, py)]) continue;
      const left = Math.max(px * S, x0);
      const top = Math.max(py * S, y0);
      const right = Math.min((px + 1) * S, x0 + cols);
      const bottom = Math.min((py + 1) * S, y0 + rows);
      tints.push({
        x: left - x0,
        y: top - y0,
        w: right - left,
        h: bottom - top,
        fill: alphaHex(palette.ground, THEME_TINT_ALPHA),
      });
    }
  }

  // Hearths in view, and each one's pet asleep beside it, as the map puts them (RFC 0019).
  const ground = worldGround(state);
  const hearths: { x: number; y: number }[] = [];
  const seen = new Set<string>();
  const pets: NonNullable<PlotArea["pets"]> = [];
  for (const res of Object.values(state.residents)) {
    const h = res.hearth;
    if (!inBox(h)) continue;
    const key = `${h.x},${h.y}`;
    if (!seen.has(key)) {
      seen.add(key);
      hearths.push({ x: h.x - x0, y: h.y - y0 });
    }
    if (res.pet) pets.push(petPicture(res.pet, h, petBed(ground, h), x0, y0));
  }

  const figures = figuresIn(state, x0, y0, cols, rows, here);
  const sky = skyAt(o.nowMs, state.day);
  const phase = dayPhase(o.nowMs, DAY_LENGTH_MS);
  // In twentieths, so the picture changes with the light, not with every second.
  const night = Math.round(nightAmount(phase) * 20) / 20;
  const spot = plotOf(config, here.x, here.y);
  const place = isCommons(config, spot.px, spot.py)
    ? "In the Commons"
    : state.plots[plotKey(spot.px, spot.py)]
      ? `On plot ${spot.px}, ${spot.py}`
      : `By plot ${spot.px}, ${spot.py}`;
  const others = figures.length - (r.online ? 1 : 0);
  return {
    kind: "near",
    name: r.name,
    place,
    facts: [
      TIME_WORDS[timeOfDay(phase)],
      WEATHER_WORDS[sky.weather],
      ...(r.online ? [] : ["Away"]),
      ...(others > 0 ? [`${others} nearby`] : []),
    ],
    area: {
      cols,
      rows,
      ground: area.ground,
      ...(tints.length ? { tints } : {}),
      blocks: area.blocks,
      ...(area.crops.length ? { crops: area.crops } : {}),
      ...(floors.length ? { floors } : {}),
      hearths,
      ...(pets.length ? { pets } : {}),
      figures,
      ink: plotInk(state.day === undefined ? undefined : sky.season),
    },
    ...(r.online ? { at: { x: r.x - x0 + 0.5, y: r.y - y0 + FEET } } : {}),
    night,
    weather: sky.weather,
  };
}

/** A picture's data from world state alone, or undefined when there's no such plot or resident. */
export function pictureSpec(
  state: WorldState,
  route: PictureRoute,
  o: PictureOptions,
): PictureSpec | undefined {
  switch (route.kind) {
    case "plot":
      return plotPicture(state, route.px, route.py, o);
    case "look":
      return lookPicture(state, route.id);
    case "near":
      return nearPicture(state, route.id, o);
  }
}

const drawn = (figures: SpecFigure[] | undefined): PlacedFigure[] =>
  (figures ?? []).map((f) => ({
    x: f.x,
    y: f.y,
    drawing: figureDrawing(f.look),
    ...(f.faded ? { faded: true } : {}),
  }));

/** A picture's card: its figures drawn, its pet's shapes, and the home picture loaded. */
export async function materializePicture(
  spec: PictureSpec,
  loadMedia: (id: string) => Promise<Uint8Array | undefined>,
): Promise<PlotCard | NearCard | LookCard> {
  switch (spec.kind) {
    case "plot": {
      const { figures, ...photo } = spec;
      const card = await materializePlot(photo, loadMedia);
      return figures?.length ? { ...card, figures: drawn(figures) } : card;
    }
    case "near":
      return { ...spec, area: { ...spec.area, figures: drawn(spec.area.figures) } };
    case "look": {
      const { look, pet, ...rest } = spec;
      return {
        ...rest,
        figure: figureDrawing(look),
        ...(pet ? { pet: { shapes: petShapes(pet.kind, pet.coat, "awake") } } : {}),
      };
    }
  }
}
