/**
 * The scene photo itself (RFC 0049): the world in 3D from the public snapshot, with only the
 * residents the ticket's scene lets in, the camera where its framing says, name tags laid out by
 * `photo-tags.ts` when asked for, and the stamp under the picture. Reached only through `import()`
 * from `photo.ts`, so three.js stays lazy (decision 0013).
 */
import type { PhotoScene, WorldSnapshot } from "@terrakin/protocol";
import { type Direction, isDecorKind, isFurnitureKind, plotKey, tileKey } from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import { Mirror } from "./mirror";
import { Motion } from "./motion";
import { PetMotion } from "./pets";
import {
  clearSide,
  openRoofs,
  type PhotoView,
  photoView,
  portraitReach,
  sightline,
} from "./photo-framing";
import { layoutTags, TAG_STYLE, type TagLayout, tagColors } from "./photo-tags";
import { createWorld3d, type World3dFrame } from "./scene3d/world";
import { dayPhase } from "./time";
import { Sky, skyNow } from "./weather";

/** The picture's size: the scene over the stamp, 1200x900 in all. */
const WIDTH = 1200;
const HEIGHT = 900;
const STAMP = 84;
/** Most syncs spent building the plots in view before the shot is taken anyway. */
const MAX_SYNCS = 400;

const frames = (n: number) =>
  new Promise<void>((done) => {
    const step = (left: number) =>
      left <= 0 ? done() : requestAnimationFrame(() => step(left - 1));
    step(n);
  });

/**
 * The 3D world and its frame, kept for the next photo in this page. Compiling the scene's drawing
 * programs is most of a photo's time in a headless browser, and a kept stage keeps them compiled.
 */
let kept: { w: ReturnType<typeof createWorld3d>; host: HTMLElement } | undefined;

export async function shoot(root: HTMLElement, scene: PhotoScene, world: WorldSnapshot) {
  const mirror = new Mirror(world);
  // Only who the scene lets in: nobody away, suspended, or blocked either way. The rest are an
  // empty tile, as the map draws a blocked resident.
  const shown = new Set(scene.shown);
  for (const [id, r] of [...mirror.residents]) {
    if (!shown.has(id)) mirror.residents.delete(id);
    // Everyone the server let in is there in person, standing where they are: the photographer
    // too, whose calls over the API alone leave them offline.
    else mirror.residents.set(id, { ...r, online: true });
  }
  // No roof hides the plot the shot is about, or covers its front from the camera.
  const roofless = new Set(
    openRoofs(scene.framing, scene.focus, mirror.config.plotSize).map((p) => plotKey(p.px, p.py)),
  );
  const roofAt = mirror.roofAt.bind(mirror);
  mirror.roofAt = (px, py) => (roofless.has(plotKey(px, py)) ? undefined : roofAt(px, py));
  const subject = scene.focus.id;
  // The subject faces the camera, which always looks from the south.
  if (subject) mirror.facing.set(subject, "s");

  const host = kept?.host ?? h("div", { class: "photo-scene" });
  for (const old of host.querySelectorAll(".photo-tags")) old.remove();
  const tags = h("canvas", {
    class: "photo-tags",
    attrs: { width: String(WIDTH), height: String(HEIGHT - STAMP) },
  });
  const title = h("div", { class: "photo-title" });
  const line = h("div", { class: "photo-line" });
  const stamp = h("footer", { class: "photo-stamp" }, title, line);
  root.replaceChildren(h("div", { class: "photo-frame" }, host, stamp));

  const w =
    kept?.w ??
    createWorld3d(host, {
      onTap() {},
      // A lost GPU context draws nothing again: the world isn't kept, and this photo fails.
      onFail() {
        kept = undefined;
      },
      photo: true,
    });
  kept = { w, host };
  // The stage sizes its lens to the frame when its resize observer first fires, which is after
  // the next frame's callbacks, so wait for the one after.
  await frames(2);
  const { season, weather } = skyNow(scene.nowMs, mirror.day);
  const sky = new Sky().update(weather, 0, true);
  const frame: World3dFrame = {
    mirror,
    // The subject as "you", so the roof over where they stand lifts and the camera starts on
    // them; a plot or an event looks at a place instead.
    me: subject,
    ...(subject ? {} : { look: { x: scene.focus.x, y: scene.focus.y } }),
    buildMode: false,
    motion: new Motion(),
    season,
    sky,
    pets: new PetMotion(),
    clock: scene.nowMs,
    dayPhase: dayPhase(scene.nowMs, scene.dayLengthMs),
  };
  // A portrait is taken from the first side a wall doesn't hide them on, or from over the walls,
  // with the subject turned to face it.
  const lens = w.photo.lens();
  let from: { x: number; z: number } | undefined;
  if (scene.framing === "portrait") {
    const floor = (subject ? mirror.residents.get(subject)?.floor : undefined) ?? 0;
    const blocks = mirror.blocksAt(floor || undefined);
    const tall = (x: number, y: number) => {
      const kind = blocks.get(tileKey(x, y));
      return kind !== undefined && !isFurnitureKind(kind) && !isDecorKind(kind);
    };
    const tile = { x: Math.round(scene.focus.x), y: Math.round(scene.focus.y) };
    const reach = portraitReach(1.9, lens.fovDeg);
    from = clearSide(tall, tile, reach);
    if (!from) {
      // Walled in, as at home: the wall in front opens, in this photo's copy of the world only.
      from = { x: 0, z: 1 };
      for (const t of sightline(tile, from, reach))
        if (tall(t.x, t.y)) blocks.delete(tileKey(t.x, t.y));
    }
    if (subject) mirror.facing.set(subject, facingToward(from));
  }
  // Every plot in view, built before the shot: the world view builds two a frame as you walk.
  let syncs = 0;
  do w.sync(frame);
  while (w.photo.busy() && ++syncs < MAX_SYNCS);

  const fig = subject ? w.photo.figure(subject) : undefined;
  const view: PhotoView = photoView(scene.framing, {
    // Where the subject is drawn, which a hearth's stand can pull off their tile.
    focus: fig ? { x: fig.x, z: fig.z } : { x: scene.focus.x, z: scene.focus.y },
    ...(from === undefined ? {} : { from }),
    ...(fig ? { figureTop: fig.top, floorY: fig.floorY } : {}),
    plotSize: mirror.config.plotSize,
    ...lens,
  });
  w.photo.aim(view);
  // The one frame the photo draws: a still stage draws nothing on its own.
  w.photo.draw();
  if (kept?.w !== w) throw new Error("the 3D view stopped");

  let more = 0;
  if (scene.names) {
    // Measured and drawn in the tags' own face.
    await document.fonts.load(TAG_STYLE.font).catch(() => undefined);
    const layout = drawTags(tags, w.photo.heads(), scene, mirror);
    more = layout.more;
  }
  host.append(tags);
  if (scene.title) title.textContent = scene.title;
  else title.hidden = true;
  line.textContent = more > 0 ? `${scene.stamp} · and ${more} more` : scene.stamp;
  await frames(1);
}

