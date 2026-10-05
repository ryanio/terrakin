/**
 * The world in 3D (RFC 0005 step C, decision 0060): the same mirror the 2D map draws, around you,
 * with the camera following you. It only renders. `world.ts` keeps the connection, the walking,
 * and every action, and hands this a tap as a tile, the same way the 2D canvas does.
 *
 * Plots load as chunks within `VIEW_RADIUS` of you (fog hides the edge), at most two built per
 * frame, and each is freed when you walk away. Blocks, plot borders, grass, hearths, and figures
 * come from the plot view's builders (`plot.ts`), and the Town Hall and the shop from
 * `buildings.ts`. Loaded only through `import()` (decision 0013).
 */
import {
  groundTile,
  OUTSIDE_GROUND,
  plotKey,
  type Resident,
  THEME_INFO,
  THEME_TINT_ALPHA,
} from "@terrakin/sim";
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  type Fog,
  Group,
  LineDashedMaterial,
  LineLoop,
  type Mesh,
  type Object3D,
  Raycaster,
  type Texture,
  Vector2,
  Vector3,
} from "three";
import type { Mirror } from "../mirror";
import {
  createStage,
  disposeTree,
  grainTexture,
  plankTexture,
  type Scope,
  scoped,
  spotTexture,
  stoneTexture,
} from "./art";
import { type Footprint, footprintOf, seeThrough, shop, townHall } from "./buildings";
import { createPictures, displayedThings } from "./displays";
import { cornerLight, type LayoutFigure } from "./layout";
import { hex, SKY } from "./palette";
import {
  blockMeshes,
  border,
  cropPlants,
  figure,
  groundGrid,
  hearth,
  pickups,
  scenery,
} from "./plot";
import {
  approach,
  BUILDS_PER_FRAME,
  chunkSignature,
  faceAngle,
  figuresAround,
  GROUND_STEP,
  groundAnchor,
  groundPoint,
  hearthKeys,
  KEEP_SLACK,
  nearbyLabel,
  plotsAround,
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
  /** The 3D view can't go on here: too slow even after stepping down, or the GPU went away. */
  onFail(reason: "slow" | "lost"): void;
}

export interface World3dFrame {
  mirror: Mirror;
  me: string;
  buildMode: boolean;
}

export interface World3d {
  /** Bring the scene up to date with the mirror. Called every frame by the world loop. */
  sync(frame: World3dFrame): void;
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
  turn: number;
}

interface Building {
  group: Group;
  footprint: Footprint;
  signature: string;
}

