/**
 * A plain plush for the demo, built in code and written out as a `.glb` that follows the body
 * spec: a skeleton, sockets, a face with morph targets, and five clips. It is nobody's character.
 */
import {
  AnimationClip,
  Bone,
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Uint16BufferAttribute,
  VectorKeyframeTrack,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** How fast its walk covers ground, in meters a second at its own size. */
const WALK_SPEED = 0.13;

const FUR = new Color(0xe8d3a8);
const PAW = new Color(0xc9a878);
const INK = new Color(0x3a2a20);

interface BoneSpec {
  name: string;
  parent: string | undefined;
  at: [number, number, number];
}

/** Where each bone sits in the body, in meters. It faces +z, so its left is +x. */
const BONES: BoneSpec[] = [
  { name: "Hips", parent: undefined, at: [0, 0.09, 0] },
  { name: "Spine", parent: "Hips", at: [0, 0.14, 0] },
  { name: "Head", parent: "Spine", at: [0, 0.19, 0] },
  { name: "LeftArm", parent: "Spine", at: [0.068, 0.165, 0] },
  { name: "RightArm", parent: "Spine", at: [-0.068, 0.165, 0] },
  { name: "LeftUpLeg", parent: "Hips", at: [0.036, 0.07, 0] },
  { name: "RightUpLeg", parent: "Hips", at: [-0.036, 0.07, 0] },
];

const SOCKETS: [string, string, [number, number, number]][] = [
  ["socket_head", "Head", [0, 0.3, 0]],
  ["socket_halo", "Head", [0, 0.34, 0]],
  ["socket_face", "Head", [0, 0.235, 0.07]],
  ["socket_neck", "Spine", [0, 0.185, 0]],
  ["socket_back", "Spine", [0, 0.14, -0.07]],
  ["socket_hand_l", "LeftArm", [0.085, 0.1, 0]],
  ["socket_hand_r", "RightArm", [-0.085, 0.1, 0]],
  ["socket_feet", "Hips", [0, 0, 0]],
];

/** One rigid part of the body: a shape, where it sits, the bone that carries it, and its color. */
function part(shape: BufferGeometry, at: [number, number, number], bone: number, color: Color) {
  const geometry = shape.toNonIndexed();
  geometry.translate(...at);
  const count = geometry.getAttribute("position").count;
  const index = new Uint16Array(count * 4);
  const weight = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    index[i * 4] = bone;
    weight[i * 4] = 1;
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(index, 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weight, 4));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.deleteAttribute("uv");
  return geometry;
}

const ball = (radius: number, sx = 1, sy = 1, sz = 1) =>
  new SphereGeometry(radius, 20, 14).scale(sx, sy, sz);

/** The face: two eyes and a mouth, in the head bone's own space, with a morph target per look. */
function face() {
  const headY = 0.19;
  const eyeY = 0.24 - headY;
  const mouthY = 0.213 - headY;
  const eye = (x: number) => ball(0.0095).translate(x, eyeY, 0.063);
  const mouth = ball(1, 0.017, 0.003, 0.004).translate(0, mouthY, 0.07);
  const parts = [eye(0.026), eye(-0.026), mouth].map((g) => {
    const flat = g.toNonIndexed();
    flat.deleteAttribute("uv");
    return flat;
  });
  const eyeCount = (parts[0]?.getAttribute("position").count ?? 0) * 2;
  const geometry = mergeGeometries(parts);
  const rest = geometry.getAttribute("position");

  /** A morph target: every vertex moved by `move`, which is told whether it is part of an eye. */
  const target = (
    move: (x: number, y: number, z: number, eye: boolean) => [number, number, number],
  ) => {
    const out = new Float32Array(rest.count * 3);
    for (let i = 0; i < rest.count; i++) {
      out.set(move(rest.getX(i), rest.getY(i), rest.getZ(i), i < eyeCount), i * 3);
    }
    return new Float32BufferAttribute(out, 3);
  };
  const squashEyes = (k: number, lift = 0) =>
    target((x, y, z, isEye) => (isEye ? [x, eyeY + (y - eyeY) * k + lift, z] : [x, y, z]));
  const bend = (by: number) =>
    target((x, y, z, isEye) => (isEye ? [x, y, z] : [x, y + (x / 0.017) ** 2 * by, z]));

  const targets = {
    blink: squashEyes(0.1),
    happy: squashEyes(0.5, 0.003),
    smile: bend(0.008),
    surprise: target((x, y, z, isEye) => {
      if (!isEye) return [x * 0.45, mouthY + (y - mouthY) * 4.5, z];
      const cx = x > 0 ? 0.026 : -0.026;
      return [cx + (x - cx) * 1.35, eyeY + (y - eyeY) * 1.35, z + 0.002];
    }),
    sad: bend(-0.007),
    shy: target((x, y, z, isEye) => (isEye ? [x, y - 0.005, z] : [x * 0.7, y, z])),
    sleepy: squashEyes(0.3, -0.002),
  };
  geometry.morphAttributes.position = Object.values(targets);
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: INK, roughness: 0.4 }));
  mesh.name = "face";
  mesh.morphTargetDictionary = Object.fromEntries(Object.keys(targets).map((key, i) => [key, i]));
  mesh.morphTargetInfluences = Object.keys(targets).map(() => 0);
  return mesh;
}

