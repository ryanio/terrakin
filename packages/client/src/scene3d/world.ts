/**
 * The world in 3D (RFC 0005 step C, decision 0060): the same mirror the 2D map draws, around you,
 * with the camera following you. It only renders. `world.ts` keeps the connection, the walking,
 * and every action, and hands this a tap as a tile, the same way the 2D canvas does.
 *
 * Plots load as chunks within `VIEW_RADIUS` of you (fog hides the edge), at most two built per
 * frame, and each is freed when you walk away. Blocks, plot borders, grass, hearths, and figures
 * come from the builders the plot view uses (`blocks.ts`, `ground.ts`, `scenery.ts`, `hearth.ts`,
 * `figure.ts`), and the Town Hall and the shop from `buildings.ts`. Homes with storeys (RFC 0028)
 * show every plot whole but the one you stand on, cut away at your storey, and figures stand on
 * their storeys. Loaded only through `import()` (decision 0013).
 */

import {
  groundTile,
  holidayOf,
  isFindKind,
  isResourceKind,
  OUTSIDE_GROUND,
  plotKey,
  RECIPE_PAGE,
  type Resident,
  type Season,
  seasonTone,
  THEME_INFO,
  THEME_TINT_ALPHA,
  tileKey,
} from "@terrakin/sim";
import {
  BufferGeometry,
  type CanvasTexture,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  type Fog,
  Group,
  InstancedMesh,
  LineDashedMaterial,
  LineLoop,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Raycaster,
  Sprite,
  type Texture,
  Vector2,
  Vector3,
} from "three";
import type { Feelings, Shown } from "../feelings";
import type { Mirror } from "../mirror";
import { awayPose, type Motion } from "../motion";
import { bubbleSize, drawBubble, stackBubbles } from "../overhead";
import { lyingOn, type PetMotion, type PetScene } from "../pets";
import { type Cutaway, cutaway } from "../storeys";
import { nightAmount } from "../time";
import { type SkyAmounts, UMBRELLA_RAIN } from "../weather";
import {
  addAll,
  canvasTexture,
  createStage,
  disposeTree,
  grainTexture,
  plankTexture,
  type Scope,
  scoped,
  spotTexture,
  stoneTexture,
} from "./art";
import { blockMeshes, POOL_LIGHT } from "./blocks";
import {
  buildingGlows,
  type Footprint,
  footprintOf,
  seeThrough,
  shop,
  townHall,
} from "./buildings";
import { cropPlants } from "./crops";
import { createPictures, displayedThings, foundThings } from "./displays";
import {
  fadeFigure,
  figure,
  ICON_TEXTURES,
  iconTexture,
  OVERHEAD_ORDER,
  overheadMaterial,
  overheadTop,
  setUmbrella,
  showFeeling,
  sizeSign,
  turnHead,
} from "./figure";
import { border, groundGrid } from "./ground";
import { HEARTH_LIGHT, hearth, liftSmoke } from "./hearth";
import {
  cornerLight,
  cutWalls,
  FIGURE_SCALE,
  hearthPull,
  hearthStand,
  type LayoutFigure,
  litHomes,
  signSize,
  smokeStart,
  storeyY,
} from "./layout";
import { hex, SKY } from "./palette";
import { floorSlabs, groundAtlas, groundTiles } from "./paths";
import { petGeometries, petMaterial } from "./pets";
import { pickups, scenery } from "./scenery";
import { createWeather } from "./weather";
import {
  approach,
  BUILDS_PER_FRAME,
  cameraQuarter,
  chunkSignature,
  dozersAround,
  faceAngle,
  figuresAround,
  GROUND_STEP,
  groundAnchor,
  groundPoint,
  hearthKeys,
  KEEP_SLACK,
  MAX_FIGURES,
  nearbyLabel,
  plotsAround,
  type Quarter,
  readChunk,
  type Tile,
  tileAtPoint,
  tileDistance,
  tileOfHit,
  turnBetween,
  VIEW_RADIUS,
} from "./world-layout";

export interface World3dOptions {
  /** A tap on the world, as the tile it landed on. Walking, building, and opening things follow. */
  onTap(tile: Tile): void;
  /** Whether a tap on a tile does more than walk there: a mouse over it shows a pointer. */
  tappable?(tile: Tile): boolean;
  /** The 3D view can't go on here: too slow even after stepping down, or the GPU went away. */
  onFail(reason: "slow" | "lost"): void;
}

export interface World3dFrame {
  mirror: Mirror;
  /** You, or nobody yet: someone with no character looks around a link's place (decision 0162). */
  me: string | undefined;
  /**
   * A place a link named (decision 0162): the view draws around it and the camera looks at it
   * instead of you, following the figure of the resident `id` while they're drawn.
   */
  look?: { x: number; y: number; id?: string } | undefined;
  buildMode: boolean;
  /** What each figure feels and who just spoke (RFC 0013). */
  feelings?: Feelings;
  /** How residents move, and what they say: the same the map draws. */
  motion: Motion;
  /** The world's season, for the ground. Absent: today's look. */
  season?: Season | undefined;
  /** How much cloud, rain, snow, and fog to draw (`weather.ts`). Absent: a clear sky. */
  sky?: SkyAmounts | undefined;
  /** Where pets are and what they're doing (RFC 0019): the same the map draws. */
  pets?: PetMotion;
  /** The server's clock, ms, which pets plan their days by. */
  clock?: number;
  /**
   * The time of day, the map's (`time.ts`: 0 dawn, 0.25 noon), for the light (decision 0098) and
   * for pets asleep at night. Absent: full day.
   */
  dayPhase?: number;
  /**
   * The storey the plot you stand on is cut away at (RFC 0028): the build bar's pick while
   * building, as on the map. Absent: the storey you stand on.
   */
  cutStorey?: number;
}

export interface World3d {
  /** Bring the scene up to date with the mirror. Called every frame by the world loop. */
  sync(frame: World3dFrame): void;
  /**
   * Where on the page, in CSS pixels, a pill beside a resident's figure goes: right of its middle
   * as drawn now. Undefined when they aren't drawn or are behind the camera.
   */
  screenOf(id: string): { x: number; y: number } | undefined;
  /** Which way is away from the camera, snapped to a direction: what "up" on the d-pad means. */
  heading(): Quarter;
  dispose(): void;
}

interface Chunk {
  group: Group;
  scope: Scope;
  signature: string;
}