/** Lay the tags out for the picture and draw them, leader lines first so no line crosses a tag. */
function drawTags(
  canvas: HTMLCanvasElement,
  heads: ReturnType<ReturnType<typeof createWorld3d>["photo"]["heads"]>,
  scene: PhotoScene,
  mirror: Mirror,
): TagLayout {
  const g = canvas.getContext("2d");
  if (!g) return { tags: [], more: 0 };
  g.font = TAG_STYLE.font;
  const measure = (text: string) => g.measureText(text).width;
  // Nobody hidden behind a wall or someone nearer gets a tag, but the subject always does.
  const subject = scene.focus.id;
  const named = heads.flatMap((head) => {
    const r = mirror.residents.get(head.id);
    return r && (!head.hidden || head.id === subject) ? [{ ...head, name: r.name }] : [];
  });
  const layout = layoutTags(named, {
    width: canvas.width,
    height: canvas.height,
    measure,
    first: scene.first,
  });
  g.lineWidth = 2;
  g.strokeStyle = TAG_STYLE.leader;
  g.fillStyle = TAG_STYLE.leader;
  for (const t of layout.tags) {
    if (!t.leader) continue;
    g.globalAlpha = 0.75;
    g.beginPath();
    g.moveTo(t.leader.x1, t.leader.y1);
    g.lineTo(t.leader.x2, t.leader.y2);
    g.stroke();
    g.beginPath();
    g.arc(t.leader.x2, t.leader.y2, 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const t of layout.tags) {
    const { x, y, w, h: ht } = t.box;
    const r = mirror.residents.get(t.id);
    const colors = r ? tagColors(r.color, r.theme) : TAG_STYLE;
    g.fillStyle = "rgba(74, 52, 28, 0.18)";
    g.beginPath();
    g.roundRect(x, y + 2, w, ht, ht / 2);
    g.fill();
    g.fillStyle = colors.backing;
    g.strokeStyle = colors.edge;
    g.lineWidth = 1.5;
    g.beginPath();
    g.roundRect(x, y, w, ht, ht / 2);
    g.fill();
    g.stroke();
    // Names are resident text: drawn as canvas text, never markup.
    g.fillStyle = TAG_STYLE.text;
    g.fillText(t.text, x + w / 2, y + ht / 2 + 1);
  }
  // Who got a tag and where, for the e2e check that no tag runs off the frame or touches another.
  canvas.dataset.tags = JSON.stringify(layout.tags.map((t) => ({ id: t.id, ...t.box })));
  return layout;
}

/** The way to face to look along `d`, a flat step. */
function facingToward(d: { x: number; z: number }): Direction {
  const dirs: Direction[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  const turn = Math.round((Math.atan2(d.x, -d.z) / (Math.PI * 2)) * 8);
  return dirs[(turn + 8) % 8] ?? "s";
}