const turn = (x: number, y: number, z: number) =>
  new Quaternion().setFromEuler(new Euler(x, y, z)).toArray();

/** A track that turns a bone through `turns` at `times`. */
const turning = (bone: string, times: number[], turns: number[][]) =>
  new QuaternionKeyframeTrack(`${bone}.quaternion`, times, turns.flat());

function clips(): AnimationClip[] {
  const hips = (times: number[], heights: number[]) =>
    new VectorKeyframeTrack(
      "Hips.position",
      times,
      heights.flatMap((y) => [0, y, 0]),
    );
  const rest = turn(0, 0, 0);
  const idle = new AnimationClip("idle", 4, [
    turning(
      "Head",
      [0, 1, 2, 3, 4],
      [
        turn(0.03, 0, 0),
        turn(0, 0.06, 0.03),
        turn(-0.02, 0, 0),
        turn(0, -0.06, -0.03),
        turn(0.03, 0, 0),
      ],
    ),
    turning("Spine", [0, 2, 4], [turn(0, 0, 0.012), turn(0, 0, -0.012), turn(0, 0, 0.012)]),
    turning("LeftArm", [0, 2, 4], [turn(0, 0, 0.05), turn(0, 0, 0.11), turn(0, 0, 0.05)]),
    turning("RightArm", [0, 2, 4], [turn(0, 0, -0.05), turn(0, 0, -0.11), turn(0, 0, -0.05)]),
  ]);
  const step = [0, 0.25, 0.5, 0.75, 1];
  const swing = (a: number) => [turn(a, 0, 0), rest, turn(-a, 0, 0), rest, turn(a, 0, 0)];
  const walk = new AnimationClip("walk", 1, [
    turning("LeftUpLeg", step, swing(0.55)),
    turning("RightUpLeg", step, swing(-0.55)),
    turning("LeftArm", step, swing(-0.4)),
    turning("RightArm", step, swing(0.4)),
    turning("Head", step, [turn(0, 0, 0.03), rest, turn(0, 0, -0.03), rest, turn(0, 0, 0.03)]),
    hips(step, [0.09, 0.096, 0.09, 0.096, 0.09]),
  ]);
  const wave = new AnimationClip("wave", 2, [
    turning(
      "RightArm",
      [0, 0.4, 0.7, 1, 1.3, 1.6, 2],
      [
        rest,
        turn(0, 0, -2.3),
        turn(0, 0, -2.75),
        turn(0, 0, -2.3),
        turn(0, 0, -2.75),
        turn(0, 0, -2.3),
        rest,
      ],
    ),
    turning("Head", [0, 0.4, 1.6, 2], [rest, turn(0, 0, -0.08), turn(0, 0, -0.08), rest]),
  ]);
  const hop = new AnimationClip("hop", 0.6, [
    hips([0, 0.12, 0.32, 0.5, 0.6], [0.09, 0.078, 0.17, 0.082, 0.09]),
    turning("LeftUpLeg", [0, 0.12, 0.32, 0.6], [rest, turn(-0.5, 0, 0), turn(0.3, 0, 0), rest]),
    turning("RightUpLeg", [0, 0.12, 0.32, 0.6], [rest, turn(-0.5, 0, 0), turn(0.3, 0, 0), rest]),
    turning("LeftArm", [0, 0.32, 0.6], [rest, turn(0, 0, 0.9), rest]),
    turning("RightArm", [0, 0.32, 0.6], [rest, turn(0, 0, -0.9), rest]),
  ]);
  const sleep = new AnimationClip("sleep", 4, [
    turning("Head", [0, 2, 4], [turn(0.4, 0, 0.1), turn(0.44, 0, 0.1), turn(0.4, 0, 0.1)]),
    turning("Spine", [0, 2, 4], [turn(0.08, 0, 0), turn(0.1, 0, 0), turn(0.08, 0, 0)]),
  ]);
  return [idle, walk, wave, hop, sleep];
}

