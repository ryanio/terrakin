/**
 * A plain plush for tests, written out as the bytes of a `.glb`: a body one triangle tall, a head
 * bone on a hips bone, a face with morph targets, a socket, and clips that turn the head. Over one
 * second `idle` turns the head a quarter turn about its up, and every other clip a quarter turn
 * about its side, so a test can tell which is playing and how far along it is.
 */

export interface PlushOptions {
  /** The clips it has. Default `idle`. */
  clips?: readonly string[];
  /** The face's morph targets. Default `blink` and `smile`. */
  targets?: readonly string[];
  /** Its `walk_speed_m_s`, when it says. */
  walkSpeed?: number;
  /** Changes to the document before it is written out. */
  change?: (document: Record<string, unknown>) => void;
}

/** How tall the plush is in its file, in meters. */
const PLUSH_HEIGHT = 0.3;

export function plushGlb(options: PlushOptions = {}): Uint8Array {
  const clips = options.clips ?? ["idle"];
  const targets = options.targets ?? ["blink", "smile"];
  const chunks: Uint8Array[] = [];
  const bufferViews: unknown[] = [];
  const accessors: unknown[] = [];
  let length = 0;

  const add = (data: Float32Array | Uint8Array | Uint16Array, type: string, extra: object = {}) => {
    const bytes = new Uint8Array(data.buffer.slice(0));
    const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
    padded.set(bytes);
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
    chunks.push(padded);
    length += padded.length;
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type] ?? 1;
    const componentType =
      data instanceof Float32Array ? 5126 : data instanceof Uint16Array ? 5123 : 5121;
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType,
      count: data.length / size,
      type,
      ...extra,
    });
    return accessors.length - 1;
  };

  const body = add(new Float32Array([-0.1, 0, 0, 0.1, 0, 0, 0, PLUSH_HEIGHT, 0]), "VEC3", {
    min: [-0.1, 0, 0],
    max: [0.1, PLUSH_HEIGHT, 0],
  });
  const joints = add(new Uint8Array(12), "VEC4");
  const weights = add(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), "VEC4");
  const indices = add(new Uint16Array([0, 1, 2]), "SCALAR");
  const face = add(new Float32Array([-0.03, 0, 0.05, 0.03, 0, 0.05, 0, 0.05, 0.05]), "VEC3", {
    min: [-0.03, 0, 0.05],
    max: [0.03, 0.05, 0.05],
  });
  const deltas = targets.map(() =>
    add(new Float32Array([0, 0.01, 0, 0, 0.01, 0, 0, 0, 0]), "VEC3", {
      min: [0, 0, 0],
      max: [0, 0.01, 0],
    }),
  );
  // Hips sits at the origin and Head 0.2 above it.
  const binds = add(
    new Float32Array([
      ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.2, 0, 1],
    ]),
    "MAT4",
  );
  const times = add(new Float32Array([0, 1]), "SCALAR", { min: [0], max: [1] });
  const aboutUp = add(new Float32Array([0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2]), "VEC4");
  const aboutSide = add(new Float32Array([0, 0, 0, 1, Math.SQRT1_2, 0, 0, Math.SQRT1_2]), "VEC4");

  const document: Record<string, unknown> = {
    asset: {
      version: "2.0",
      ...(options.walkSpeed === undefined ? {} : { extras: { walk_speed_m_s: options.walkSpeed } }),
    },
    scene: 0,
    scenes: [{ nodes: [0, 4] }],
    nodes: [
      { name: "Hips", children: [1] },
      { name: "Head", translation: [0, 0.2, 0], children: [2, 3] },
      { name: "socket_head", translation: [0, 0.1, 0] },
      { name: "face", mesh: 1 },
      { name: "body", mesh: 0, skin: 0 },
    ],
    skins: [{ joints: [0, 1], inverseBindMatrices: binds }],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: body, JOINTS_0: joints, WEIGHTS_0: weights }, indices },
        ],
      },
      {
        primitives: [
          {
            attributes: { POSITION: face },
            indices,
            targets: deltas.map((POSITION) => ({ POSITION })),
          },
        ],
        extras: { targetNames: [...targets] },
      },
    ],
    animations: clips.map((name) => ({
      name,
      samplers: [{ input: times, output: name === "idle" ? aboutUp : aboutSide }],
      channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }],
    })),
    accessors,
    bufferViews,
    buffers: [{ byteLength: length }],
  };
  options.change?.(document);

  const text = new TextEncoder().encode(JSON.stringify(document));
  const json = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
  json.set(text);
  const out = new Uint8Array(12 + 8 + json.length + 8 + length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, json.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  view.setUint32(20 + json.length, length, true);
  view.setUint32(24 + json.length, 0x004e4942, true);
  let offset = 28 + json.length;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
