import { ITEM_INFO, ITEM_KINDS, SHOP_WEAR, WEAR_ITEMS } from "@terrakin/sim";
import { ART_KINDS, type ArtShape, isArtKind, itemArt, itemShapes } from "@terrakin/ui/item-art";
import { afterEach, describe, expect, it } from "vitest";
import { decorChoices, decorFromStacks, decorLabel, withDecorChanges } from "./build-palette";

/** Just enough of the DOM for `createElementNS`. Setting innerHTML anywhere fails the test. */
class FakeNode {
  children: FakeNode[] = [];
  attrs: Record<string, string> = {};
  textContent = "";
  constructor(
    readonly ns: string,
    readonly tag: string,
  ) {}
  set innerHTML(_: string) {
    throw new Error("innerHTML used");
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  append(...nodes: FakeNode[]) {
    this.children.push(...nodes);
  }
}

const SVG = "http://www.w3.org/2000/svg";
const saved = (globalThis as { document?: unknown }).document;
const fakeDocument = () => {
  (globalThis as { document?: unknown }).document = {
    createElementNS: (ns: string, tag: string) => new FakeNode(ns, tag),
  };
};

/** Every shape in a picture, groups opened up. */
const flat = (shapes: ArtShape[]): ArtShape[] =>
  shapes.flatMap((s) => [s, ...flat(s.children ?? [])]);

describe("item pictures", () => {
  afterEach(() => {
    (globalThis as { document?: unknown }).document = saved;
  });

  it("know every item and every piece of wear, including the shop's", () => {
    for (const kind of [...ITEM_KINDS, ...WEAR_ITEMS, ...SHOP_WEAR]) {
      expect(isArtKind(kind), kind).toBe(true);
    }
    expect(ART_KINDS).toHaveLength(ITEM_KINDS.length + WEAR_ITEMS.length);
    expect(isArtKind("rocket")).toBe(false);
  });

  it("draw each one as its own picture, from numbers and colors only", () => {
    const seen = new Set<string>();
    for (const kind of ART_KINDS) {
      const shapes = flat(itemShapes(kind));
      expect(shapes.length, kind).toBeGreaterThan(2);
      for (const s of shapes) {
        for (const [k, v] of Object.entries(s.attrs)) {
          expect(String(v), `${kind} ${k}`).not.toMatch(/[<>"]|url\(|javascript:|NaN|undefined/);
        }
      }
      const key = JSON.stringify(itemShapes(kind));
      expect(seen.has(key), `${kind} looks like another`).toBe(false);
      seen.add(key);
    }
  });

  it("build a non-empty, decorative svg for every item and shop wear", () => {
    fakeDocument();
    for (const kind of [...ITEM_KINDS, ...SHOP_WEAR]) {
      const svg = itemArt(kind) as unknown as FakeNode;
      expect(svg.ns).toBe(SVG);
      expect(svg.tag).toBe("svg");
      expect(svg.attrs).toMatchObject({
        viewBox: "0 0 48 48",
        width: "28",
        "aria-hidden": "true",
        class: "item-art",
        "data-kind": kind,
      });
      expect(svg.children.length, kind).toBeGreaterThan(2);
      expect(svg.children.every((c) => c.ns === SVG)).toBe(true);
    }
  });

  it("names the picture for screen readers when asked, as text", () => {
    fakeDocument();
    const name = `${ITEM_INFO.lantern.name} <b>`;
    const svg = itemArt("lantern", {
      title: name,
      size: 64,
      className: "shop-art",
    }) as unknown as FakeNode;
    expect(svg.attrs.role).toBe("img");
    expect(svg.attrs["aria-hidden"]).toBeUndefined();
    expect(svg.attrs).toMatchObject({ width: "64", class: "item-art shop-art" });
    expect(svg.children[0]).toMatchObject({ tag: "title", textContent: name });
  });
});

describe("decor in the build palette", () => {
  it("counts the decor you hold, in catalog order, and leaves out what you don't", () => {
    const counts = decorFromStacks([
      { kind: "bench", count: 1 },
      { kind: "lemon", count: 4 },
      { kind: "lantern", count: 3 },
      { kind: "fence", count: 0 },
    ]);
    expect([...counts]).toEqual([
      ["lantern", 3],
      ["bench", 1],
    ]);
  });

  it("follows the counts an inventory event carries", () => {
    const start = decorFromStacks([{ kind: "lantern", count: 1 }]);
    // Nothing about decor: the same counts back, so the palette isn't redrawn.
    expect(withDecorChanges(start, [{ kind: "sugar", count: 2 }])).toBe(start);
    expect(withDecorChanges(start, undefined)).toBe(start);
    // Bought fence posts, then placed the last lantern.
    const bought = withDecorChanges(start, [{ kind: "fence", count: 12 }]);
    expect([...bought]).toEqual([
      ["lantern", 1],
      ["fence", 12],
    ]);
    expect([...withDecorChanges(bought, [{ kind: "lantern", count: 0 }])]).toEqual([["fence", 12]]);
  });

  it("labels each choice with its count in plain words", () => {
    expect(decorLabel("lantern", 3)).toBe("Paper lantern, 3 left");
    expect(decorLabel("fence", 1)).toBe("Fence post, 1 left");
    expect(decorLabel("bench", 0)).toBe("Garden bench, none left");
  });

  it("keeps a choice you ran out of in its place until the palette closes", () => {
    const held = decorFromStacks([{ kind: "bench", count: 2 }]);
    expect(decorChoices(held, new Set())).toEqual([["bench", 2]]);
    expect(decorChoices(held, new Set(["lantern", "bench"]))).toEqual([
      ["lantern", 0],
      ["bench", 2],
    ]);
  });
});
