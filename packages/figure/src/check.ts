import {
  BONES,
  type BoneName,
  EXTENSIONS,
  REQUIRED_BONES,
  REQUIRED_CLIPS,
  SOCKETS,
  type SocketName,
} from "./spec.js";

/** Limits a caller puts on a body. A limit left out isn't checked. */
export interface BodyCaps {
  triangles?: number;
  materials?: number;
  textures?: number;
  joints?: number;
}

/** What `checkBody` found. */
export interface BodyReport {
  /** True when nothing in `problems` keeps a loader from drawing this body. */
  ok: boolean;
  /** Why this file isn't a body, in this package's own words. */
  problems: string[];
  /** What the body lacks that a loader falls back from. */
  notes: string[];
  /** The clips in the file, by name. */
  clips: string[];
  /** The shared bones the skeleton has. */
  bones: BoneName[];
  /** The sockets the file has. */
  sockets: SocketName[];
  /** The face's morph targets, by name. */
  expressions: string[];
  triangles: number;
  materials: number;
  textures: number;
  /** The joints in its largest skin. */
  joints: number;
}

type Json = Record<string, unknown>;

const record = (value: unknown): Json | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;

const records = (value: unknown): Json[] =>
  Array.isArray(value) ? value.map(record).filter((item) => item !== undefined) : [];

/**
 * A name from the file that is safe to hand back: a short word of letters, digits, and
 * underscores. Anything else in a name slot is dropped, so a report never carries a file's text.
 */
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const names = (values: unknown[]): string[] => [
  ...new Set(values.filter((v): v is string => typeof v === "string" && NAME.test(v))),
];

const count = (accessors: Json[], index: unknown): number => {
  const accessor = typeof index === "number" ? accessors[index] : undefined;
  const n = accessor?.count;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
};

const TRIANGLES = 4;

function triangles(gltf: Json): number {
  const accessors = records(gltf.accessors);
  let total = 0;
  for (const mesh of records(gltf.meshes)) {
    for (const primitive of records(mesh.primitives)) {
      if (primitive.mode !== undefined && primitive.mode !== TRIANGLES) continue;
      const corners =
        primitive.indices === undefined
          ? count(accessors, record(primitive.attributes)?.POSITION)
          : count(accessors, primitive.indices);
      total += Math.floor(corners / 3);
    }
  }
  return total;
}

const outside = (item: Json): boolean =>
  typeof item.uri === "string" && !item.uri.startsWith("data:");

/**
 * Check a parsed glTF document against the body spec (`spec.ts`) and a caller's limits. The
 * document is outside data: nothing in it is trusted to have the right shape, and no text from it
 * reaches the report except names made only of letters, digits, and underscores.
 *
 * It reads the JSON alone, so it can't tell which way the body faces, how tall it is, or whether
 * its feet are on the ground.
 */
export function checkBody(document: unknown, caps: BodyCaps = {}): BodyReport {
  const gltf = record(document) ?? {};
  const problems: string[] = [];
  const notes: string[] = [];

  if (record(gltf.asset)?.version !== "2.0") problems.push("not a glTF 2.0 document");
  if ([...records(gltf.buffers), ...records(gltf.images)].some(outside)) {
    problems.push("points at a file outside itself");
  }
  const allowed: readonly string[] = EXTENSIONS;
  const required = Array.isArray(gltf.extensionsRequired) ? gltf.extensionsRequired : [];
  if (required.some((name) => typeof name !== "string" || !allowed.includes(name))) {
    problems.push("requires an extension a loader doesn't have");
  }

  const nodes = records(gltf.nodes);
  const skins = records(gltf.skins);
  const jointNames = new Set<unknown>();
  let joints = 0;
  for (const skin of skins) {
    const list = Array.isArray(skin.joints) ? skin.joints : [];
    joints = Math.max(joints, list.length);
    for (const index of list) {
      if (typeof index === "number") jointNames.add(nodes[index]?.name);
    }
  }
  if (skins.length === 0) problems.push("no skeleton");
  const bones = BONES.filter((bone) => jointNames.has(bone));
  for (const bone of REQUIRED_BONES) {
    if (skins.length > 0 && !jointNames.has(bone)) problems.push(`no ${bone} bone`);
  }

  const clips = names(records(gltf.animations).map((animation) => animation.name));
  for (const clip of REQUIRED_CLIPS) {
    if (!clips.includes(clip)) problems.push(`no ${clip} clip`);
  }
  if (!clips.includes("walk")) notes.push("no walk clip");

  const nodeNames = new Set(nodes.map((node) => node.name));
  const sockets = SOCKETS.filter((socket) => nodeNames.has(socket));
  for (const socket of SOCKETS) {
    if (!nodeNames.has(socket)) notes.push(`no ${socket}`);
  }

  const expressions = names(
    records(gltf.meshes).flatMap((mesh) => {
      const targets = record(mesh.extras)?.targetNames;
      return Array.isArray(targets) ? targets : [];
    }),
  );
  if (expressions.length === 0) notes.push("no face that moves");

  const found = {
    triangles: triangles(gltf),
    materials: records(gltf.materials).length,
    textures: records(gltf.images).length,
    joints,
  };
  for (const key of ["triangles", "materials", "textures", "joints"] as const) {
    const cap = caps[key];
    if (cap !== undefined && found[key] > cap) problems.push(`more than ${cap} ${key}`);
  }

  return {
    ok: problems.length === 0,
    problems,
    notes,
    clips,
    bones,
    sockets,
    expressions,
    ...found,
  };
}
