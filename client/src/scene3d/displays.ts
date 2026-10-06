/**
 * What's on display in 3D (decision 0059): a piece's own picture in a little frame on a pedestal or
 * in a frame's easel, and any other made thing as its drawn picture, standing on the pedestal or
 * hung in the frame. Shared by the plot view and the world.
 *
 * Textures stay inside decision 0060's budget: a piece's picture is cropped and scaled down to
 * 256 by 192 once, every display of the same thing shares one texture, at most `MAX_PICTURES`
 * pictures are held at a time (past that a piece shows its drawn picture), and a texture is freed
 * as soon as the last display using it leaves. Pictures come only from our own `/media/`.
 */
import type { FindKind } from "@terrakin/sim";
import { BRAND_HEX } from "@terrakin/ui/brand";
import { itemArtLoaded, piecePictureUrl } from "@terrakin/ui/item-art";
import {
  type BufferGeometry,
  type CanvasTexture,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  type Texture,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { bakeShade, canvasTexture, paper, type Stage, spotTexture, unindexed } from "./art";
import { framePicturePlane } from "./decor";
import type { LayoutDisplay, ShownGood } from "./layout";
import { blockLook, hex } from "./palette";

/** A piece's picture, cropped to the frame's shape. About 260 kB each with its mipmaps. */
const PICTURE = { width: 256, height: 192 } as const;
/** A drawn picture's side, and the paper card it hangs in a frame on. */
const ART = 128;
const CARD = { width: 160, height: 120 } as const;
/** At most this many pieces' own pictures are held at once (about 4 MB). */
export const MAX_PICTURES = 16;

interface Entry {
  refs: number;
  texture: Promise<Texture | undefined>;
}

/**
 * The textures what's on display draws with, shared and counted. `take` hands out a texture and
 * the function that gives it back; the last one given back frees it. Textures in use are in
 * `spare`, so a part of the scene freed with `disposeTree(group, spare)` leaves them alone.
 */
export interface Pictures {
  take(key: string, draw: () => Promise<HTMLCanvasElement | undefined>): Taken;
  has(key: string): boolean;
  /** How many of a piece's own pictures are held now. */
  pictures(): number;
  dispose(): void;
}

interface Taken {
  texture: Promise<Texture | undefined>;
  release(): void;
}

export function createPictures(spare: Set<Texture> = new Set()): Pictures {
  const entries = new Map<string, Entry>();
  const drop = (key: string, entry: Entry) => {
    if (entries.get(key) === entry) entries.delete(key);
    void entry.texture.then((t) => {
      if (!t) return;
      spare.delete(t);
      t.dispose();
    });
  };
  return {
    take(key, draw) {
      let entry = entries.get(key);
      if (!entry) {
        const fresh: Entry = { refs: 0, texture: Promise.resolve(undefined) };
        fresh.texture = draw().then(
          (c) => {
            if (!c) return undefined;
            const t: CanvasTexture = canvasTexture(c);
            if (fresh.refs > 0) spare.add(t);
            return t;
          },
          () => undefined,
        );
        entries.set(key, fresh);
        entry = fresh;
      }
      const held = entry;
      held.refs++;
      let given = false;
      return {
        texture: held.texture,
        release() {
          if (given) return;
          given = true;
          held.refs--;
          if (held.refs <= 0) drop(key, held);
        },
      };
    },
    has(key) {
      return entries.has(key);
    },
    pictures() {
      let n = 0;
      for (const key of entries.keys()) if (key.startsWith("pic:")) n++;
      return n;
    },
    dispose() {
      for (const [key, entry] of [...entries]) {
        entry.refs = 0;
        drop(key, entry);
      }
    },
  };
}

function blank(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] | undefined {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  return g ? [c, g] : undefined;
}

/** A piece's own picture, cropped to fill the frame and scaled down. Only our own media loads. */
async function pictureCanvas(url: string): Promise<HTMLCanvasElement | undefined> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  const out = blank(PICTURE.width, PICTURE.height);
  if (!out || img.naturalWidth === 0) return undefined;
  const [c, g] = out;
  const k = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight);
  const w = img.naturalWidth * k;
  const h = img.naturalHeight * k;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
  return c;
}

