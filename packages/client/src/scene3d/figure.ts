import type { Feeling } from "@terrakin/ui/feelings";
import { drawFeelingIcon, FEELING_ICON, type FeelingIcon, garmentColor } from "@terrakin/ui/figure";
import { lookPalette } from "@terrakin/ui/looks";
import {
  type BufferGeometry,
  type CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Texture,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { idPhase, type Pose, pose, restingPose, type Shown } from "../feelings";
import { bakeShade, blobShadow, canvasTexture, lin, nameTag, type Stage } from "./art";
import { hairMesh } from "./hair";
import { FIGURE_SCALE, type LayoutFigure, SIGN_SIZE, tagHeight, tileHash } from "./layout";
import { BRAND, residentHex, SKY } from "./palette";
import { wearGroup } from "./wear";

// ---------- residents ----------

const HEAD_Y = 0.66;
const HEAD_R = 0.17;

/** Put a flat face part on the head's surface at (x, y) from its middle, facing out. */
function onHeadSurface(m: Mesh, x: number, y: number) {
  const z = Math.sqrt(HEAD_R * HEAD_R - x * x - y * y);
  const k = (HEAD_R + 0.004) / HEAD_R;
  m.position.set(x * k, y * k, z * k);
  m.rotation.set(-Math.asin(y / HEAD_R), Math.atan2(x, z), 0, "YXZ");
}

/** The parts of a peg's face that change with a feeling (RFC 0013). */
interface FaceParts {
  /** The head and everything on it, turned to look at someone and tilted by feelings. */
  head: Group;
  /** The eyes, turned together to look up or down. */
  eyes: Group;
  dots: Mesh[];
  arcs: Mesh[];
  smile: Mesh;
  mouth: Mesh;
  cheeks: Mesh[];
  cheekMat: MeshBasicMaterial;
}

/**
 * The face, drawn flat on the head: dot eyes (squashed to blink), arc eyes for happy, laugh and
 * love, a smile or an open mouth, and cheeks that blush. No textures. Built once per figure; only
 * the parts a feeling uses are visible, so a neutral face draws the same four parts it always did.
 */
export function faceParts(color: number = BRAND.ink): FaceParts {
  const head = new Group();
  head.position.y = HEAD_Y;
  const ink = new MeshBasicMaterial({ color });
  const eyes = new Group();
  const dotGeo = new CircleGeometry(0.024, 8);
  const arcGeo = new RingGeometry(0.015, 0.026, 6, 1, 0, Math.PI);
  const dots: Mesh[] = [];
  const arcs: Mesh[] = [];
  for (const x of [-0.06, 0.06]) {
    const dot = new Mesh(dotGeo, ink);
    onHeadSurface(dot, x, 0.02);
    const arc = new Mesh(arcGeo, ink);
    onHeadSurface(arc, x, 0.012);
    arc.visible = false;
    dots.push(dot);
    arcs.push(arc);
    eyes.add(dot, arc);
  }
  const smile = new Mesh(new RingGeometry(0.016, 0.026, 6, 1, Math.PI, Math.PI), ink);
  onHeadSurface(smile, 0, -0.078);
  const mouth = new Mesh(new CircleGeometry(0.024, 8), ink);
  onHeadSurface(mouth, 0, -0.09);
  smile.visible = false;
  mouth.visible = false;
  const cheekMat = new MeshBasicMaterial({ color: 0xf2a08f, transparent: true, opacity: 0.7 });
  const cheekGeo = new CircleGeometry(0.03, 8);
  const cheeks = [-0.1, 0.1].map((x) => {
    const c = new Mesh(cheekGeo, cheekMat);
    onHeadSurface(c, x, -0.03);
    c.scale.set(1, 0.6, 1);
    return c;
  });
  head.add(eyes, smile, mouth, ...cheeks);
  return { head, eyes, dots, arcs, smile, mouth, cheeks, cheekMat };
}

/** How tall a name tag is, in a figure's own units, and the gap between it and the sign. */
const TAG_SIZE = 0.3;
const SIGN_GAP = 0.03;

/**
 * What floats over figures draws last, in this order, with no depth test: name tags, then
 * feelings' signs, then chat bubbles. Geometry never covers them, and two never fight.
 */
export const OVERHEAD_ORDER = { tag: 5, sign: 6, bubble: 7 } as const;

/** A sprite material for something over a figure: drawn on top of everything, see-through. */
export function overheadMaterial(map: Texture | null = null): SpriteMaterial {
  return new SpriteMaterial({ map, depthTest: false, depthWrite: false, transparent: true });
}

/** Each feeling's floating sign, drawn once from canvas and shared by every figure. */
const icons = new Map<FeelingIcon, CanvasTexture>();
/** The signs drawn so far: shared, so dropping one figure must not free them. */
export const ICON_TEXTURES: ReadonlySet<Texture> = new Set<Texture>();

export function iconTexture(icon: FeelingIcon): CanvasTexture {
  let texture = icons.get(icon);
  if (!texture) {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const g = c.getContext("2d") as CanvasRenderingContext2D;
    g.translate(64, 64);
    drawFeelingIcon(g, icon, 128);
    texture = canvasTexture(c);
    icons.set(icon, texture);
    (ICON_TEXTURES as Set<Texture>).add(texture);
  }
  return texture;
}

interface Rig extends FaceParts {
  body: Group;
  hand: Mesh;
  icon: Sprite;
  iconMat: SpriteMaterial;
  /** The name tag, and who it floats over (a hat or an umbrella held up lifts it). */
  label: Sprite;
  who: Pick<LayoutFigure, "kind" | "look">;
  umbrellaUp: boolean;
  /** The top of the name tag, where the sign sits, and how big the sign is drawn. */
  tagTop: number;
  iconSize: number;
  /** How strongly the tag and sign show: fainter for someone away, asleep at home. */
  shows: number;
  phase: number;
  shown: Shown | undefined;
  /** The feeling the face parts are set for. */
  drawn: Feeling;
  pose: Pose;
}

const rigs = new WeakMap<Object3D, Rig>();

/** The parts that hold still for a feeling: which eyes and mouth, the blush, and the sign. */
function setFace(rig: Rig, feeling: Feeling) {
  rig.drawn = feeling;
  const curved = feeling === "happy" || feeling === "laugh" || feeling === "love";
  for (const a of rig.arcs) a.visible = curved;
  for (const d of rig.dots) d.visible = !curved;
  const wide = feeling === "surprised" ? 1.35 : 1;
  for (const d of rig.dots) d.scale.set(wide, feeling === "sleepy" ? 0.18 : wide, 1);
  rig.eyes.rotation.set(
    feeling === "shy" ? 0.14 : feeling === "thinking" ? -0.12 : 0,
    feeling === "thinking" ? 0.16 : 0,
    0,
  );
  const { smile, mouth } = rig;
  smile.visible =
    feeling === "happy" || feeling === "love" || feeling === "shy" || feeling === "sad";
  smile.rotation.z = feeling === "sad" ? Math.PI : 0;
  smile.scale.setScalar(feeling === "shy" ? 0.65 : 1);
  mouth.visible =
    feeling === "laugh" ||
    feeling === "surprised" ||
    feeling === "sleepy" ||
    feeling === "thinking";
  if (feeling === "laugh") mouth.scale.set(1.15, 0.85, 1);
  else if (feeling === "surprised") mouth.scale.set(0.6, 0.75, 1);
  else if (feeling === "sleepy") mouth.scale.set(0.35, 0.4, 1);
  else mouth.scale.set(0.6, 0.18, 1);
  const blush = feeling === "love" || feeling === "shy";
  for (const c of rig.cheeks) c.scale.set(blush ? 1.5 : 1, blush ? 0.9 : 0.6, 1);
  rig.cheekMat.opacity = blush ? 0.95 : 0.7;
  const icon = FEELING_ICON[feeling];
  rig.icon.visible = icon !== undefined;
  if (icon) {
    const map = iconTexture(icon);
    if (rig.iconMat.map !== map) {
      if (!rig.iconMat.map) rig.iconMat.needsUpdate = true;
      rig.iconMat.map = map;
    }
  }
}

/** The parts that move: blinking eyes, the head's tilt, the waving hand, and the drifting sign. */
function movePose(rig: Rig, p: Pose) {
  if (p.feeling !== rig.drawn) setFace(rig, p.feeling);
  const open = p.feeling === "surprised" ? 1.35 : 1;
  if (p.feeling !== "sleepy") for (const d of rig.dots) d.scale.y = p.blink ? 0.15 : open;
  rig.head.rotation.z = p.tilt;
  rig.hand.visible = p.wave > 0;
  if (p.wave) {
    const lean = p.wave === 1 ? 0.35 : 0.75;
    rig.hand.position.set(0.2 + Math.sin(lean) * 0.2, 0.42 + Math.cos(lean) * 0.2, 0.02);
  }
  rig.icon.position.y = rig.tagTop + SIGN_GAP + rig.iconSize / 2 + p.rise;
  rig.iconMat.opacity = p.fade * rig.shows;
}

/**
 * Show a reaction (or nothing: neutral) on a figure built by `figure()`. Sets the face straight
 * away, so it shows under reduced motion too, where nothing animates. True when it changed, so the
 * caller draws a frame.
 */
export function showFeeling(fig: Object3D, shown: Shown | undefined, now: number): boolean {
  const rig = rigs.get(fig);
  if (!rig || rig.shown === shown) return false;
  rig.shown = shown;
  movePose(rig, pose(shown, now, rig.phase, true, rig.pose));
  return true;
}

/**
 * Draw a figure's sign `size` units across (in the figure's own units), so it stays readable as the
 * camera pulls back (`signSize` in `layout.ts`). Only changes a scale, so it's cheap to call often.
 */
export function sizeSign(fig: Object3D, size: number) {
  const rig = rigs.get(fig);
  if (!rig || rig.iconSize === size) return;
  rig.iconSize = size;
  rig.icon.scale.setScalar(size);
  movePose(rig, rig.pose);
}

/** How high over a figure's feet (in its own units) the name tag, and the sign when shown, reach. */
export function overheadTop(fig: Object3D): number {
  const rig = rigs.get(fig);
  if (!rig) return 0;
  return rig.icon.visible ? rig.icon.position.y + rig.iconSize / 2 : rig.tagTop;
}

/** Turn a figure's head `yaw` radians from where its body faces, to look at someone. */
export function turnHead(fig: Object3D, yaw: number) {
  const rig = rigs.get(fig);
  if (rig) rig.head.rotation.y = yaw;
}

/**
 * Put a figure's umbrella up over its head (in the rain) or roll it up at its side, and float the
 * name tag over whichever it is (decision 0073). True when it changed, so the caller draws a frame.
 */
export function setUmbrella(fig: Object3D, up: boolean): boolean {
  const rig = rigs.get(fig);
  if (!rig || rig.umbrellaUp === up) return false;
  rig.umbrellaUp = up;
  fig.traverse((o) => {
    const part = o.userData.umbrella as "open" | "furled" | undefined;
    if (part) o.visible = (part === "open") === up;
  });
  rig.label.position.y = tagHeight(rig.who, up);
  rig.tagTop = rig.label.position.y + TAG_SIZE / 2;
  movePose(rig, rig.pose);
  return true;
}

/** How strongly someone away shows: their peg fades toward the haze, their tag fainter. */
const AWAY_FADE = 0.38;
const AWAY_SHOWS = 0.72;

/**
 * A soft peg figure: a body in their color and shape, a round head with a nose and a face that
 * shows feelings, and their wear. It faces +z. `f.feeling` is one to hold (sleepy at the hearth);
 * reactions come and go through `showFeeling`.
 */
export function figure(stage: Stage, f: LayoutFigure, shadowMap: Texture): Group {
  const group = new Group();
  group.name = "figure";
  const body = new Group();
  // Like the map's figure: clothes in the outfit's main color, the head in their own.
  const bodyMat = new MeshLambertMaterial({
    color: lookPalette(f.look.theme, f.color).main,
    vertexColors: true,
  });
  let bodyGeo: BufferGeometry;
  if (f.shape === "square") bodyGeo = new RoundedBoxGeometry(0.42, 0.46, 0.36, 3, 0.1);
  else if (f.shape === "diamond") {
    bodyGeo = new OctahedronGeometry(0.28, 0);
    bodyGeo.scale(0.95, 0.95, 0.8);
  } else {
    bodyGeo = new SphereGeometry(0.24, 18, 12);
    bodyGeo.scale(1, 1.1, 0.92);
  }
  bodyGeo.translate(0, 0.28, 0);
  const torso = new Mesh(bakeShade(bodyGeo, 0.7, 1.05), bodyMat);
  // Under a ghost sheet (RFC 0022) the sheet is the body, and the head and the waving mitten are
  // the sheet too, its face showing through as on the map.
  const ghost = f.look.wear?.includes("ghost_sheet") ?? false;
  torso.visible = !ghost;
  const skin = new MeshLambertMaterial({
    color: ghost ? garmentColor(f.look, "ghost_sheet") : residentHex(f.color),
  });
  // A small nose, part of the head's mesh, so you can tell which way they face from above.
  const nose = new SphereGeometry(0.036, 10, 8).translate(0, -0.025, 0.16);
  const skull = new Mesh(mergeGeometries([new SphereGeometry(HEAD_R, 18, 12), nose]), skin);
  // Light eyes and mouth on a coal head, as on the map.
  const face = faceParts(f.color === "coal" && !ghost ? BRAND.paper : BRAND.ink);
  face.head.add(skull);
  // A mitten that comes up to wave.
  const hand = new Mesh(new IcosahedronGeometry(0.05, 0), skin);
  hand.visible = false;
  body.add(torso, face.head, hand);
  if (f.kind === "agent") {
    // Agents wear a little sprout antenna with a sun bulb (the 2D map marks them with a gear).
    const stalk = new Mesh(
      new CylinderGeometry(0.012, 0.012, 0.16, 5),
      new MeshLambertMaterial({ color: BRAND.moss }),
    );
    stalk.position.y = 0.88 - HEAD_Y;
    const bulb = new Mesh(
      new SphereGeometry(0.04, 10, 8),
      new MeshLambertMaterial({ color: BRAND.sun, emissive: BRAND.sun, emissiveIntensity: 0.4 }),
    );
    bulb.position.y = 0.97 - HEAD_Y;
    face.head.add(stalk, bulb);
  }
  // Hair sits on the head and turns with it; a hat that covers the crown hides the top of it.
  const hair = hairMesh(f.look, f.look.wear);
  if (hair) face.head.add(hair);
  const wear = wearGroup(f);
  // Hats, glasses and bows turn with the head.
  for (const piece of wear.children.filter((o) => o.userData.onHead)) {
    piece.position.y -= HEAD_Y;
    face.head.add(piece);
  }
  body.add(wear);
  // The flat face parts are too thin to cast a shadow.
  body.traverse((o) => {
    if (o instanceof Mesh && !(o.material instanceof MeshBasicMaterial)) o.castShadow = true;
  });
  group.add(blobShadow(shadowMap, 0.3), body);

  // The name tag and the sign over it draw over everything, so a chimney or a wall never hides
  // them, the sign after the tag so the two never fight.
  const tag = nameTag(f.name, f.owner);
  const label = new Sprite(overheadMaterial(tag.texture));
  label.scale.set(TAG_SIZE * tag.aspect, TAG_SIZE, 1);
  // An umbrella starts rolled up; `setUmbrella` puts it up in the rain.
  label.position.y = tagHeight(f);
  label.renderOrder = OVERHEAD_ORDER.tag;
  group.add(label);
  if (f.away) {
    // Away and asleep at home: faded toward the haze, so they read as not quite here.
    const haze = lin(SKY.fog);
    body.traverse((o) => {
      if (o instanceof Mesh && o.material instanceof MeshLambertMaterial)
        o.material.color.lerp(haze, AWAY_FADE);
    });
    label.material.opacity = AWAY_SHOWS;
  }

  // The feeling's sign floats over the name tag. Its texture is set when a feeling needs one.
  const iconMat = overheadMaterial();
  const icon = new Sprite(iconMat);
  icon.scale.setScalar(SIGN_SIZE);
  icon.renderOrder = OVERHEAD_ORDER.sign;
  icon.visible = false;
  const tagTop = tagHeight(f) + TAG_SIZE / 2;
  icon.position.y = tagTop + SIGN_GAP + SIGN_SIZE / 2;
  group.add(icon);

  group.scale.setScalar(FIGURE_SCALE);
  // The world view leans the body as it steps.
  group.userData.body = body;
  const phase = (tileHash(f.x * 7, f.y * 13) % 1000) / 160;
  const rig: Rig = {
    ...face,
    body,
    hand,
    icon,
    iconMat,
    label,
    who: { kind: f.kind, look: f.look },
    umbrellaUp: false,
    tagTop,
    iconSize: SIGN_SIZE,
    shows: f.away ? AWAY_SHOWS : 1,
    phase: idPhase(f.id),
    shown: undefined,
    drawn: "neutral",
    pose: restingPose(),
  };
  rigs.set(group, rig);
  if (f.feeling)
    showFeeling(group, { feeling: f.feeling, at: 0, until: Number.POSITIVE_INFINITY }, 0);
  stage.animate(({ time }) => {
    const breathe = Math.sin(time * 2 + phase);
    const p = pose(rig.shown, performance.now(), rig.phase, false, rig.pose);
    body.position.y = Math.max(0, breathe) * 0.025 + p.lift;
    body.scale.set(1 + breathe * 0.012, 1 - breathe * 0.012, 1 + breathe * 0.012);
    body.rotation.z = Math.sin(time * 0.9 + phase) * 0.04;
    movePose(rig, p);
  });
  return group;
}
