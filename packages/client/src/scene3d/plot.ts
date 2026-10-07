/**
 * "Visit in 3D": one plot as a warm low-poly diorama. Blocks become rounded voxels (wood and stone
 * with planks and stones, glass as framed panes, leaf as swaying clumps), the hearth a little
 * stone fireplace with a glow and chimney smoke, residents soft peg figures in their color and
 * shape, and the neighbors' ground melts into the haze. A resident's own home model or picture,
 * when they have one, stands on the plot too.
 */

import { Group, Mesh, Vector3 } from "three";
import { dayPhase } from "../time";
import { UMBRELLA_RAIN, WEATHER_LOOK } from "../weather";
import { addAll, blobShadow, grainTexture, type Stage, spotTexture } from "./art";
import { blockMeshes } from "./blocks";
import { cropPlants } from "./crops";
import { createPictures, displayedThings } from "./displays";
import { figure, setUmbrella, sizeSign } from "./figure";
import { border, ground } from "./ground";
import { hearth } from "./hearth";
import { loadHomeModel, loadSign } from "./home";
import {
  groundDecor,
  type HomeExtras,
  hearthPull,
  hearthStand,
  modelFootprint,
  type PlotLayout,
  signSize,
  tileHash,
  underFootprint,
} from "./layout";
import { groundAtlas, groundTiles } from "./paths";
import { petGeometry, petMaterial } from "./pets";
import { scenery } from "./scenery";
import { createWeather } from "./weather";

export interface PlotSceneOptions {
  /** A note for the page when the owner's own model or picture couldn't be shown. */
  onNote?(text: string): void;
}