/** A thing's drawn picture: on paper to hang in a frame, or cut out to stand on a pedestal. */
async function artCanvas(kind: ShownGood["kind"], onPaper: boolean) {
  const img = await itemArtLoaded(kind);
  if (!img) return undefined;
  const out = onPaper ? blank(CARD.width, CARD.height) : blank(ART, ART);
  if (!out) return undefined;
  const [c, g] = out;
  if (onPaper) {
    g.fillStyle = BRAND_HEX.paper;
    g.fillRect(0, 0, c.width, c.height);
  }
  const side = Math.min(c.width, c.height) * (onPaper ? 1.1 : 1);
  g.drawImage(img, (c.width - side) / 2, (c.height - side) / 2, side, side);
  return c;
}

/** A piece's own picture, while fewer than `MAX_PICTURES` are held (or this one already is). */
function pictureFor(good: ShownGood, pictures: Pictures): Taken | undefined {
  const url = piecePictureUrl(good);
  if (!url) return undefined;
  const key = `pic:${url}`;
  if (!pictures.has(key) && pictures.pictures() >= MAX_PICTURES) return undefined;
  return pictures.take(key, () => pictureCanvas(url));
}

/** A thing's drawn picture: on paper to hang in a frame, or cut out to stand on a pedestal. */
function artFor(good: ShownGood, inFrame: boolean, pictures: Pictures): Taken {
  return inFrame
    ? pictures.take(`card:${good.kind}`, () => artCanvas(good.kind, true))
    : pictures.take(`art:${good.kind}`, () => artCanvas(good.kind, false));
}

/** Where the little frame on a pedestal holds its picture. */
const STAND = { width: 0.6, height: 0.45, border: 0.05, depth: 0.05, tilt: -0.12 } as const;

/** The little wooden frame a picture stands in on a pedestal, with a prop behind it. */
function standFrame(): BufferGeometry {
  const { width: w, height: h, border: t, depth: d } = STAND;
  const bar = (bw: number, bh: number, bd: number, x: number, y: number, z: number) => {
    const g = new RoundedBoxGeometry(bw, bh, bd, 1, 0.012);
    g.translate(x, y, z);
    return unindexed(g);
  };
  const parts = [
    bar(w + t * 2, t, d, 0, h / 2 + t / 2, 0),
    bar(w + t * 2, t, d, 0, -h / 2 - t / 2, 0),
    bar(t, h, d, -w / 2 - t / 2, 0, 0),
    bar(t, h, d, w / 2 + t / 2, 0, 0),
    bar(w, h, 0.012, 0, 0, -d / 2 + 0.006),
  ];
  const prop = new RoundedBoxGeometry(0.05, h, 0.04, 1, 0.012);
  prop.rotateX(0.5);
  prop.translate(0, -0.04, -0.12);
  parts.push(unindexed(prop));
  const geo = bakeShade(mergeGeometries(parts), 0.75, 1);
  for (const p of parts) p.dispose();
  return placeOnPedestal(geo);
}

/** Lean a geometry built around its middle back a little and stand it on a pedestal's top. */
function placeOnPedestal(geo: BufferGeometry): BufferGeometry {
  const { height: h, border: t, tilt } = STAND;
  geo.rotateX(tilt);
  geo.translate(0, blockLook("pedestal").height + h / 2 + t + 0.01, 0);
  return geo;
}

function pictureMaterial(map: Texture): MeshLambertMaterial {
  return new MeshLambertMaterial({
    map,
    emissive: 0xffffff,
    emissiveMap: map,
    emissiveIntensity: 0.12,
  });
}

/**
 * Everything on display in `list`, placed relative to `origin`. Pictures arrive as they load. What
 * this takes from `pictures` is given back when `stage` (a stage or a scope) lets go of its parts.
 */
