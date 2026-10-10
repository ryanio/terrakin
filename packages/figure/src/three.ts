/**
 * The part of the package that draws: a rigged `.glb` becomes a `Body` that plays clips, shows
 * feelings, blinks, and looks around. It needs three.js; the package's main entry doesn't.
 */
import {
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  Box3,
  Euler,
  Group,
  LoadingManager,
  LoopOnce,
  LoopRepeat,
  type Material,
  Mesh,
  type Object3D,
  Quaternion,
  Texture,
  Vector3,
} from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { type BodyCaps, type BodyReport, checkBody } from "./check.js";
import { clipFor, FEELING_LOOKS, faceFor } from "./feel.js";
import type { Feeling } from "./feelings.js";
import { glbJson } from "./glb.js";
import { blinkAt, breathAt, idPhase } from "./rest.js";
import { SOCKETS, type SocketName } from "./spec.js";

/** How a clip is played. */
export interface PlayOptions {
  /** False plays it through once, then goes back to what was playing. Default true. */
  loop?: boolean;
  /** Seconds to blend from the clip before it. Default 0.25. */
  fade?: number;
  /** How fast it plays. Default 1. */
  rate?: number;
}

/** A character in a scene. A scene holds one and never asks what kind it is. */
export interface Body {
  /** Add this to the scene, and move and turn it to place the body. It faces its own +z. */
  readonly object: Object3D;
  /** How tall it stands, in the scene's units. */
  readonly height: number;
  /** The clips it has. `play` takes others too and falls back. */
  readonly clips: readonly string[];
  /** How fast its walk covers ground at rate 1, in the scene's units a second, when it says. */
  readonly walkSpeed: number | undefined;
  /** True holds it still between clips: no blink, no breath, no bob. For reduced motion. */
  still: boolean;
  /** Where something it wears or holds attaches, when it has that socket. */
  socket(name: SocketName): Object3D | undefined;
  /**
   * Play a clip. A looping clip stays until another is asked for, and asking for the same one
   * again changes nothing, so this can be called every frame.
   */
  play(clip: string, options?: PlayOptions): void;
  /** Show a feeling on its face and in its clip, until another is shown. */
  feel(feeling: Feeling): void;
  /** Turn its head toward a point in the scene, or back to rest with `undefined`. */
  lookAt(point: Vector3 | undefined): void;
  /** Move it on by `seconds`. Call once a frame. */
  update(seconds: number): void;
  /** Free everything it holds and take it out of the scene. */
  dispose(): void;
}

/** What `loadBody` needs to know. */
export interface LoadBodyOptions {
  /** How tall the body stands in the scene, in the scene's units. */
  height: number;
  /** Whose body it is. It sets when this one blinks and breathes, so a crowd doesn't in step. */
  id?: string;
  /** Limits the file must fit. */
  caps?: BodyCaps;
  /** The most bytes the file may have. Default `MAX_BODY_BYTES`. */
  maxBytes?: number;
  /** A KTX2 loader, set up with its transcoder and a renderer, for a body with KTX2 textures. */
  ktx2?: KTX2Loader;
}

/** The largest file `loadBody` reads unless told otherwise. */
export const MAX_BODY_BYTES = 16 * 1024 * 1024;

/** A file that isn't a body. `problems` says why, in this package's own words. */
export class BodyError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`not a body: ${problems.join(", ")}`);
    this.name = "BodyError";
    this.problems = problems;
  }
}

async function bytesOf(source: Uint8Array | ArrayBuffer | string, max: number) {
  let bytes: Uint8Array;
  if (typeof source === "string") {
    const response = await fetch(source);
    if (!response.ok) throw new BodyError(["the file couldn't be fetched"]);
    if (Number(response.headers.get("content-length")) > max) {
      throw new BodyError(["a larger file than allowed"]);
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  }
  if (bytes.byteLength > max) throw new BodyError(["a larger file than allowed"]);
  return bytes;
}

/**
 * Load a rigged body from a `.glb`, given as its bytes or a URL. The file is outside data: it is
 * checked against the body spec and `caps` before anything is drawn, nothing it points at outside
 * itself is fetched, and a file that fails throws a `BodyError`.
 */
export async function loadBody(
  source: Uint8Array | ArrayBuffer | string,
  options: LoadBodyOptions,
): Promise<Body> {
  if (!(options.height > 0)) throw new RangeError("a body needs a height above 0");
  const bytes = await bytesOf(source, options.maxBytes ?? MAX_BODY_BYTES);
  let report: BodyReport;
  try {
    report = checkBody(glbJson(bytes), options.caps);
  } catch (err) {
    throw new BodyError([err instanceof Error ? err.message : "not a .glb"]);
  }
  if (!report.ok) throw new BodyError(report.problems);

  // The check already refused a file that points outside itself. This is the second lock: only
  // inline data and the loader's own blobs may load.
  const manager = new LoadingManager();
  manager.setURLModifier((url) =>
    url.startsWith("blob:") || url.startsWith("data:") ? url : "data:,",
  );
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  if (options.ktx2) loader.setKTX2Loader(options.ktx2);
  const buffer = new Uint8Array(bytes).buffer;
  const gltf = await loader.parseAsync(buffer, "").catch(() => {
    // A loader's own message can quote the file, so it is never passed on.
    throw new BodyError(["a loader couldn't read it"]);
  });
  return new RiggedBody(gltf.scene, gltf.animations, report, options);
}

const FADE = 0.25;
/** How long a hop made in code takes, in seconds. */
const HOP_SECONDS = 0.48;
/** How far a head turns to look, in radians: about 35 degrees to a side and 20 up or down. */
const MAX_YAW = 0.61;
const MAX_PITCH = 0.35;
/** How far a breath nods the head, in radians. */
const NOD = 0.02;

const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));
/** How much of the way to a target a value moves in `seconds`, at `speed`. */
const ease = (seconds: number, speed: number) => 1 - Math.exp(-seconds * speed);