/** Build the plot into the stage. Everything added is freed by `stage.dispose()`. */
export function buildPlot(
  stage: Stage,
  layout: PlotLayout,
  extras: HomeExtras,
  opts: PlotSceneOptions = {},
) {
  const root = new Group();
  stage.scene.add(root);
  const grain = stage.keep(grainTexture());
  const origin = layout.center;
  const toX = (x: number) => x - origin.x;
  const toZ = (y: number) => y - origin.y;

  const footprint = extras.homeModel ? modelFootprint(layout) : undefined;
  const blocks = footprint
    ? layout.blocks.filter((b) => !(b.own && underFootprint(footprint, b.x, b.y)))
    : layout.blocks;
  const solid = new Set(blocks.map((b) => `${b.x},${b.y}`));
  if (layout.hearth) solid.add(`${layout.hearth.x},${layout.hearth.y}`);

  root.add(ground(layout, solid));
  root.add(border(layout.bounds, origin, grain));
  addAll(root, blockMeshes(stage, origin, blocks, grain));
  // Paths and floors (RFC 0016), and no grass tufts poking through them.
  if (layout.ground.length > 0) {
    const paved = groundTiles(origin, layout.ground, stage.keep(groundAtlas()));
    if (paved) root.add(paved);
  }
  const covered = new Set([...solid, ...layout.ground.map((g) => `${g.x},${g.y}`)]);
  const { tufts, flowers, leaves } = groundDecor(
    {
      x0: layout.bounds.x0 - 2,
      y0: layout.bounds.y0 - 2,
      x1: layout.bounds.x1 + 2,
      y1: layout.bounds.y1 + 2,
    },
    covered,
    layout.season,
  );
  root.add(scenery(stage, origin, tufts, flowers, leaves, layout.season));
  if (layout.hearth) {
    const h = hearth(stage, grain);
    h.position.set(toX(layout.hearth.x), 0, toZ(layout.hearth.y));
    root.add(h);
  }
  // Whatever stands under their own model gives way to it, like the blocks.
  const shown = <T extends { x: number; y: number }>(list: readonly T[]) =>
    footprint ? list.filter((t) => !underFootprint(footprint, t.x, t.y)) : list;
  addAll(root, cropPlants(stage, origin, shown(layout.crops)));
  root.add(
    displayedThings(stage, origin, shown(layout.displays), stage.keep(createPictures()), grain),
  );
  const shadowMap = stage.keep(spotTexture());
  // Someone on the hearth's tile stands clear of the stonework, not inside it.
  const home = layout.hearth;
  const stand = home
    ? hearthStand((dx, dy) => {
        const x = home.x + dx;
        const y = home.y + dy;
        return layout.inWorld(x, y) && !solid.has(`${x},${y}`);
      })
    : undefined;
  // The weather when the snapshot was taken (decision 0073): rain or snow over the plot, a greyer
  // sky, and umbrellas up in the rain.
  const sky = WEATHER_LOOK[layout.weather];
  const weather = createWeather(stage, { radius: layout.size / 2 + layout.margin });
  // The time of day on the server's clock, kept going here, so the plot gets dark when the map does
  // (decision 0098).
  const clock = layout.time && { ...layout.time, at: performance.now() };
  // Halloween's evenings and Midwinter's have a tint of their own (RFC 0022).
  stage.holiday(layout.holiday);
  const tick = () => {
    stage.timeOfDay(
      clock ? dayPhase(clock.nowMs + performance.now() - clock.at, clock.dayLengthMs) : undefined,
    );
    weather.set(sky);
  };
  tick();
  if (clock) {
    const timer = setInterval(tick, 2000);
    stage.keep({ dispose: () => clearInterval(timer) });
  }
  const figures: Group[] = [];
  for (const f of layout.figures) {
    const fig = figure(stage, f, shadowMap);
    // Someone asleep at home already stands clear of the stonework.
    const pull = home && stand && !f.away ? hearthPull(f.x, f.y, home.x, home.y) : 0;
    fig.position.set(toX(f.x) + (stand?.x ?? 0) * pull, 0, toZ(f.y) + (stand?.y ?? 0) * pull);
    // Face the camera's usual side (south-east), with a little turn each.
    fig.rotation.y = 0.5 + ((tileHash(f.x, f.y) % 100) / 100 - 0.5) * 0.8;
    // Out in the rain an umbrella goes up; asleep at home it stays rolled up beside them.
    setUmbrella(fig, sky.rain >= UMBRELLA_RAIN && !f.away);
    root.add(fig);
    figures.push(fig);
  }

  // The owner's pet by the hearth (RFC 0019): breathing slowly while it sleeps.
  const pet = layout.pet;
  if (pet) {
    const mesh = new Mesh(
      stage.keep(petGeometry(pet.kind, pet.coat, pet.asleep ? "asleep" : "awake")),
      stage.keep(petMaterial()),
    );
    mesh.position.set(toX(pet.x), 0, toZ(pet.y));
    mesh.rotation.y = pet.heading;
    mesh.scale.setScalar(1.15);
    mesh.castShadow = true;
    const shadow = blobShadow(shadowMap, 0.26, 0.24);
    shadow.position.set(toX(pet.x), shadow.position.y, toZ(pet.y));
    root.add(mesh, shadow);
    if (!stage.reducedMotion) {
      stage.animate(({ time }) => {
        mesh.scale.y =
          1.15 * (1 + Math.sin(time * (pet.asleep ? 1.4 : 2.2)) * (pet.asleep ? 0.03 : 0.015));
      });
    }
  }

  if (extras.homeModel && footprint) {
    loadHomeModel(stage, root, extras.homeModel, {
      x: toX(footprint.x),
      z: toZ(footprint.y),
      fit: { width: footprint.width, depth: footprint.depth, height: footprint.height },
    })
      .then((ok) => {
        if (!ok)
          opts.onNote?.(
            "Their home model is too detailed to show here, so you're seeing their blocks.",
          );
      })
      .catch(() =>
        opts.onNote?.("Their home model couldn't be shown, so you're seeing their blocks."),
      );
  } else if (extras.homeArt) {
    loadSign(stage, root, extras.homeArt, layout).catch(() => {
      opts.onNote?.("Their picture couldn't be shown.");
    });
  }

  const radius = layout.size * 0.56;
  const center = new Vector3(0, 0.6, 0);
  stage.light(new Vector3(0, 0, 0), layout.size / 2 + layout.margin);
  stage.frame(center, radius, new Vector3(0.55, 0.78, 1));
  // Signs keep a readable size as the camera pulls back. Only a zoom changes it.
  const { camera, controls } = stage;
  const fitSigns = () => {
    const size = signSize(camera.position.distanceTo(controls.target), camera.fov);
    for (const fig of figures) sizeSign(fig, size);
  };
  fitSigns();
  controls.addEventListener("change", fitSigns);
  return root;
}