export function displayedThings(
  stage: Stage,
  origin: { x: number; y: number },
  list: readonly LayoutDisplay[],
  pictures: Pictures,
  grain: Texture,
): Group {
  const group = new Group();
  group.name = "on display";
  if (list.length === 0) return group;
  let gone = false;
  const taken: Taken[] = [];
  stage.keep({
    dispose() {
      gone = true;
      for (const t of taken.splice(0)) t.release();
    },
  });
  const at = (d: LayoutDisplay) => new Vector3(d.x - origin.x, 0, d.y - origin.y);

  // Pieces on pedestals stand in a little frame: one draw for all of them.
  const framed = list.filter((d) => d.on === "pedestal" && d.good.kind === "piece");
  if (framed.length > 0) {
    const frames = new InstancedMesh(standFrame(), paper(hex("#8d5d36"), grain), framed.length);
    const m = new Matrix4();
    framed.forEach((d, i) => {
      frames.setMatrixAt(i, m.makeTranslation(at(d)));
    });
    frames.castShadow = true;
    frames.receiveShadow = true;
    group.add(frames);
  }

  const standPlane = stage.keep(placeOnPedestal(new PlaneGeometry(STAND.width, STAND.height)));
  const easelPlane = stage.keep(framePicturePlane(0.02));
  const pedestalTop = blockLook("pedestal").height;
  for (const d of list) {
    // A piece stands in a frame on a pedestal; a model piece shows its drawn picture there.
    const inFrame = d.on === "frame" || d.good.kind === "piece";
    const show = (t: Taken, fallback?: () => Taken) => {
      taken.push(t);
      void t.texture.then((map) => {
        if (gone) return;
        if (!map) {
          if (fallback) show(fallback());
          return;
        }
        let shown: Mesh | Sprite;
        if (inFrame) {
          shown = new Mesh(d.on === "frame" ? easelPlane : standPlane, pictureMaterial(map));
          shown.position.copy(at(d));
        } else {
          // A jar, a bouquet, a wreath: its drawn picture standing on the pedestal, facing you.
          const size = 0.62;
          shown = new Sprite(new SpriteMaterial({ map, alphaTest: 0.5, color: 0xf4f0ea }));
          shown.scale.set(size, size, 1);
          shown.position.copy(at(d)).setY(pedestalTop + size / 2 - 0.04);
        }
        group.add(shown);
        stage.invalidate();
      });
    };
    const art = () => artFor(d.good, inFrame, pictures);
    const picture = pictureFor(d.good, pictures);
    if (picture) show(picture, art);
    else show(art());
  }
  return group;
}

/**
 * Finds lying on the ground (RFC 0021): each one's drawn picture standing on its tile, facing you,
 * like a jar on a pedestal but small, with a pale glint under it so it reads as something special.
 * Every find of a kind shares one texture and one material, from the pictures pedestals use.
 */
export function foundThings(
  stage: Stage,
  origin: { x: number; y: number },
  list: readonly { x: number; y: number; kind: FindKind }[],
  pictures: Pictures,
): Group {
  const group = new Group();
  group.name = "finds";
  if (list.length === 0) return group;
  let gone = false;
  const taken: Taken[] = [];
  stage.keep({
    dispose() {
      gone = true;
      for (const t of taken.splice(0)) t.release();
    },
  });
  const size = 0.6;
  // A soft round glow on the ground, wider than deep, the way the map draws one.
  const glint = stage.keep(new PlaneGeometry(0.8, 0.48));
  glint.rotateX(-Math.PI / 2);
  const glow = stage.keep(
    new MeshBasicMaterial({
      map: stage.keep(spotTexture("255, 250, 240")),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );
  for (const kind of new Set(list.map((f) => f.kind))) {
    const art = pictures.take(`art:${kind}`, () => artCanvas(kind, false));
    taken.push(art);
    void art.texture.then((map) => {
      if (gone || !map) return;
      const material = stage.keep(new SpriteMaterial({ map, alphaTest: 0.5 }));
      for (const f of list) {
        if (f.kind !== kind) continue;
        const at = new Vector3(f.x - origin.x, 0, f.y - origin.y);
        const under = new Mesh(glint, glow);
        under.position.copy(at).setY(0.012);
        under.renderOrder = 1;
        const shown = new Sprite(material);
        shown.scale.set(size, size, 1);
        shown.position.copy(at).setY(size / 2 - 0.03);
        group.add(under, shown);
      }
      stage.invalidate();
    });
  }
  return group;
}