const point = new Vector3();
const from = new Vector3();
const parentTurn = new Quaternion();
const bodyTurn = new Quaternion();
const turn = new Quaternion();
const euler = new Euler();

class RiggedBody implements Body {
  readonly object = new Group();
  readonly height: number;
  readonly clips: readonly string[];
  readonly walkSpeed: number | undefined;
  still = false;

  /** Between `object` and the model: where a bob or a hop made in code moves it. */
  private readonly pose = new Group();
  private readonly model: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly actions = new Map<string, AnimationAction>();
  private readonly sockets = new Map<SocketName, Object3D>();
  private readonly faces: Mesh[] = [];
  private readonly keys = new Set<string>();
  private readonly weights = new Map<string, number>();
  private readonly head: Object3D | undefined;
  private readonly headClean = new Quaternion();
  private headTurned = false;
  private readonly phase: number;

  private time = 0;
  /** The looping clip the scene asked for. */
  private asked = { clip: "idle", rate: 1 };
  /** A clip playing through once, and when it ends. */
  private once: string | undefined;
  private onceEnds = 0;
  /** A clip the feeling holds in place of the one asked for. */
  private held: string | undefined;
  private feeling: Feeling = "neutral";
  private face: Readonly<Record<string, number>> = {};
  private current: AnimationAction | undefined;
  private currentOnce = false;
  private made: "bob" | "squash" | undefined;
  private madeAt = 0;
  private target: Vector3 | undefined;
  private yaw = 0;
  private pitch = 0;

  constructor(
    model: Object3D,
    animations: readonly AnimationClip[],
    report: BodyReport,
    options: LoadBodyOptions,
  ) {
    const box = new Box3().setFromObject(model);
    const tall = box.max.y - box.min.y;
    if (!(tall > 0) || !Number.isFinite(tall)) throw new BodyError(["no shape to measure"]);
    const scale = options.height / tall;
    model.scale.multiplyScalar(scale);
    this.model = model;
    this.pose.add(model);
    this.object.add(this.pose);
    this.height = options.height;
    this.walkSpeed = report.walkSpeed === undefined ? undefined : report.walkSpeed * scale;
    this.phase = idPhase(options.id ?? "");

    this.mixer = new AnimationMixer(model);
    for (const clip of animations) {
      if (report.clips.includes(clip.name) && !this.actions.has(clip.name)) {
        this.actions.set(clip.name, this.mixer.clipAction(clip));
      }
    }
    this.clips = [...this.actions.keys()];
    if (!this.actions.has("idle")) throw new BodyError(["no idle clip"]);

    for (const name of SOCKETS) {
      const socket = model.getObjectByName(name);
      if (socket) this.sockets.set(name, socket);
    }
    this.head = model.getObjectByName("Head");
    if (this.head) this.headClean.copy(this.head.quaternion);
    model.traverse((part) => {
      if (!(part instanceof Mesh) || !part.morphTargetDictionary) return;
      this.faces.push(part);
      for (const key of Object.keys(part.morphTargetDictionary)) this.keys.add(key);
    });
    this.apply(0);
  }

  socket(name: SocketName): Object3D | undefined {
    return this.sockets.get(name);
  }

  play(clip: string, options: PlayOptions = {}): void {
    const fade = options.fade ?? FADE;
    if (options.loop === false) {
      this.playOnce(clip, fade);
      return;
    }
    const rate = options.rate ?? 1;
    if (clip === this.asked.clip && rate === this.asked.rate) return;
    this.asked = { clip, rate };
    this.apply(fade);
  }

  feel(feeling: Feeling): void {
    this.feeling = feeling;
    this.face = faceFor(feeling, (key) => this.keys.has(key));
    const look = FEELING_LOOKS[feeling];
    this.held = look.hold !== undefined && this.actions.has(look.hold) ? look.hold : undefined;
    if (look.once === undefined) this.apply(FADE);
    else this.playOnce(look.once, FADE);
  }

  lookAt(target: Vector3 | undefined): void {
    this.target = target?.clone();
  }

