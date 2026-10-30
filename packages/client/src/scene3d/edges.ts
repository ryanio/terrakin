import { type BlockKind, DOOR_LOOK, WALL_LOOK, type WallKind } from "@terrakin/sim";
import { InstancedMesh, Matrix4, type Object3D, Quaternion, type Texture, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { bakeShade, paper, type Stage } from "./art";
import { FLOOR_HEIGHT, floorY, type LayoutEdge } from "./layout";
import { materialTexture } from "./materials";
import { blockLook, hex } from "./palette";

/**
 * How deep a wall between tiles is (RFC 0050), in tiles: the same share of a tile the map draws it
 * (`EDGE_THICKNESS` in `render/edges.ts`), so the two views agree on how much floor a room keeps.
 */
const EDGE_DEPTH = 0.22;

const isWallKind = (block: BlockKind): block is WallKind => Object.hasOwn(WALL_LOOK, block);
const isPane = (block: BlockKind) => block === "glass" || block === "sea_glass_pane";

/**
 * Walls between tiles as instanced meshes, one draw per kind, placed relative to `origin`: each a
 * slab on its line, a little longer than a tile so walls meet at their corners, as tall as a wall
 * block and wearing that kind's surface (`materialTexture`). Windows are see-through, a door is its
 * painted panel in a frame.
 */
export function edgeMeshes(
  stage: Stage,
  origin: { x: number; y: number },
  edges: readonly LayoutEdge[],
  shared?: { wall?: (kind: WallKind) => Texture },
): Object3D[] {
  const out: Object3D[] = [];
  if (edges.length === 0) return out;
  const m = new Matrix4();
  const one = new Vector3(1, 1, 1);
  const across = new Quaternion();
  const along = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  /** Where a line's middle is: the north or west side of its tile, at its floor. */
  const spot = (e: LayoutEdge) =>
    e.side === "n"
      ? new Vector3(e.x - origin.x, floorY(e.floor), e.y - 0.5 - origin.y)
      : new Vector3(e.x - 0.5 - origin.x, floorY(e.floor), e.y - origin.y);
  const kinds = [...new Set(edges.map((e) => e.block))];
  for (const kind of kinds) {
    const list = edges.filter((e) => e.block === kind);
    const height = kind === "door" ? FLOOR_HEIGHT : blockLook(kind).height || FLOOR_HEIGHT;
    const geo = bakeShade(
      new RoundedBoxGeometry(1 + EDGE_DEPTH, height, EDGE_DEPTH, 2, EDGE_DEPTH * 0.35),
      0.62,
      1,
    );
    geo.translate(0, height / 2, 0);
    stage.keep(geo);
    const material =
      kind === "door"
        ? paper(hex(DOOR_LOOK.panel), null)
        : isPane(kind)
          ? paper(blockLook(kind).color, null, {
              transparent: true,
              opacity: 0.55,
              depthWrite: false,
            })
          : isWallKind(kind)
            ? paper(0xffffff, shared?.wall?.(kind) ?? stage.keep(materialTexture(kind)))
            : paper(blockLook(kind).color, null);
    stage.keep(material);
    const mesh = new InstancedMesh(geo, material, list.length);
    list.forEach((e, i) => {
      m.compose(spot(e), e.side === "n" ? across : along, one);
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = !isPane(kind);
    mesh.receiveShadow = true;
    out.push(mesh);
  }
  return out;
}