/** How far the camera starts from you, and how close and far a pinch can take it. */
const START_OFFSET = new Vector3(0, 13, 12);
const MIN_DISTANCE = 6;
const MAX_DISTANCE = 24;
/** How quickly figures glide to their tile and turn, per second. */
const GLIDE = 12;
const TURN = 10;
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
  const surfaces = { plank: stage.keep(plankTexture()), stone: stage.keep(stoneTexture()) };
  const hearthLook = { stone: surfaces.stone, glow: stage.keep(spotTexture("255, 170, 80")) };
  const shared = new Set<Texture>([
    grain,
    shadowMap,
    surfaces.plank,
    surfaces.stone,
    hearthLook.glow,
  ]);
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
  const buildings = new Map<"hall" | "shop", Building>();
  let ground: { mesh: Mesh; signature: string } | undefined;
  let mirrorSeen: Mirror | undefined;
  let seqSeen = -1;
  let lastTile: Tile | undefined;
  let pending = false;
  /** A pass over changed plots stopped at the per-frame cap: the next frame finishes it. */
  let recheck = false;
  let started = false;
  let lastSync = performance.now();
  let lastMirror: Mirror | undefined;
  let hearths = new Set<string>();

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

  function buildChunk(mirror: Mirror, px: number, py: number): Chunk {
    const data = readChunk(mirror, px, py, hearths);
    const scope = scoped(stage);
    const group = new Group();
    group.name = `plot ${px},${py}`;
    const origin = { x: 0, y: 0 };
    const blocks = data.blocks.map((b) => ({ ...b, own: true, fade: 0 }));
    const parts = blockMeshes(scope, origin, blocks, grain, surfaces);
    if (parts.length) group.add(...parts);
    if (data.owner) group.add(border(data.bounds, origin, grain));
    group.add(scenery(scope, origin, data.tufts, data.flowers));
    if (data.pickups.length) group.add(pickups(origin, data.pickups));
    for (const h of data.hearths) {
      const home = hearth(scope, grain, { light: false, ...hearthLook });
      home.position.set(h.x, 0, h.y);
      group.add(home);
    }
    const crops = cropPlants(scope, origin, data.crops);
    if (crops.length) group.add(...crops);
    group.add(displayedThings(scope, origin, data.displays, pictures, grain));
    scene.add(group);
    return { group, scope, signature: data.signature };
  }

  function updateChunks(mirror: Mirror, tile: Tile, changed: boolean) {
    const { config } = mirror;
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
      if (have && have.signature === chunkSignature(mirror, p.x, p.y, hearths)) continue;
      if (built >= BUILDS_PER_FRAME) {
        pending = true;
        break;
      }
      dropChunk(key);
      chunks.set(key, buildChunk(mirror, p.x, p.y));
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
      .map((p) => chunkSignature(mirror, p.x, p.y, hearths))
      .join("/")}`;
    if (ground?.signature === signature) return;
    if (ground) {
      scene.remove(ground.mesh);
      disposeTree(ground.mesh, shared);
    }
    const S = config.plotSize;
    const plotTint = new Color(0xb4cd86);
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
        c = new Color(hex(groundTile(config, tx, ty, inCommons).fill));
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
    for (const [name, tiles, make] of [
      ["hall", mirror.townHall, townHall],
      ["shop", mirror.shop, shop],
    ] as const) {
      const fp = footprintOf(tiles);
      const signature = fp ? `${fp.x},${fp.y},${fp.width},${fp.depth}` : "";
      const have = buildings.get(name);
      if (have?.signature === signature) continue;
      if (have) {
        scene.remove(have.group);
        disposeTree(have.group, shared);
        buildings.delete(name);
      }
      if (!fp) continue;
      const group = make(fp, grain);
      group.position.set(fp.x, 0, fp.y);
      scene.add(group);
      buildings.set(name, { group, footprint: fp, signature });
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
      },
    };
  }

  function dropFigure(id: string) {
    const f = figures.get(id);
    if (!f) return;
    figures.delete(id);
    scene.remove(f.group);
    f.scope.release();
    disposeTree(f.group, shared);
  }

  /** Who is drawn, and in what look. Runs when the mirror changes. */
  function updateCast(mirror: Mirror, me: string, tile: Tile) {
    const shown = figuresAround(mirror.residents.values(), tile, me);
    const ids = new Set(shown.map((r) => r.id));
    // The canvas can't be read aloud, so the view names who is around (names as plain text).
    const label = nearbyLabel(shown.filter((r) => r.id !== me).map((r) => r.name));
    if (host.getAttribute("aria-label") !== label) host.setAttribute("aria-label", label);
    for (const id of [...figures.keys()]) if (!ids.has(id)) dropFigure(id);
    for (const r of shown) {
      const mine = r.id === me;
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
        mine,
      ]);
      const have = figures.get(r.id);
      if (have?.signature === signature) continue;
      const at = have ? have.group.position.clone() : new Vector3(r.x, 0, r.y);
      const turn = have?.turn ?? faceAngle(mirror.facing.get(r.id));
      dropFigure(r.id);
      const scope = scoped(stage);
      const group = figure(scope, figureOf(r, mine), shadowMap);
      group.userData.residentId = r.id;
      // A crowd casts blob shadows only: a real one per figure would double its draws.
      group.traverse((o) => {
        o.castShadow = false;
      });
      group.position.copy(at);
      group.rotation.y = turn;
      scene.add(group);
      figures.set(r.id, { group, scope, signature, turn });
    }
  }

  /** Glide each figure to its tile and turn it the way it walked. True if anything moved. */
  function moveFigures(mirror: Mirror, dt: number): boolean {
    let moved = false;
    for (const [id, f] of figures) {
      const r = mirror.residents.get(id);
      if (!r) continue;
      const p = f.group.position;
      const x = still ? r.x : approach(p.x, r.x, dt, GLIDE);
      const z = still ? r.y : approach(p.z, r.y, dt, GLIDE);
      const want = faceAngle(mirror.facing.get(id));
      const gap = turnBetween(f.turn, want);
      const turn = still || Math.abs(gap) < 1e-3 ? want : f.turn + gap * (1 - Math.exp(-TURN * dt));
      if (x !== p.x || z !== p.z || turn !== f.turn) moved = true;
      p.x = x;
      p.z = z;
      f.turn = turn;
      f.group.rotation.y = turn;
    }
    return moved;
  }

  // ---------- the camera ----------

  const focus = new Vector3();
  const lastFocus = new Vector3(Number.NaN, 0, 0);

  function follow(at: Vector3) {
    focus.set(at.x, 0.6, at.z);
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
    // Haze starts just past you and closes in at the view radius, wherever the camera is.
    const d = camera.position.distanceTo(controls.target);
    fog.near = d + 2;
    fog.far = d + VIEW_RADIUS * 1.6;
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
    reach.position.set(self.x, 0.04, self.y);
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
    sync({ mirror, me, buildMode }) {
      const self = mirror.residents.get(me);
      lastMirror = mirror;
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastSync) / 1000);
      lastSync = now;
      if (!self || failed) return;
      const changed = mirror !== mirrorSeen || mirror.seq !== seqSeen;
      mirrorSeen = mirror;
      seqSeen = mirror.seq;
      const tile = { x: self.x, y: self.y };
      const walked = !lastTile || lastTile.x !== tile.x || lastTile.y !== tile.y;
      lastTile = tile;
      if (changed) hearths = hearthKeys(mirror.residents.values());
      if (changed || walked || pending) {
        const check = changed || recheck;
        updateChunks(mirror, tile, check);
        recheck = pending && check;
      }
      if (changed || walked) {
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
      const moved = moveFigures(mirror, dt);
      const mine = figures.get(me);
      if (mine) follow(mine.group.position);
      placeReach(mirror, self, buildMode);
      if (moved || changed || walked || buildMode) stage.invalidate();
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      for (const key of [...chunks.keys()]) dropChunk(key);
      for (const id of [...figures.keys()]) dropFigure(id);
      pictures.dispose();
      stage.dispose();
    },
  };
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