  update(seconds: number): void {
    this.time += seconds;
    if (this.once !== undefined && this.time >= this.onceEnds) {
      this.once = undefined;
      this.apply(FADE);
    }
    // The mixer writes a bone only when its value changes, so last frame's look is taken off
    // first. Otherwise a head a clip holds still would keep turning.
    if (this.head && this.headTurned) this.head.quaternion.copy(this.headClean);
    this.mixer.update(seconds);
    if (this.head) this.headClean.copy(this.head.quaternion);
    this.showFace(seconds);
    this.moveInCode();
    this.turnHead(seconds);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.model.traverse((part) => {
      if (!(part instanceof Mesh)) return;
      part.geometry.dispose();
      const materials: Material[] = Array.isArray(part.material) ? part.material : [part.material];
      for (const material of materials) {
        for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
        material.dispose();
      }
    });
    this.object.removeFromParent();
  }

  private playOnce(clip: string, fade: number) {
    const choice = clipFor(clip, (name) => this.actions.has(name));
    const length =
      choice.made === "squash"
        ? HOP_SECONDS
        : (this.actions.get(choice.clip)?.getClip().duration ?? 0);
    this.once = clip;
    this.onceEnds = this.time + length;
    this.apply(fade, true);
  }

  /**
   * Play whatever should be playing now: a clip going through once, a held one, or the one asked
   * for. `restart` starts it from its first frame even when it is already playing.
   */
  private apply(fade: number, restart = false) {
    const name = this.once ?? this.held ?? this.asked.clip;
    const choice = clipFor(name, (clip) => this.actions.has(clip));
    const action = this.actions.get(choice.clip);
    if (!action) return;
    const once = this.once !== undefined && choice.made === undefined;
    if (choice.made !== this.made || restart) this.madeAt = this.time;
    this.made = choice.made;
    const before = this.current;
    if (action !== before || once !== this.currentOnce || (restart && once)) {
      action.reset();
      action.setLoop(once ? LoopOnce : LoopRepeat, Number.POSITIVE_INFINITY);
      action.clampWhenFinished = once;
      if (before && before !== action && fade > 0) action.crossFadeFrom(before, fade, false);
      else if (before !== action) before?.stop();
      action.play();
      this.current = action;
      this.currentOnce = once;
    }
    const resting = choice.clip === "idle" && choice.made === undefined;
    const rate = this.once === undefined && this.held === undefined ? this.asked.rate : 1;
    action.setEffectiveTimeScale(rate * (resting ? FEELING_LOOKS[this.feeling].rate : 1));
  }

  private showFace(seconds: number) {
    const k = ease(seconds, 14);
    for (const key of this.keys) {
      const was = this.weights.get(key) ?? 0;
      const now = was + ((this.face[key] ?? 0) - was) * k;
      this.weights.set(key, now);
      const shown =
        key === "blink" && !this.still ? Math.max(now, blinkAt(this.time, this.phase)) : now;
      for (const face of this.faces) {
        const index = face.morphTargetDictionary?.[key];
        if (index !== undefined && face.morphTargetInfluences) {
          face.morphTargetInfluences[index] = shown;
        }
      }
    }
  }

  private moveInCode() {
    let lift = 0;
    let stretch = 0;
    if (!this.still && this.made === "bob") {
      lift = Math.abs(Math.sin((this.time - this.madeAt) * Math.PI * 2 * this.asked.rate)) * 0.04;
    } else if (!this.still && this.made === "squash") {
      const k = (this.time - this.madeAt) / HOP_SECONDS;
      if (k > 0 && k < 1) {
        lift = 4 * 0.3 * k * (1 - k);
        stretch = Math.sin(k * Math.PI * 2) * 0.12;
      }
    }
    this.pose.position.y = lift * this.height;
    this.pose.scale.set(1 - stretch * 0.5, 1 + stretch, 1 - stretch * 0.5);
  }

  private turnHead(seconds: number) {
    const head = this.head;
    if (!head?.parent) return;
    let yaw = 0;
    let pitch = 0;
    if (this.target) {
      this.object.worldToLocal(head.getWorldPosition(from));
      this.object.worldToLocal(point.copy(this.target)).sub(from);
      yaw = clamp(Math.atan2(point.x, point.z), MAX_YAW);
      pitch = clamp(-Math.atan2(point.y, Math.hypot(point.x, point.z)), MAX_PITCH);
    }
    const k = ease(seconds, 8);
    this.yaw += (yaw - this.yaw) * k;
    this.pitch += (pitch - this.pitch) * k;
    const nod = this.still ? 0 : breathAt(this.time, this.phase) * NOD;
    this.headTurned = Math.abs(this.yaw) + Math.abs(this.pitch) + Math.abs(nod) > 1e-5;
    if (!this.headTurned) return;
    // The turn is about the body's own up and side, whatever way the head bone's axes point.
    head.parent.getWorldQuaternion(parentTurn);
    this.object.getWorldQuaternion(bodyTurn);
    turn.setFromEuler(euler.set(this.pitch + nod, this.yaw, 0, "YXZ"));
    turn.premultiply(bodyTurn).multiply(bodyTurn.invert());
    turn.multiply(parentTurn).premultiply(parentTurn.invert());
    head.quaternion.premultiply(turn);
  }
}
