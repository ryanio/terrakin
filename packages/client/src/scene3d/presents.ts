import { parseKey } from "@terrakin/sim";
import { WINTER_HEX } from "@terrakin/ui/looks";
import { BoxGeometry, Group, Mesh, MeshLambertMaterial } from "three";
import type { PresentPile } from "../presents";
import { hex } from "./palette";

/**
 * Presents waiting to be opened (RFC 0034), in 3D: up to three wrapped boxes with a ribbon each,
 * at the front of a little fir or to the right of a hearth, where the map puts them. A pile is a
 * handful of meshes on one plot, built with its chunk and freed with it.
 */
const BOXES = [
  { dx: -0.16, dz: 0.34, size: 0.22, turn: 0.3 },
  { dx: 0.16, dz: 0.38, size: 0.18, turn: -0.4 },
  { dx: 0, dz: 0.3, size: 0.14, turn: 0.9, on: 0 },
] as const;

export function presentBoxes(
  origin: { x: number; y: number },
  piles: readonly ({ key: string } & PresentPile)[],
): Group {
  const group = new Group();
  const ribbon = new MeshLambertMaterial({ color: hex(WINTER_HEX.ribbon) });
  const papers = WINTER_HEX.wrapping.map((c) => new MeshLambertMaterial({ color: hex(c) }));
  for (const pile of piles) {
    const [x, y] = parseKey(pile.key);
    // Beside a hearth the pile is smaller and sits at its front right, inside the tile.
    const side = pile.tree ? 0 : 0.3;
    const k = pile.tree ? 1 : 0.6;
    BOXES.slice(0, Math.min(pile.count, BOXES.length)).forEach((b, i) => {
      const box = new Group();
      const paper = new Mesh(
        new BoxGeometry(b.size, b.size * 0.8, b.size),
        papers[i % papers.length],
      );
      paper.position.y = b.size * 0.4;
      const across = new Mesh(new BoxGeometry(b.size * 1.02, b.size * 0.82, b.size * 0.2), ribbon);
      across.position.y = b.size * 0.4;
      const along = new Mesh(new BoxGeometry(b.size * 0.2, b.size * 0.82, b.size * 1.02), ribbon);
      along.position.y = b.size * 0.4;
      box.add(paper, across, along);
      const below = "on" in b ? BOXES[b.on].size * 0.8 * k : 0;
      const under = "on" in b ? BOXES[b.on] : b;
      box.position.set(x - origin.x + side + under.dx * k, below, y - origin.y + under.dz * k);
      box.rotation.y = b.turn;
      group.add(box);
    });
  }
  return group;
}