/** Write `walk_speed_m_s` into a `.glb`'s `asset.extras`, where the exporter has no way to put it. */
function withWalkSpeed(glb: Uint8Array, speed: number): Uint8Array {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const length = view.getUint32(12, true);
  const document = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)));
  document.asset.extras = { ...document.asset.extras, walk_speed_m_s: speed };
  const text = new TextEncoder().encode(JSON.stringify(document));
  const json = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
  json.set(text);
  const rest = glb.subarray(20 + length);
  const out = new Uint8Array(20 + json.length + rest.length);
  out.set(glb.subarray(0, 20));
  out.set(json, 20);
  out.set(rest, 20 + json.length);
  const header = new DataView(out.buffer);
  header.setUint32(8, out.length, true);
  header.setUint32(12, json.length, true);
  return out;
}

/** The plain plush as the bytes of a `.glb`. */
export async function plainPlush(): Promise<Uint8Array> {
  const bones = new Map<string, Bone>();
  for (const spec of BONES) {
    const bone = new Bone();
    bone.name = spec.name;
    const parent =
      spec.parent === undefined ? undefined : BONES.find((b) => b.name === spec.parent);
    const [px, py, pz] = parent?.at ?? [0, 0, 0];
    bone.position.set(spec.at[0] - px, spec.at[1] - py, spec.at[2] - pz);
    if (parent) bones.get(parent.name)?.add(bone);
    bones.set(spec.name, bone);
  }
  for (const [name, on, at] of SOCKETS) {
    const socket = new Object3D();
    socket.name = name;
    const [px, py, pz] = BONES.find((b) => b.name === on)?.at ?? [0, 0, 0];
    socket.position.set(at[0] - px, at[1] - py, at[2] - pz);
    bones.get(on)?.add(socket);
  }
  const index = (name: string) => BONES.findIndex((b) => b.name === name);
  const limb = (radius: number, length: number) => new CapsuleGeometry(radius, length, 6, 12);
  const body = mergeGeometries([
    part(ball(0.075, 1, 1.08, 0.92), [0, 0.118, 0], index("Hips"), FUR),
    part(ball(0.072), [0, 0.228, 0], index("Head"), FUR),
    part(ball(0.026, 1, 1, 0.6), [0.05, 0.288, 0], index("Head"), FUR),
    part(ball(0.026, 1, 1, 0.6), [-0.05, 0.288, 0], index("Head"), FUR),
    part(ball(0.03, 1, 0.75, 0.6), [0, 0.218, 0.05], index("Head"), PAW),
    part(limb(0.021, 0.05), [0.09, 0.122, 0], index("LeftArm"), FUR),
    part(limb(0.021, 0.05), [-0.09, 0.122, 0], index("RightArm"), FUR),
    part(limb(0.025, 0.03), [0.036, 0.04, 0.004], index("LeftUpLeg"), PAW),
    part(limb(0.025, 0.03), [-0.036, 0.04, 0.004], index("RightUpLeg"), PAW),
  ]);
  const skinned = new SkinnedMesh(
    body,
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
  );
  skinned.name = "body";
  const hips = bones.get("Hips");
  if (!hips) throw new Error("the plush has no hips");
  const root = new Group();
  root.add(hips, skinned);
  root.updateMatrixWorld(true);
  skinned.bind(new Skeleton([...bones.values()]));
  bones.get("Head")?.add(face());

  const glb = await new GLTFExporter().parseAsync(root, { binary: true, animations: clips() });
  if (!(glb instanceof ArrayBuffer)) throw new Error("the exporter didn't write a .glb");
  return withWalkSpeed(new Uint8Array(glb), WALK_SPEED);
}
