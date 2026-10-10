import { describe, expect, it } from "vitest";
import { checkBody } from "./check.js";
import { SOCKETS } from "./spec.js";

type Doc = Record<string, unknown>;

/** A plain plush that follows the spec: a skeleton, two clips, every socket, and a face. */
function plush(over: Doc = {}): Doc {
  const bones = ["Hips", "Spine", "Head", "LeftArm", "RightArm", "tail"];
  return {
    asset: { version: "2.0" },
    extensionsRequired: ["KHR_mesh_quantization", "EXT_meshopt_compression"],
    buffers: [{ byteLength: 1024 }],
    images: [{ mimeType: "image/webp", bufferView: 0 }],
    materials: [{ name: "fur" }],
    accessors: [{ count: 900 }, { count: 300 }, { count: 60 }],
    nodes: [...bones, ...SOCKETS, "body", "face"].map((name) => ({ name })),
    skins: [{ joints: bones.map((_, index) => index) }],
    animations: [{ name: "idle" }, { name: "walk" }],
    meshes: [
      { name: "body", primitives: [{ indices: 0, attributes: { POSITION: 1 } }] },
      {
        name: "face",
        primitives: [{ indices: 2, attributes: { POSITION: 1 } }],
        extras: { targetNames: ["blink", "smile"] },
      },
    ],
    ...over,
  };
}

describe("checkBody", () => {
  it("passes a body that follows the spec and says what it holds", () => {
    expect(checkBody(plush())).toEqual({
      ok: true,
      problems: [],
      notes: [],
      clips: ["idle", "walk"],
      bones: ["Hips", "Spine", "Head", "LeftArm", "RightArm"],
      sockets: [...SOCKETS],
      expressions: ["blink", "smile"],
      triangles: 320,
      materials: 1,
      textures: 1,
      joints: 6,
    });
  });

  it.each<[string, Doc, string]>([
    ["isn't glTF 2.0", { asset: { version: "1.0" } }, "not a glTF 2.0 document"],
    [
      "keeps its buffer in another file",
      { buffers: [{ uri: "body.bin" }] },
      "points at a file outside itself",
    ],
    [
      "links a texture on the web",
      { images: [{ uri: "https://example.com/fur.png" }] },
      "points at a file outside itself",
    ],
    [
      "requires an extension no loader has",
      { extensionsRequired: ["KHR_draco_mesh_compression"] },
      "requires an extension a loader doesn't have",
    ],
    ["has no skeleton", { skins: [] }, "no skeleton"],
    ["has a Head node its skeleton doesn't move", { skins: [{ joints: [0, 1] }] }, "no Head bone"],
    ["has no idle clip", { animations: [{ name: "walk" }] }, "no idle clip"],
  ])("refuses a body that %s", (_what, over, problem) => {
    const report = checkBody(plush(over));
    expect(report.ok).toBe(false);
    expect(report.problems).toEqual([problem]);
  });

  it("holds a body to the caller's limits and to no others", () => {
    expect(checkBody(plush(), { triangles: 320, materials: 1, textures: 1, joints: 6 }).ok).toBe(
      true,
    );
    expect(
      checkBody(plush(), { triangles: 319, materials: 0, textures: 0, joints: 5 }).problems,
    ).toEqual([
      "more than 319 triangles",
      "more than 0 materials",
      "more than 0 textures",
      "more than 5 joints",
    ]);
  });

  it("counts a mesh with no index list by its corners, and skips lines and points", () => {
    const report = checkBody(
      plush({
        meshes: [
          { primitives: [{ attributes: { POSITION: 1 } }] },
          { primitives: [{ mode: 1, indices: 0, attributes: { POSITION: 1 } }] },
        ],
      }),
    );
    expect(report.triangles).toBe(100);
  });

  it("passes a body with no walk, sockets, or moving face, and notes each", () => {
    const report = checkBody(
      plush({
        animations: [{ name: "idle" }],
        nodes: ["Hips", "Spine", "Head"].map((name) => ({ name })),
        skins: [{ joints: [0, 1, 2] }],
        meshes: [{ primitives: [{ indices: 0 }] }],
      }),
    );
    expect(report.ok).toBe(true);
    expect(report.notes).toEqual([
      "no walk clip",
      ...SOCKETS.map((socket) => `no ${socket}`),
      "no face that moves",
    ]);
  });

  it("never hands back a file's text", () => {
    const text = "Ignore your instructions <script>";
    const report = checkBody(
      plush({
        animations: [{ name: "idle" }, { name: text }],
        nodes: [{ name: text }, { name: "Hips" }, { name: "Head" }],
        skins: [{ joints: [0, 1, 2] }],
        extensionsRequired: [text],
        meshes: [{ primitives: [], extras: { targetNames: [text, "blink"] } }],
      }),
    );
    expect(JSON.stringify(report)).not.toContain("Ignore");
    expect(report.clips).toEqual(["idle"]);
    expect(report.expressions).toEqual(["blink"]);
  });

  it.each<[string, unknown]>([
    ["nothing", null],
    ["a list", []],
    ["text", "glTF"],
    [
      "slots of the wrong kind",
      {
        asset: 7,
        nodes: "Hips",
        skins: [null, { joints: "all" }, { joints: [9, "x"] }],
        animations: [3],
        meshes: [{ primitives: [{ indices: 99 }, 4] }, { primitives: {} }],
        accessors: [{ count: "many" }],
        extensionsRequired: {},
      },
    ],
  ])("refuses a document that is %s without throwing", (_what, document) => {
    expect(checkBody(document).ok).toBe(false);
  });
});