interface Fig {
  group: Group;
  scope: Scope;
  signature: string;
  /** How high their storey's floor is drawn (RFC 0028), eased as they go up or down. */
  rise: number;
  turn: number;
  /** The head's turn from the body, toward whoever is speaking. */
  look: number;
  /** While they doze, the `sleepy` feeling from `motion.ts`. */
  doze: Shown | undefined;
  /** Away and asleep at home here (decision 0086): they stay put, and a tap on them is this tile. */
  away?: { x: number; y: number };
  /** Away and out on a routine (decision 0083): faded, walking its steps, and awake. */
  out?: true;
  /** On a storey the cut leaves out (RFC 0028): faded, their name still shown, as on the map. */
  cutOff?: boolean;
  /** What they're saying, in the scene so a hop or squash doesn't bend it; its canvas size. */
  bubble?: { text: string; sprite: Sprite; w: number; h: number };
}

/** A bubble's text is drawn this big on its canvas, and shown this many CSS pixels tall on screen. */
const BUBBLE_FONT_PX = 45;
const BUBBLE_SCREEN_PX = 14;

interface Building {
  group: Group;
  footprint: Footprint;
  signature: string;
  /** Stops its windows glowing after dark. */
  unlight(): void;
}

/** How far the camera starts from you, and how close and far a pinch can take it. */
const START_OFFSET = new Vector3(0, 13, 12);
const MIN_DISTANCE = 3;
const MAX_DISTANCE = 24;
/** How quickly figures turn, per second. */
const TURN = 10;
/** How quickly a figure climbs to its storey's floor (RFC 0028), per second. */
const CLIMB = 8;
/** How high a figure's middle stands over its feet, where a pill beside it lines up. */
const FIGURE_MIDDLE = 0.6;
/** How far right of a figure's middle a pill beside it starts, in CSS pixels. */
const BESIDE_PX = 28;
/** Figures this close to a speaker turn their heads to them, as far as a neck goes. */
const LISTEN_RADIUS = 5;
const NECK = 0.8;
/** A speaker further round than this is behind them: they don't strain to look. */
const BEHIND = 2.2;
/**
 * The most pets drawn at once, the nearest you: one draw each, plus one for all their shadows, on
 * top of decision 0060's crowd.
 */
const MAX_PETS = 16;
/** How quickly a pet turns, per second. */
const PET_TURN = 8;
/** Pets a little bigger than life beside the pegs, so they read from the camera's height. */
const PET_SCALE = 1.4;

interface PetFig {
  mesh: Mesh;
  /** Its kind, coat, and posture, so the geometry swaps only when one changes. */
  look: string;
  heading: number;
  heart?: Sprite;
}

/** Ground beyond the view radius, fading out, so the fog has something to swallow. */
const GROUND_RING = VIEW_RADIUS + GROUND_STEP + 4;

