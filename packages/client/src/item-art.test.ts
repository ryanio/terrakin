import { ITEM_INFO, ITEM_KINDS, SHOP_WEAR, WEAR_ITEMS } from "@terrakin/sim";
import { ART_KINDS, type ArtShape, isArtKind, itemArt, itemShapes } from "@terrakin/ui/item-art";
import { afterEach, describe, expect, it } from "vitest";

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
    // And the recipe page lying on the ground (RFC 0024), which isn't a thing you hold.
    expect(isArtKind("recipe_page")).toBe(true);
    expect(ART_KINDS).toHaveLength(ITEM_KINDS.length + WEAR_ITEMS.length + 1);
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