export function createWorld3d(host: HTMLElement, opts: World3dOptions): World3d {
  let failed = false;
  const fail = (reason: "slow" | "lost") => {
    if (failed) return;
    failed = true;
    opts.onFail(reason);
  };
  // A wide lens: on a phone held upright you see about nine tiles across where you stand.
  const stage = createStage(host, {
    autoRotate: false,
    onSlow: () => fail("slow"),
    fov: { tall: 58, wide: 40 },
  });
  const { scene, camera, controls, renderer } = stage;
  const still = stage.reducedMotion;
  const grain = stage.keep(grainTexture());
  const shadowMap = stage.keep(spotTexture());
  const surfaces = {
    plank: stage.keep(plankTexture()),
    stone: stage.keep(stoneTexture()),
    pool: stage.keep(spotTexture(POOL_LIGHT)),
  };
  const hearthLook = { stone: surfaces.stone, glow: stage.keep(spotTexture(HEARTH_LIGHT)) };
  const shared = new Set<Texture>([
    grain,
    shadowMap,
    surfaces.plank,
    surfaces.stone,
    surfaces.pool,
    hearthLook.glow,
  ]);
  /** Every path and floor in one texture (RFC 0016), drawn the first time a plot has any. */
  let atlas: Texture | undefined;
  const groundAtlasOnce = () => {
    if (!atlas) {
      atlas = stage.keep(groundAtlas());
      shared.add(atlas);
    }
    return atlas;
  };
  const fog = scene.fog as Fog;
  // What's on display shares its pictures across plots, and frees each with its last display.
  const pictures = createPictures(shared);

  controls.enablePan = false;
  controls.enableDamping = !still;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.minPolarAngle = Math.PI * 0.12;
  controls.maxPolarAngle = Math.PI * 0.4;
  camera.near = 0.3;
  camera.far = 120;
  camera.updateProjectionMatrix();

  const chunks = new Map<string, Chunk>();
  const figures = new Map<string, Fig>();
  // Pets (RFC 0019): one shared material and a geometry per look, and their shadows in one draw.
  const petGeo = petGeometries();
  const petMat = petMaterial();
  const petFigs = new Map<string, PetFig>();
  const petShadowGeo = new CircleGeometry(0.24, 16);
  petShadowGeo.rotateX(-Math.PI / 2);
  const petShadows = new InstancedMesh(
    petShadowGeo,
    new MeshBasicMaterial({
      map: shadowMap,
      color: 0x3c2a14,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    }),
    MAX_PETS,
  );
  petShadows.count = 0;
  petShadows.renderOrder = 1;
  petShadows.frustumCulled = false;
  scene.add(petShadows);
  const petAt = new Matrix4();
  const buildings = new Map<"hall" | "shop", Building>();
  let ground: { mesh: Mesh; signature: string } | undefined;
  let mirrorSeen: Mirror | undefined;
  let seqSeen = -1;
  /** Who was out on a routine at the last frame, so the cast changes when one goes back to sleep. */
  let outSeen = "";
  let lastTile: Tile | undefined;
  /** Where the last frame cut the world away (RFC 0028), so a new cut builds its plots again. */
  let cutSeen = "";
  let pending = false;
  /** A pass over changed plots stopped at the per-frame cap: the next frame finishes it. */
  let recheck = false;
  let started = false;
  let lastSync = performance.now();
  let lastMirror: Mirror | undefined;
  let hearths = new Set<string>();
  /** The plots whose windows light up after dark: someone's home there (`litHomes`). */
  let homes = new Set<string>();
  /** Where someone on each hearth's tile stands instead (`hearthStand`), by `y * width + x`. */
  let stands = new Map<number, { x: number; y: number }>();
  let standsWidth = 0;
  /** How big feelings' signs are drawn for the camera's distance (`signSize`). */
  let signAt = signSize(START_OFFSET.length(), camera.fov);
  /** The season the ground is dressed for, and whether umbrellas are up. */
  let season: Season | undefined;
  let umbrellasUp = false;
  // Rain and snow fall around you, and the sky greys for the weather (decision 0073).
  const weather = createWeather(stage, { radius: VIEW_RADIUS - 1 });

  // The reach outline while building, like the 2D map's dashed square.
  const reach = new LineLoop(
    new BufferGeometry(),
    new LineDashedMaterial({ color: 0xfffaf0, dashSize: 0.3, gapSize: 0.2, transparent: true }),
  );
  reach.visible = false;
  reach.renderOrder = 3;
  scene.add(reach);
  let reachSize = -1;

  // ---------- plots ----------

  function dropChunk(key: string) {
    const c = chunks.get(key);
    if (!c) return;
    chunks.delete(key);
    scene.remove(c.group);
    c.scope.release();
    disposeTree(c.group, shared);
  }

  function buildChunk(mirror: Mirror, px: number, py: number, cut: number | undefined): Chunk {
    const data = readChunk(mirror, px, py, hearths, season, homes.has(plotKey(px, py)), cut);
    const scope = scoped(stage);
    const group = new Group();
    group.name = `plot ${px},${py}`;
    const origin = { x: 0, y: 0 };
    const blocks = data.blocks.map((b) => ({
      ...b,
      own: true,
      fade: 0,
      ...(data.lit && b.block === "glass" ? { lit: true as const } : {}),
    }));
    addAll(group, blockMeshes(scope, origin, blocks, grain, surfaces));
    if (data.ground.length) {
      const paved = groundTiles(origin, data.ground, groundAtlasOnce());
      if (paved) group.add(paved);
    }
    // Floors upstairs on slabs (RFC 0028), and caps on the walls a cut leaves open.
    const slabs = floorSlabs(
      origin,
      data.ground.filter((g) => g.storey),
      cutWalls(blocks, cut ?? data.highest, data.highest),
      grain,
    );
    if (slabs) group.add(slabs);
    if (data.owner) group.add(border(data.bounds, origin, grain));
    group.add(scenery(scope, origin, data.tufts, data.flowers, data.leaves, season));
    // Branches and stones are shapes; finds (RFC 0021) stand as their pictures.
    const lying = data.pickups.flatMap((p) =>
      isResourceKind(p.kind) ? [{ ...p, kind: p.kind }] : [],
    );
    // A recipe page (RFC 0024) stands the same way, as its scroll.
    const found = data.pickups.flatMap((p) =>
      isFindKind(p.kind) || p.kind === RECIPE_PAGE ? [{ ...p, kind: p.kind }] : [],
    );
    if (lying.length) group.add(pickups(origin, lying));
    if (found.length) group.add(foundThings(scope, origin, found, pictures));
    for (const h of data.hearths) {
      const home = hearth(scope, grain, { light: false, ...hearthLook });
      home.position.set(h.x, 0, h.y);
      // Over a loft, the smoke starts above it (what a cut leaves out covers nothing).
      liftSmoke(home, smokeStart(h, data.blocks, data.ground));
      group.add(home);
    }
    addAll(group, cropPlants(scope, origin, data.crops));
    group.add(displayedThings(scope, origin, data.displays, pictures, grain));
    scene.add(group);
    return { group, scope, signature: data.signature };
  }

  /**
   * The plots in view, built or built again when what they draw changed. `cut` is the plot you
   * stand on and your storey there (RFC 0028): that plot is cut away at it, the rest whole.
   */
  function updateChunks(
    mirror: Mirror,
    tile: Tile,
    changed: boolean,
    cut: { px: number; py: number; storey: number } | undefined,
  ) {
    const { config } = mirror;
    const cutAt = (px: number, py: number) =>
      cut && cut.px === px && cut.py === py ? cut.storey : undefined;
    const keep = new Set(
      plotsAround(tile, VIEW_RADIUS + KEEP_SLACK, config).map((p) => plotKey(p.x, p.y)),
    );
    for (const key of [...chunks.keys()]) if (!keep.has(key)) dropChunk(key);
    const S = config.plotSize;
    const wanted = plotsAround(tile, VIEW_RADIUS, config).sort(
      (a, b) =>
        tileDistance(tile, { x: a.x * S + S / 2, y: a.y * S + S / 2 }) -
        tileDistance(tile, { x: b.x * S + S / 2, y: b.y * S + S / 2 }),
    );
    let built = 0;
    pending = false;
    for (const p of wanted) {
      const key = plotKey(p.x, p.y);
      const have = chunks.get(key);
      if (have && !changed) continue;
      const lit = homes.has(key);
      const at = cutAt(p.x, p.y);
      if (have && have.signature === chunkSignature(mirror, p.x, p.y, hearths, season, lit, at))
        continue;
      if (built >= BUILDS_PER_FRAME) {
        pending = true;
        break;
      }
      dropChunk(key);
      chunks.set(key, buildChunk(mirror, p.x, p.y, at));
      built++;
    }
  }

  // ---------- ground ----------

  function updateGround(mirror: Mirror, tile: Tile) {
    const at = groundAnchor(tile);
    const { config } = mirror;
    const area = plotsAround(at, GROUND_RING, config);
    const owners = area.map((p) => {
      const owner = mirror.plots.get(plotKey(p.x, p.y));
      return owner ? `${owner}:${mirror.residents.get(owner)?.theme ?? ""}` : "";
    });
    const signature = `${at.x},${at.y}|${owners.join(",")}|${area
      .map((p) => chunkSignature(mirror, p.x, p.y, hearths, season))
      .join("/")}`;
    if (ground?.signature === signature) return;
    if (ground) {
      scene.remove(ground.mesh);
      disposeTree(ground.mesh, shared);
    }
    const S = config.plotSize;
    const plotTint = new Color(hex(seasonTone("#b4cd86", season)));
    const outside = new Color(hex(OUTSIDE_GROUND));
    const fogColor = new Color(SKY.fog);
    const solid = new Set<string>();
    for (const key of mirror.blocks.keys()) solid.add(key);
    for (const key of hearths) solid.add(key);
    const fadeStart = VIEW_RADIUS;
    const fadeEnd = GROUND_RING;
    const n = GROUND_RING * 2 + 1;
    const inWorld = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < config.width && y < config.height;
    // A tile's ground, as the 2D map paints it: its biome or the Commons, tinted on a plot.
    const tiles = new Map<string, Color>();
    const tileColor = (tx: number, ty: number): Color => {
      const key = `${tx},${ty}`;
      const seen = tiles.get(key);
      if (seen) return seen;
      let c: Color;
      if (!inWorld(tx, ty)) c = outside.clone();
      else {
        const px = Math.floor(tx / S);
        const py = Math.floor(ty / S);
        const inCommons = px === mirror.commons.px && py === mirror.commons.py;
        c = new Color(hex(groundTile(config, tx, ty, inCommons, season).fill));
        const owner = mirror.plots.get(plotKey(px, py));
        if (owner) {
          const theme = mirror.residents.get(owner)?.theme;
          if (theme) c.lerp(new Color(hex(THEME_INFO[theme].palette.ground)), THEME_TINT_ALPHA);
          else c.lerp(plotTint, 0.3);
        }
      }
      tiles.set(key, c);
      return c;
    };
    const mesh = groundGrid(at.x - GROUND_RING, at.y - GROUND_RING, n, { x: 0, y: 0 }, (cx, cy) => {
      // Each corner blends the four tiles around it, so biomes and plots meet in soft edges.
      const c = new Color(0, 0, 0);
      for (const [tx, ty] of [
        [cx - 1, cy - 1],
        [cx, cy - 1],
        [cx - 1, cy],
        [cx, cy],
      ] as const)
        c.add(tileColor(tx, ty));
      c.multiplyScalar(0.25);
      c.multiplyScalar(cornerLight(solid, cx, cy));
      // Fade by distance from the anchor, in tiles, out into the haze.
      const d = Math.hypot(cx - 0.5 - at.x, cy - 0.5 - at.y);
      const t = Math.min(1, Math.max(0, (d - fadeStart) / (fadeEnd - fadeStart)));
      c.lerp(fogColor, t * t * 0.9);
      return { color: c, alpha: 1 - t * t * t };
    });
    scene.add(mesh);
    ground = { mesh, signature };
  }

  // ---------- the Town Hall and the shop ----------

  function updateBuildings(mirror: Mirror) {
    for (const [name, tiles] of [
      ["hall", mirror.townHall],
      ["shop", mirror.shop],
    ] as const) {
      const fp = footprintOf(tiles);
      const signature = fp ? `${fp.x},${fp.y},${fp.width},${fp.depth}` : "";
      const have = buildings.get(name);
      if (have?.signature === signature) continue;
      if (have) {
        have.unlight();
        scene.remove(have.group);
        disposeTree(have.group, shared);
        buildings.delete(name);
      }
      if (!fp) continue;
      const group = name === "shop" ? shop(fp, grain, surfaces.pool) : townHall(fp, grain);
      group.position.set(fp.x, 0, fp.y);
      scene.add(group);
      // The shop's windows light up after dark, as on the map.
      const stops = buildingGlows(group).map((g) => stage.glow(g));
      buildings.set(name, {
        group,
        footprint: fp,
        signature,
        unlight: () => {
          for (const stop of stops) stop();
        },
      });
    }
  }

  // ---------- residents ----------

  function figureOf(r: Resident, mine: boolean): LayoutFigure {
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      color: r.color,
      shape: r.shape,
      x: r.x,
      y: r.y,
      owner: mine,
      look: {
        color: r.color,
        shape: r.shape,
        theme: r.theme,
        pattern: r.pattern,
        patternMedia: r.patternMedia,
        wear: r.wear,
        wearStyle: r.wearStyle,
        hair: r.hair,
        hairColor: r.hairColor,
      },
    };
  }

  function dropFigure(id: string) {
    const f = figures.get(id);
    if (!f) return;
    figures.delete(id);
    scene.remove(f.group);
    f.scope.release();
    // Feelings' signs are shared by every figure.
    for (const t of ICON_TEXTURES) shared.add(t);
    disposeTree(f.group, shared);
    dropBubble(f);
  }

  function dropBubble(f: Fig) {
    if (!f.bubble) return;
    scene.remove(f.bubble.sprite);
    f.bubble.sprite.material.map?.dispose();
    f.bubble.sprite.material.dispose();
    delete f.bubble;
  }

  /**
   * World units per pixel of a bubble's canvas, so a bubble's text stays `BUBBLE_SCREEN_PX` tall on
   * screen at any zoom, like the map's. Set each frame from the camera.
   */
  let bubblePx = 0;

  const onScreen = new Vector3();
  const raisedOnScreen = new Vector3();
  /**
   * Raise bubbles so neighbors' don't cover each other, as on the map: worked out on screen, the
   * nearest speaker kept lowest, then lifted in the world by however far that is on screen.
   */
  function stackBubbles3d() {
    const speaking = [...figures.values()].filter((f) => f.bubble);
    if (speaking.length < 2) return;
    speaking.sort(
      (a, b) =>
        a.group.position.distanceToSquared(camera.position) -
        b.group.position.distanceToSquared(camera.position),
    );
    const w = host.clientWidth;
    const h = host.clientHeight;
    const cssPx = BUBBLE_SCREEN_PX / BUBBLE_FONT_PX;
    const boxes = speaking.map((f) => {
      const b = f.bubble as NonNullable<Fig["bubble"]>;
      onScreen.copy(b.sprite.position).project(camera);
      const x = ((onScreen.x + 1) / 2) * w;
      const y = ((1 - onScreen.y) / 2) * h;
      const bw = b.w * cssPx;
      const bh = b.h * cssPx;
      return { left: x - bw / 2, right: x + bw / 2, top: y - bh / 2, bottom: y + bh / 2 };
    });
    const raises = stackBubbles(boxes, []);
    for (const [i, f] of speaking.entries()) {
      const raise = raises[i] ?? 0;
      const sprite = f.bubble?.sprite;
      if (!raise || !sprite) continue;
      // How many screen pixels one unit up is, here: the camera looks down at an angle.
      onScreen.copy(sprite.position).project(camera);
      raisedOnScreen
        .copy(sprite.position)
        .setY(sprite.position.y + 1)
        .project(camera);
      const perUnit = ((raisedOnScreen.y - onScreen.y) / 2) * h;
      if (perUnit > 0) sprite.position.y += raise / perUnit;
    }
  }

  /** Put what they're saying over a figure's name tag. True if it changed. */
  function placeBubble(f: Fig, said: { lines: string[]; alpha: number } | undefined): boolean {
    const text = said?.lines.join("\n");
    if (f.bubble && f.bubble.text !== text) dropBubble(f);
    if (!said || text === undefined) return false;
    if (!f.bubble) {
      const { texture, w, h } = bubbleTexture(said.lines);
      const sprite = new Sprite(overheadMaterial(texture));
      sprite.renderOrder = OVERHEAD_ORDER.bubble;
      scene.add(sprite);
      f.bubble = { text, sprite, w, h };
    }
    const { sprite, w, h } = f.bubble;
    sprite.scale.set(w * bubblePx, h * bubblePx, 1);
    const p = f.group.position;
    // Over the name tag, and over the feeling's sign when one shows.
    const over = overheadTop(f.group) * FIGURE_SCALE + 0.03;
    sprite.position.set(p.x, over + (h * bubblePx) / 2, p.z);
    sprite.material.opacity = said.alpha;
    return true;
  }

  /** Who is drawn, and in what look. Runs when the mirror changes. */
  function updateCast(mirror: Mirror, me: string | undefined, tile: Tile) {
    const shown = figuresAround(mirror.residents.values(), tile, me);
    // Anyone away out on a routine walks where they are, then anyone asleep at home lies there,
    // in the places the online leave free (decisions 0083 and 0086).
    const room = MAX_FIGURES - shown.length;
    const outs = mirror.outOnRoutine(me).map((o) => ({ r: o.r, x: o.r.x, y: o.r.y }));
    const out = dozersAround(outs, tile, room).map((d) => d.r);
    const walking = new Set(out.map((r) => r.id));
    const asleep = dozersAround(mirror.asleep(me), tile, room - out.length);
    const spots = new Map(asleep.map((d) => [d.r.id, { x: d.x, y: d.y }]));
    const ids = new Set([...shown.map((r) => r.id), ...walking, ...spots.keys()]);
    // The canvas can't be read aloud, so the view names who is around (names as plain text). Only
    // residents in the world: never anyone asleep at home.
    const label = nearbyLabel(shown.filter((r) => r.id !== me).map((r) => r.name));
    if (host.getAttribute("aria-label") !== label) host.setAttribute("aria-label", label);
    for (const id of [...figures.keys()]) if (!ids.has(id)) dropFigure(id);
    for (const r of [...shown, ...out, ...asleep.map((d) => d.r)]) {
      const mine = r.id === me;
      const away = spots.get(r.id);
      const strolling = walking.has(r.id);
      const signature = JSON.stringify([
        r.name,
        r.kind,
        r.color,
        r.shape,
        r.theme,
        r.pattern,
        r.patternMedia,
        r.wear,
        r.wearStyle,
        r.hair,
        r.hairColor,
        mine,
        away,
        strolling,
      ]);
      const have = figures.get(r.id);
      if (have?.signature === signature) continue;
      // Asleep at home is on the ground floor; anyone else on their own storey (RFC 0028).
      const rise = away ? 0 : (have?.rise ?? storeyY(r.storey));
      const at = away
        ? new Vector3(away.x, 0, away.y)
        : have
          ? have.group.position.clone()
          : new Vector3(r.x, rise, r.y);
      // Asleep at home, they face out of the door, toward the camera's usual side.
      const turn = away ? 0 : (have?.turn ?? faceAngle(mirror.facing.get(r.id)));
      dropFigure(r.id);
      const scope = scoped(stage);
      const group = figure(
        scope,
        { ...figureOf(r, mine), ...(away || strolling ? { away: true as const } : {}) },
        shadowMap,
      );
      group.userData.residentId = r.id;
      // Out in the rain an umbrella goes up; asleep at home it stays rolled up beside them.
      setUmbrella(group, umbrellasUp && !away);
      // A crowd casts blob shadows only: a real one per figure would double its draws.
      group.traverse((o) => {
        o.castShadow = false;
      });
      group.position.copy(at);
      group.rotation.y = turn;
      scene.add(group);
      if (have) dropBubble(have);
      figures.set(r.id, {
        group,
        scope,
        signature,
        rise,
        turn,
        look: 0,
        doze: undefined,
        ...(away ? { away } : {}),
        ...(strolling ? { out: true as const } : {}),
      });
      sizeSign(group, signAt);
    }
  }

  /**
   * Pose each figure the way the map does (a slide and hop for each step, a squash on landing, a
   * lean, a sway), turn it the way it walked, and turn its head toward whoever just spoke nearby.
   * True if anything moved.
   */
  function moveFigures(
    mirror: Mirror,
    motion: Motion,
    dt: number,
    speakerId: string | undefined,
    cut: Cutaway | undefined,
  ): boolean {
    let moved = false;
    const now = performance.now();
    const speaker = speakerId === undefined ? undefined : mirror.residents.get(speakerId);
    for (const [id, f] of figures) {
      const r = mirror.residents.get(id);
      if (!r) continue;
      if (f.away) {
        // Asleep at home: they stay where they lie, breathing, and doze.
        f.doze = awayPose(id, f.away.x, f.away.y, now, still).doze;
        continue;
      }
      const m = motion.pose(r, now, still);
      // The way they're walking, or the server's word for someone who hasn't moved since.
      const want = faceAngle(m.facing ?? mirror.facing.get(id));
      const gap = turnBetween(f.turn, want);
      const turn = still || Math.abs(gap) < 1e-3 ? want : f.turn + gap * (1 - Math.exp(-TURN * dt));
      const g = f.group;
      const p = g.position;
      // Up or down a storey (RFC 0028), eased like a step.
      const rise = still ? storeyY(r.storey) : approach(f.rise, storeyY(r.storey), dt, CLIMB);
      if (rise !== f.rise) moved = true;
      f.rise = rise;
      // Above the storey the plot they're on is cut at: faded, like a figure under a floor.
      const S = mirror.config.plotSize;
      const cutOff =
        cut !== undefined &&
        Math.floor(r.x / S) === cut.px &&
        Math.floor(r.y / S) === cut.py &&
        (r.storey ?? 0) > cut.storey;
      if (cutOff !== (f.cutOff ?? false)) {
        fadeFigure(g, cutOff);
        f.cutOff = cutOff;
        moved = true;
      }
      // Off the stonework when on or stepping onto a hearth's tile, on the ground floor.
      let x = m.x;
      let z = m.y;
      if (stands.size > 0 && !r.storey) {
        for (let ty = Math.floor(m.y); ty <= Math.ceil(m.y); ty++)
          for (let tx = Math.floor(m.x); tx <= Math.ceil(m.x); tx++) {
            const stand = stands.get(ty * standsWidth + tx);
            if (!stand) continue;
            const pull = hearthPull(m.x, m.y, tx, ty);
            x += stand.x * pull;
            z += stand.y * pull;
          }
      }
      if (x !== p.x || z !== p.z || m.lift + rise !== p.y || turn !== f.turn) moved = true;
      p.set(x, m.lift + rise, z);
      f.turn = turn;
      // Turn first, then sway side to side in the figure's own frame.
      g.rotation.set(0, turn, m.sway);
      // Landing from a jump, they pop up from small.
      const pop = m.poof === undefined ? 1 : 0.6 + 0.4 * Math.sin((Math.PI / 2) * m.poof);
      const sq = m.squash;
      g.scale.set(1.3 * sq * pop, (1.3 / sq) * pop, 1.3 * sq * pop);
      const body = g.userData.body as Object3D | undefined;
      if (body) body.rotation.x = m.lean;
      // Out on a routine, they're awake.
      f.doze = f.out ? undefined : m.doze;
      let look = 0;
      if (speaker && speaker.id !== id && tileDistance(r, speaker) <= LISTEN_RADIUS) {
        const toward = turnBetween(turn, Math.atan2(speaker.x - m.x, speaker.y - m.y));
        if (Math.abs(toward) <= BEHIND) look = Math.max(-NECK, Math.min(NECK, toward));
      }
      const head = still ? look : approach(f.look, look, dt, TURN / 2);
      if (head !== f.look) {
        moved = true;
        f.look = head;
        turnHead(g, head);
      }
      if (placeBubble(f, motion.bubble(id, now))) moved = true;
    }
    return moved;
  }

  function dropPet(id: string) {
    const p = petFigs.get(id);
    if (!p) return;
    petFigs.delete(id);
    scene.remove(p.mesh);
    if (p.heart) {
      scene.remove(p.heart);
      p.heart.material.dispose();
    }
  }

  /**
   * Draw the pets nearest you where `pets.ts` says they are, the way the map does: beside their
   * owners, or at home by the hearth. True if anything moved.
   */
  function movePets(
    mirror: Mirror,
    tile: Tile,
    frame: World3dFrame,
    dt: number,
    now: number,
  ): boolean {
    const { pets, motion } = frame;
    if (!pets) return false;
    const near = [...mirror.residents.values()]
      .filter((r) => {
        if (!r.pet) return false;
        const anchor = r.online ? r : r.hearth;
        return anchor !== null && tileDistance(tile, anchor) <= VIEW_RADIUS + 2;
      })
      .sort(
        (a, b) =>
          tileDistance(tile, a.online ? a : (a.hearth ?? a)) -
          tileDistance(tile, b.online ? b : (b.hearth ?? b)),
      )
      .slice(0, MAX_PETS);
    const scenePets: PetScene = {
      now,
      clock: frame.clock ?? now,
      night: frame.dayPhase !== undefined && nightAmount(frame.dayPhase) > 0.55,
      still,
      ground: mirror.ground(),
      config: mirror.config,
      day: mirror.day,
      lying: lyingOn(mirror.asleep(frame.me)),
    };
    const shown = new Set<string>();
    let moved = false;
    let n = 0;
    for (const r of near) {
      const pet = r.pet;
      if (!pet) continue;
      const m = r.online ? motion.pose(r, now, still) : undefined;
      const p = pets.pose(r, {
        ...scenePets,
        drawn: m && { x: m.x, y: m.y },
      });
      if (!p) continue;
      shown.add(r.id);
      const posture = p.asleep ? "asleep" : "awake";
      const look = `${pet.kind}|${pet.coat}|${posture}`;
      let f = petFigs.get(r.id);
      if (!f) {
        const mesh = new Mesh(petGeo.get(pet.kind, pet.coat, posture), petMat);
        mesh.castShadow = false;
        scene.add(mesh);
        f = { mesh, look, heading: p.heading };
        petFigs.set(r.id, f);
      } else if (f.look !== look) {
        f.mesh.geometry = petGeo.get(pet.kind, pet.coat, posture);
        f.look = look;
      }
      const gap = turnBetween(f.heading, p.heading);
      f.heading =
        still || Math.abs(gap) < 1e-3
          ? p.heading
          : f.heading + gap * (1 - Math.exp(-PET_TURN * dt));
      const breath = p.asleep && !still ? 1 + Math.sin(now / 700 + p.x) * 0.03 : 1;
      const mesh = f.mesh;
      if (
        mesh.position.x !== p.x ||
        mesh.position.z !== p.y ||
        mesh.position.y !== p.lift ||
        p.asleep
      )
        moved = true;
      mesh.position.set(p.x, p.lift, p.y);
      mesh.rotation.set(0, f.heading, 0);
      mesh.scale.set(PET_SCALE, PET_SCALE * breath, PET_SCALE);
      if (n < MAX_PETS) {
        petAt.makeTranslation(p.x, 0.013, p.y);
        petShadows.setMatrixAt(n++, petAt);
      }
      // A heart floats up after a pat, as on the map.
      if (p.heart !== undefined) {
        if (!f.heart) {
          f.heart = new Sprite(overheadMaterial(iconTexture("heart")));
          f.heart.renderOrder = OVERHEAD_ORDER.sign;
          scene.add(f.heart);
        }
        f.heart.scale.setScalar(0.3);
        f.heart.position.set(p.x, 0.75 + p.heart * 0.5, p.y);
        f.heart.material.opacity = Math.min(1, (1 - p.heart) * 3);
        moved = true;
      } else if (f.heart) {
        scene.remove(f.heart);
        f.heart.material.dispose();
        delete f.heart;
        moved = true;
      }
    }
    for (const id of [...petFigs.keys()]) if (!shown.has(id)) dropPet(id);
    if (petShadows.count !== n) moved = true;
    petShadows.count = n;
    petShadows.instanceMatrix.needsUpdate = true;
    pets.keep(shown);
    return moved;
  }

  /** Where someone on each hearth's tile stands, clear of the stonework. */
  function hearthStands(mirror: Mirror): Map<number, { x: number; y: number }> {
    const { width, height } = mirror.config;
    const out = new Map<number, { x: number; y: number }>();
    for (const r of mirror.residents.values()) {
      const h = r.hearth;
      if (!h) continue;
      const stand = hearthStand((dx, dy) => {
        const x = h.x + dx;
        const y = h.y + dy;
        const key = tileKey(x, y);
        return (
          x >= 0 &&
          y >= 0 &&
          x < width &&
          y < height &&
          !mirror.blocks.has(key) &&
          !hearths.has(key)
        );
      });
      out.set(h.y * width + h.x, stand);
    }
    return out;
  }

  // ---------- the camera ----------

  const focus = new Vector3();
  /** A link's place with no figure to follow there (decision 0162). */
  const lookSpot = new Vector3();
  const lastFocus = new Vector3(Number.NaN, 0, 0);

  /** Keep the camera on `at`, standing `rise` up on its storey's floor. */
  function follow(at: Vector3, rise = 0) {
    focus.set(at.x, 0.6 + rise, at.z);
    if (!started) {
      started = true;
      controls.target.copy(focus);
      camera.position.copy(focus).add(START_OFFSET);
      controls.update();
    } else {
      const delta = focus.clone().sub(controls.target);
      if (delta.lengthSq() > 0) {
        controls.target.add(delta);
        camera.position.add(delta);
      }
    }
    // Haze starts just past you and closes in at the view radius, wherever the camera is, and
    // nearer in fog.
    const d = camera.position.distanceTo(controls.target);
    const reach = stage.hazeReach();
    fog.near = d + 2 * reach;
    fog.far = d + VIEW_RADIUS * 1.6 * reach;
    weather.follow(focus.x, focus.z);
    if (focus.distanceToSquared(lastFocus) > 0.25) {
      lastFocus.copy(focus);
      stage.light(new Vector3(focus.x, 0, focus.z), 10);
    }
  }

  function placeReach(mirror: Mirror, self: Resident, on: boolean) {
    reach.visible = on;
    if (!on) return;
    const r = mirror.config.reach;
    if (reachSize !== r) {
      reachSize = r;
      const e = r + 0.5;
      reach.geometry.setAttribute(
        "position",
        new Float32BufferAttribute([-e, 0, -e, e, 0, -e, e, 0, e, -e, 0, e], 3),
      );
      reach.computeLineDistances();
    }
    reach.position.set(self.x, storeyY(self.storey) + 0.04, self.y);
  }

  // ---------- taps ----------

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const canvas = renderer.domElement;
  let down: { id: number; x: number; y: number; t: number } | undefined;
  let pointers = 0;

  const onDown = (e: PointerEvent) => {
    pointers++;
    down =
      pointers === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : undefined;
  };
  const onUp = (e: PointerEvent) => {
    pointers = Math.max(0, pointers - 1);
    const d = down;
    down = undefined;
    if (!d || d.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || e.timeStamp - d.t > 500) return;
    const tile = pick(e.clientX, e.clientY);
    if (tile && lastMirror) opts.onTap(tile);
  };
  const onCancel = () => {
    pointers = Math.max(0, pointers - 1);
    down = undefined;
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);

  // A mouse resting over something a tap acts on shows a pointer. Picking casts rays through the
  // scene, so it runs a few times a second, not on every move, and not while a drag turns the camera.
  const HOVER_MS = 150;
  let mouse: { x: number; y: number } | undefined;
  let hoverAt = 0;
  const onMove = (e: PointerEvent) => {
    mouse =
      e.pointerType === "mouse" && e.buttons === 0 ? { x: e.clientX, y: e.clientY } : undefined;
    if (!mouse) canvas.style.cursor = "";
  };
  const onLeave = () => {
    mouse = undefined;
    canvas.style.cursor = "";
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);

  function hover(now: number) {
    if (!mouse || !opts.tappable || now - hoverAt < HOVER_MS) return;
    hoverAt = now;
    const tile = pick(mouse.x, mouse.y);
    const cursor = tile && opts.tappable(tile) ? "pointer" : "";
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
  }

  /** The tile under a point on screen: a figure first, then a block or building, then the ground. */
  function pick(clientX: number, clientY: number): Tile | undefined {
    const rect = canvas.getBoundingClientRect();
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const { origin, direction } = raycaster.ray;
    const dir = [direction.x, direction.y, direction.z] as const;
    const figureHit = raycaster.intersectObjects(
      [...figures.values()].map((f) => f.group),
      true,
    )[0];
    const solids: Object3D[] = [...chunks.values()].map((c) => c.group);
    for (const b of buildings.values()) solids.push(b.group);
    const hit = raycaster.intersectObjects(solids, true)[0];
    // Whichever is nearer wins: a wall in front of someone takes the tap, and so does someone
    // standing in front of a wall.
    if (figureHit && !(hit && hit.distance < figureHit.distance)) {
      const id = ownerOf(figureHit.object, (o) => o.userData.residentId as string | undefined);
      const away = id ? figures.get(id)?.away : undefined;
      // Someone asleep at home is where they're drawn, not where they last stood.
      if (away) return tileAtPoint(away.x, away.y);
      const r = id ? lastMirror?.residents.get(id) : undefined;
      if (r) return { x: r.x, y: r.y };
    }
    if (hit) {
      const building = [...buildings.values()].find((b) =>
        ownerOf(hit.object, (o) => o === b.group),
      );
      const tile = tileOfHit([hit.point.x, hit.point.y, hit.point.z], dir);
      if (!building) return tile;
      // Anything on a building, its label too, is one of its tiles.
      const fp = building.footprint;
      const clamp = (v: number, mid: number, size: number) =>
        Math.min(mid + (size - 1) / 2, Math.max(mid - (size - 1) / 2, v));
      return { x: clamp(tile.x, fp.x, fp.width), y: clamp(tile.y, fp.y, fp.depth) };
    }
    const g = groundPoint([origin.x, origin.y, origin.z], dir);
    return g ? tileAtPoint(g[0], g[2]) : undefined;
  }

  // ---------- losing the GPU ----------

  const onLost = (e: Event) => {
    e.preventDefault();
    fail("lost");
  };
  canvas.addEventListener("webglcontextlost", onLost);

  return {
    sync(frame) {
      const {
        mirror,
        me,
        look,
        buildMode,
        feelings,
        motion,
        season: seasonNow,
        sky,
        dayPhase,
      } = frame;
      const self = me === undefined ? undefined : mirror.residents.get(me);
      lastMirror = mirror;
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastSync) / 1000);
      lastSync = now;
      if ((!self && !look) || failed) return;
      hover(now);
      // A new season dresses the ground again, plot by plot, like any change to the world.
      const newSeason = seasonNow !== season;
      season = seasonNow;
      const changed = mirror !== mirrorSeen || mirror.seq !== seqSeen || newSeason;
      mirrorSeen = mirror;
      seqSeen = mirror.seq;
      // Someone out on a routine goes back to sleep at home a few minutes after its last step.
      const outNow = mirror
        .outOnRoutine(me)
        .map((o) => o.r.id)
        .join(",");
      const outChanged = outNow !== outSeen;
      outSeen = outNow;
      const tile = look
        ? { x: Math.round(look.x), y: Math.round(look.y) }
        : { x: self?.x ?? 0, y: self?.y ?? 0 };
      const walked = !lastTile || lastTile.x !== tile.x || lastTile.y !== tile.y;
      lastTile = tile;
      if (changed) {
        hearths = hearthKeys(mirror.residents.values());
        homes = litHomes(mirror.residents.values(), mirror.config.plotSize);
        stands = hearthStands(mirror);
        standsWidth = mirror.config.width;
      }
      // The plot you stand on is cut away at your storey, or the one the build bar picked (RFC
      // 0028), as on the map; a link's look cuts nothing.
      const cut = look ? undefined : cutaway(self, mirror.config.plotSize, frame.cutStorey);
      const cutKey = cut ? `${cut.px},${cut.py},${cut.storey}` : "";
      const recut = cutKey !== cutSeen;
      cutSeen = cutKey;
      if (changed || walked || pending || recut) {
        const check = changed || recheck || recut;
        updateChunks(mirror, tile, check, cut);
        recheck = pending && check;
      }
      if (changed || walked || outChanged) {
        updateGround(mirror, tile);
        updateBuildings(mirror);
        updateCast(mirror, me, tile);
        for (const b of buildings.values()) {
          const fp = b.footprint;
          const inside =
            Math.abs(tile.x - fp.x) <= (fp.width - 1) / 2 &&
            Math.abs(tile.y - fp.y) <= (fp.depth - 1) / 2;
          seeThrough(b.group, inside);
        }
      }
      const distance = camera.position.distanceTo(controls.target);
      const viewHeight = 2 * distance * Math.tan((camera.fov * Math.PI) / 360);
      bubblePx =
        (viewHeight / Math.max(1, host.clientHeight)) * (BUBBLE_SCREEN_PX / BUBBLE_FONT_PX);
      let moved = moveFigures(mirror, motion, dt, feelings?.speaker(now), cut);
      if (movePets(mirror, tile, frame, dt, now)) moved = true;
      stackBubbles3d();
      // A feeling from what happened to them wins; otherwise a doze shows as `sleepy`.
      for (const [id, f] of figures)
        if (showFeeling(f.group, feelings?.get(id, now) ?? f.doze, now)) moved = true;
      const followed = look?.id ?? (look ? undefined : me);
      const fig = followed === undefined ? undefined : figures.get(followed);
      if (fig) follow(fig.group.position, fig.rise);
      else if (look) follow(lookSpot.set(look.x, 0, look.y));
      // Signs keep a readable size as the camera pulls back. Only a zoom changes it.
      const sign = signSize(camera.position.distanceTo(controls.target), camera.fov);
      if (Math.abs(sign - signAt) > 0.005) {
        signAt = sign;
        for (const f of figures.values()) sizeSign(f.group, sign);
        moved = true;
      }
      if (self) placeReach(mirror, self, buildMode && !look);
      // The map's time of day, then the weather on top of it (decision 0098), with a holiday's
      // evenings tinted (RFC 0022).
      stage.holiday(mirror.day === undefined ? undefined : holidayOf(mirror.day));
      stage.timeOfDay(dayPhase);
      weather.set(sky ?? CLEAR);
      const up = (sky?.rain ?? 0) >= UMBRELLA_RAIN;
      if (up !== umbrellasUp) {
        umbrellasUp = up;
        for (const f of figures.values()) setUmbrella(f.group, up && !f.away);
        moved = true;
      }
      if (moved || changed || walked || buildMode) stage.invalidate();
    },
    screenOf(id) {
      const fig = figures.get(id);
      if (!fig || !started) return undefined;
      // Beside the figure's middle, where it's drawn this frame: climbing eases its height.
      onScreen
        .copy(fig.group.position)
        .setY(fig.group.position.y + FIGURE_MIDDLE)
        .project(camera);
      if (onScreen.z > 1) return undefined;
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + ((onScreen.x + 1) / 2) * rect.width + BESIDE_PX,
        y: rect.top + ((1 - onScreen.y) / 2) * rect.height,
      };
    },
    heading() {
      if (!started) return 0;
      return cameraQuarter(
        camera.position.x - controls.target.x,
        camera.position.z - controls.target.z,
      );
    },
    dispose() {
      for (const b of buildings.values()) b.unlight();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      for (const key of [...chunks.keys()]) dropChunk(key);
      for (const id of [...figures.keys()]) dropFigure(id);
      for (const id of [...petFigs.keys()]) dropPet(id);
      petGeo.dispose();
      petMat.dispose();
      petShadowGeo.dispose();
      (petShadows.material as MeshBasicMaterial).dispose();
      petShadows.dispose();
      pictures.dispose();
      stage.dispose();
    },
  };
}

const CLEAR: SkyAmounts = { cloud: 0, rain: 0, snow: 0, fog: 0 };

/** A chat bubble on its own canvas, drawn the way the map draws it. */
function bubbleTexture(lines: string[]): { texture: CanvasTexture; w: number; h: number } {
  const fontSize = BUBBLE_FONT_PX;
  const font = `600 ${fontSize}px "Figtree Variable", system-ui, sans-serif`;
  const c = document.createElement("canvas");
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const size = bubbleSize(g, lines, fontSize, font);
  c.width = Math.ceil(size.w) + 12;
  c.height = Math.ceil(size.h) + 8;
  drawBubble(g, c.width / 2, c.height - 2, lines, 1, fontSize, font, c.width);
  return { texture: canvasTexture(c), w: c.width, h: c.height };
}

/** Walk up from a hit object to the first ancestor `test` accepts, and return what it says. */
function ownerOf<T>(
  o: Object3D | null,
  test: (o: Object3D) => T | undefined | false,
): T | undefined {
  for (let at = o; at; at = at.parent) {
    const v = test(at);
    if (v) return v;
  }
  return undefined;
}
