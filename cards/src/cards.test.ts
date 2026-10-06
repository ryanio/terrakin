import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import satori from "satori";
import { describe, expect, it } from "vitest";
import { FONTS } from "./fonts";
import { imageDataUri, MAX_IMAGE_PIXELS, probeImage } from "./images";
import { cards } from "./node";
import {
  PLOT_DECOR,
  PLOT_FURNITURE,
  type PlotDecor,
  type PlotFurniture,
  type PlotGround,
  plotSvg,
  safeColor,
} from "./plot";
import { unmask } from "./render";
import { samplePlot, samples } from "./samples";
import { type Card, element, H, W } from "./templates";
import { cardText, clip, count, drawable } from "./text";

const require = createRequire(import.meta.url);

function pngSize(b: Uint8Array) {
  expect([...b.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const v = new DataView(b.buffer, b.byteOffset);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

/** Every text run satori lays out for a card, with its box. */
async function textNodes(card: Card) {
  const fonts = FONTS.map((f) => ({
    name: f.name,
    weight: f.weight,
    style: "normal" as const,
    data: readFileSync(require.resolve(f.file)),
  }));
  const nodes: { text: string; left: number; top: number; width: number; height: number }[] = [];
  await satori(element(card) as never, {
    width: W,
    height: H,
    fonts,
    onNodeDetected: (n) => {
      if (n.textContent?.trim()) nodes.push({ ...n, text: n.textContent });
    },
  });
  return nodes;
}

// A small real PNG to stand in for an uploaded avatar or photo.
const picture = async () => {
  const { bytes } = await cards.render({ kind: "site" });
  return imageDataUri(bytes) ?? "";
};

describe("cards", () => {
  it("renders every template as a 1200x630 PNG within a time budget", async () => {
    await cards.render({ kind: "site" }); // boot the wasm once
    const photo = await picture();
    for (const [name, card] of samples({ avatar: photo, photo })) {
      // CPU time, not wall time: on a busy machine (a full test run, say) a card can wait seconds
      // for a core, and that says nothing about what drawing it costs.
      const started = process.cpuUsage();
      const out = await cards.render(card);
      const { user, system } = process.cpuUsage(started);
      expect(pngSize(out.bytes), name).toEqual({ width: 1200, height: 630 });
      expect(out.type).toBe("image/png");
      // About 100 ms on a laptop; the budget leaves room for a slow CI machine.
      expect((user + system) / 1000, name).toBeLessThan(2_000);
    }
  }, 60_000);

  it("draws the same card for the same data", async () => {
    const [, card] = samples()[2] ?? [];
    if (!card) throw new Error("no sample");
    const a = await cards.render(card);
    const b = await cards.render(card);
    expect(Buffer.from(b.bytes).equals(Buffer.from(a.bytes))).toBe(true);
  });

  it("draws markup in names and posts as literal text, never as elements", async () => {
    const card: Card = {
      kind: "post",
      author: { name: '"><script>x</script>', kind: "human", color: "sun", shape: "round" },
      text: "<img src=x onerror=alert(1)> & <b>bold</b>",
      likes: 1,
      replies: 2,
      date: "2026-10-04T00:00:00Z",
    };
    const texts = (await textNodes(card)).map((n) => n.text).join("\n");
    expect(texts).toContain('"><script>x</script>');
    expect(texts).toContain("<img src=x onerror=alert(1)> & <b>bold</b>");
    const svg = await cards.svg(card);
    // satori turns glyphs into paths: no markup from the post survives as SVG elements.
    expect(svg).not.toMatch(/<script|<img |onerror/i);
  });

  it("drops emoji and scripts the fonts lack, keeping the rest", async () => {
    expect(cardText("Finished the greenhouse 🌱🍅").text).toBe("Finished the greenhouse");
    expect(cardText("Café, naïve, Łódź, Ærøskøbing").text).toBe("Café, naïve, Łódź, Ærøskøbing");
    expect(cardText("Hi​‮there\nfriend").text).toBe("Hithere friend");
    expect(cardText("Привет, мир! Hello").text).toBe("Hello");
    // Mostly undrawable: the card falls back instead of showing scraps.
    expect(drawable("你好世界 ok", 40)).toBeUndefined();
    expect(drawable("🎉🎉🎉", 40)).toBeUndefined();
    const texts = (
      await textNodes({
        kind: "profile",
        person: { name: "🌻🌻", kind: "agent", color: "plum", shape: "diamond" },
        bio: "日本語のテキスト",
        posts: 1,
        followers: 2,
        following: 3,
      })
    ).map((n) => n.text);
    expect(texts).toContain("A resident");
    expect(texts.join(" ")).not.toMatch(/[\u{1F300}-\u{1FAFF}぀-ヿ]/u);
  });

  it("cuts long text and keeps every line inside the frame", async () => {
    const long = "an extraordinarily long line that keeps going ".repeat(20);
    const person = { name: long, kind: "agent" as const, color: "coal", shape: "square" as const };
    const cases: Card[] = [
      {
        kind: "profile",
        person: { ...person, townsfolk: true },
        bio: long,
        posts: 9_999_999,
        followers: 9_999_999,
        following: 9_999_999,
      },
      {
        kind: "post",
        author: { ...person, townsfolk: true },
        text: long,
        likes: 9_999_999,
        replies: 9_999_999,
        date: "2026-10-04T00:00:00Z",
        reply: true,
      },
      { kind: "page", eyebrow: long, title: long, subtitle: long },
    ];
    const frame = 24;
    for (const card of cases) {
      const nodes = await textNodes(card);
      expect(
        nodes.some((n) => n.text.includes("…")),
        `${card.kind}: nothing was cut`,
      ).toBe(true);
      for (const n of nodes) {
        const where = `${card.kind} "${n.text.slice(0, 30)}" at ${n.left},${n.top} ${n.width}x${n.height}`;
        expect(n.left >= frame && n.top >= frame, where).toBe(true);
        expect(n.left + n.width <= W - frame && n.top + n.height <= H - frame, where).toBe(true);
      }
    }
  });

  it("formats counts and clips on word boundaries", () => {
    expect([0, 1, 9_999, 12_345, 999_999, 1_250_000].map(count)).toEqual([
      "0",
      "1",
      "9,999",
      "12.3k",
      "999k",
      "1.3M",
    ]);
    expect(clip("one two three four five", 15)).toBe("one two three…");
    expect(clip("short", 15)).toBe("short");
  });
});

describe("pictures", () => {
  it("reads sizes from PNG, JPEG, GIF and WebP headers", () => {
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    png.set([0, 0, 2, 0, 0, 0, 1, 0], 16);
    expect(probeImage(png)).toEqual({ type: "image/png", width: 512, height: 256 });

    // SOI, an APP0 segment, then SOF0 with height 300 and width 400.
    const jpeg = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0,
      4,
      0,
      0,
      0xff,
      0xc0,
      0,
      17,
      8,
      1,
      0x2c,
      1,
      0x90,
      3,
      ...Array(20).fill(0),
    ]);
    expect(probeImage(jpeg)).toEqual({ type: "image/jpeg", width: 400, height: 300 });

    const gif = new Uint8Array(32);
    gif.set(new TextEncoder().encode("GIF89a"));
    gif.set([10, 0, 20, 0], 6);
    expect(probeImage(gif)).toEqual({ type: "image/gif", width: 10, height: 20 });

    const webp = new Uint8Array(32);
    webp.set(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8X"));
    webp.set([99, 0, 0, 49, 0, 0], 24);
    expect(probeImage(webp)).toEqual({ type: "image/webp", width: 100, height: 50 });

    expect(probeImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe(
      undefined,
    );
  });

  it("refuses pictures too big to decode safely", () => {
    const side = Math.ceil(Math.sqrt(MAX_IMAGE_PIXELS)) + 1;
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, side);
    new DataView(png.buffer).setUint32(20, side);
    expect(imageDataUri(png)).toBeUndefined();
    new DataView(png.buffer).setUint32(16, 100);
    new DataView(png.buffer).setUint32(20, 100);
    expect(imageDataUri(png)).toMatch(/^data:image\/png;base64,/);
  });
});

describe("renderer", () => {
  it("drops only the masks that match an image's own box", () => {
    const svg =
      '<mask id="a"><rect x="0" y="0" width="10" height="10" fill="#fff"/></mask>' +
      '<clipPath id="b"><rect x="0" y="0" width="10" height="10"/></clipPath>' +
      '<mask id="c"><rect x="0" y="0" width="5" height="5" fill="#fff"/></mask>' +
      '<image x="0" y="0" width="10" height="10" href="x" clip-path="url(#b)" mask="url(#a)"/>' +
      '<image x="0" y="0" width="10" height="10" href="y" mask="url(#c)"/>';
    const out = unmask(svg);
    expect(out).toContain('<image x="0" y="0" width="10" height="10" href="x"/>');
    expect(out).toContain('href="y" mask="url(#c)"');
  });

  it("bundles the same fonts in the Worker as in Node", () => {
    const worker = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");
    const imported = [...worker.matchAll(/from "(@fontsource\/[^"]+\.woff)"/g)].map((m) => m[1]);
    expect(imported.sort()).toEqual(FONTS.map((f) => f.file).sort());
  });

  it("keeps a plot photo's SVG our own: only palette colors and coordinates on the plot", () => {
    const hostile = '"/><script>x</script><image href="https://example.com/x.png';
    expect(safeColor(hostile)).toBe("#b3ab9b");
    expect(safeColor("#a5c682")).toBe("#a5c682");
    expect(safeColor("rgba(242, 184, 75, 0.34)")).toBe("rgba(242, 184, 75, 0.34)");
    const base = samplePlot("Wren");
    const svg = plotSvg(
      {
        ...base,
        ground: base.ground.map((g, i) => ({
          ...g,
          fill: hostile,
          ...(g.flower ? { flower: { ...g.flower, fill: hostile } } : {}),
          // Autumn leaves on bare tiles: a hostile color, and one lying nowhere.
          ...(!g.flower && g.tuft === undefined && i % 3 === 0
            ? { leaf: { fx: 0.5, fy: i % 2 ? Number.NaN : 0.4, turn: 1, fill: hostile } }
            : {}),
        })),
        tint: hostile,
        blocks: [
          ...base.blocks.map((b) => ({ ...b, fill: hostile })),
          { x: Number.NaN, y: 1, glass: false, fill: "#b8834f" },
          { x: 99, y: 1, glass: false, fill: "#b8834f" },
        ],
        hearth: { x: -1, y: 3 },
        ink: { roof: hostile, door: hostile, walls: hostile, tuft: hostile },
      },
      420,
    );
    expect(svg).not.toMatch(/<script|<image|href|example\.com/);
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain('x="99');
    // No hearth off the plot: its roof is the only path that closes with "z" and a fill.
    expect(svg).not.toMatch(/<ellipse/);
    expect(svg.match(/<svg/g)).toHaveLength(1);
  });

  it("draws paths and floors from their marks, and keeps them on the tile and in the palette", () => {
    const hostile = '"/><script>x</script>';
    const base = samplePlot("Wren");
    const paved = (paving: PlotGround["paving"]) =>
      plotSvg({ ...base, ground: base.ground.map((g) => ({ fill: g.fill, paving })) }, 420);
    const svg = paved({
      fill: hostile,
      marks: [
        { shape: "rect", x: 0.1, y: 0.1, w: 0.4, h: 0.4, r: 0.1, fill: hostile },
        { shape: "circle", cx: Number.NaN, cy: 0.5, r: 99, fill: "#b0a99c" },
        { shape: "ellipse", cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.05, turn: 30, fill: "#e08a3c" },
        { shape: "line", x1: 0, y1: 0.3, x2: 1, y2: 0.3, width: 0.03, stroke: hostile },
      ],
    });
    expect(svg).not.toMatch(/<script|NaN|r="99"/);
    // Leaves are drawn as paths, so the hearth's shadow stays the only ellipse.
    expect(svg.match(/<ellipse/g)).toHaveLength(1);
    // A paved tile grows no tufts or flowers.
    expect(svg).not.toContain('stroke-width="0.045" stroke-linecap="round" fill="none"/>');
  });

  it("draws furniture as itself, with low walls joining only other walls", () => {
    const one = (furniture: PlotFurniture, x = 1) =>
      plotSvg(
        {
          ...samplePlot("Wren"),
          blocks: [{ x, y: 1, glass: false, fill: "#a8a196", furniture }],
        },
        420,
      );
    const square = plotSvg(
      { ...samplePlot("Wren"), blocks: [{ x: 1, y: 1, glass: false, fill: "#a8a196" }] },
      420,
    );
    const drawn = new Set<string>();
    for (const kind of PLOT_FURNITURE) {
      const svg = one(kind);
      expect(svg, kind).not.toBe(square);
      expect(svg, kind).toContain('fill="#a8a196"');
      drawn.add(svg);
    }
    expect(drawn.size).toBe(PLOT_FURNITURE.length);
    const pair = plotSvg(
      {
        ...samplePlot("Wren"),
        blocks: [
          { x: 1, y: 1, glass: false, fill: "#a8a196", furniture: "stone_wall" },
          { x: 2, y: 1, glass: false, fill: "#a8a196", furniture: "stone_wall" },
        ],
      },
      420,
    );
    // Joined, the walls run edge to edge: the first reaches the tile's east side.
    expect(pair).toContain('width="0.8" height="0.48"');
    expect(one("stone_wall")).not.toContain('width="0.8" height="0.48"');
  });

  it("draws what grows over its planter, its fruit once ripe, and a crop on a vine like a pumpkin", () => {
    const garden = {
      ...samplePlot("Wren"),
      blocks: [{ x: 1, y: 1, glass: false, fill: "#8a5a36" }],
    };
    const grown = (crop: string, done: number, fill: string, vine = false) =>
      plotSvg(
        { ...garden, crops: [{ x: 1, y: 1, crop, done, fill, ...(vine ? { vine } : {}) }] },
        420,
      );
    const bare = plotSvg({ ...garden, crops: [] }, 420);
    const fruit = (svg: string, fill: string) => svg.split(`fill="${fill}"`).length - 1;
    // A sprout from the day it's planted, and three strawberries in their color once it's ready.
    expect(grown("strawberry", 0, "#d9434f")).not.toBe(bare);
    expect(fruit(grown("strawberry", 0.5, "#d9434f"), "#d9434f")).toBe(0);
    expect(fruit(grown("strawberry", 1, "#d9434f"), "#d9434f")).toBe(3);
    // A crop on a vine, like a pumpkin, is a vine at first, then swells from green, and is its own
    // orange once ripe.
    expect(fruit(grown("pumpkin", 0.1, "#e8862f", true), "#e8862f")).toBe(0);
    expect(fruit(grown("pumpkin", 0.6, "#e8862f", true), "#e8862f")).toBe(0);
    expect(grown("pumpkin", 0.6, "#e8862f", true)).not.toBe(grown("pumpkin", 0.1, "#e8862f", true));
    expect(fruit(grown("pumpkin", 1, "#e8862f", true), "#e8862f")).toBe(3);
    // Only numbers and checked colors reach the markup, only on the plot, and no ellipses.
    const odd = plotSvg(
      {
        ...garden,
        crops: [
          { x: 1, y: 1, crop: '"/><script>', done: Number.NaN, fill: '"/><script>' },
          { x: 99, y: 1, crop: "herb", done: 1, fill: "#4f8a3a" },
        ],
      },
      420,
    );
    expect(odd).not.toMatch(/<script|NaN|#4f8a3a/);
    expect(odd.match(/<ellipse/g)).toHaveLength(1);
  });

  it("draws a pet only from shapes that check out: numbers, colors, and paths of numbers", () => {
    const pet = {
      x: 3.7,
      y: 3,
      size: 0.9,
      flip: true,
      shapes: [
        { tag: "ellipse", attrs: { cx: 24, cy: 34, rx: 10, ry: 6, fill: "#df7a3c" } },
        {
          tag: "path",
          attrs: { d: "M10 40l4-6z", fill: "none", stroke: "#5a5146", "stroke-linecap": "round" },
        },
        { tag: "script", attrs: { d: "M0 0z" } },
        { tag: "path", attrs: { d: 'M0 0"/><script>x</script>', fill: '"/><image href="x' } },
        {
          tag: "circle",
          attrs: { cx: "4", cy: 4, r: Number.NaN, onload: "x()", href: "https://example.com" },
        },
        { tag: "path", attrs: { d: "M1 1z", "stroke-linejoin": "url(#x)" } },
      ],
    };
    const svg = plotSvg({ ...samplePlot("Wren"), pet }, 420);
    expect(svg).not.toMatch(/<script|<image|href|onload|example\.com|NaN|url\(/);
    expect(svg).toContain('<ellipse cx="24" cy="34" rx="10" ry="6" fill="#df7a3c"/>');
    expect(svg).toContain(
      '<path d="M10 40l4-6z" fill="none" stroke="#5a5146" stroke-linecap="round"/>',
    );
    // Facing left: flipped about its box.
    expect(svg).toContain('<g transform="translate(4.6 3) scale(-0.019 0.019)">');
    // A pet off the plot, or a box too big, draws nothing.
    expect(plotSvg({ ...samplePlot("Wren"), pet: { ...pet, x: 99 } }, 420)).not.toContain("<g ");
    expect(plotSvg({ ...samplePlot("Wren"), pet: { ...pet, size: 40 } }, 420)).not.toContain("<g ");
  });

  it("draws the shop's decor as itself, with fence rails only toward other fences", () => {
    const one = (decor: PlotDecor, x = 1) =>
      plotSvg(
        { ...samplePlot("Wren"), blocks: [{ x, y: 1, glass: false, fill: "#e8dcc4", decor }] },
        420,
      );
    const square = plotSvg(
      { ...samplePlot("Wren"), blocks: [{ x: 1, y: 1, glass: false, fill: "#e8dcc4" }] },
      420,
    );
    for (const kind of PLOT_DECOR) {
      expect(one(kind)).not.toBe(square);
      expect(one(kind)).toContain('fill="#e8dcc4"');
    }
    const rails = (svg: string) => (svg.match(/height="0\.09"/g) ?? []).length;
    expect(rails(one("fence"))).toBe(0);
    const pair = plotSvg(
      {
        ...samplePlot("Wren"),
        blocks: [
          { x: 1, y: 1, glass: false, fill: "#e8dcc4", decor: "fence" },
          { x: 2, y: 1, glass: false, fill: "#e8dcc4", decor: "fence" },
        ],
      },
      420,
    );
    // Two rails east from the first post and two west from the second.
    expect(rails(pair)).toBe(4);
    // Anything else in `decor` is drawn as a plain block, never as markup.
    const odd = plotSvg(
      {
        ...samplePlot("Wren"),
        blocks: [{ x: 1, y: 1, glass: false, fill: "#e8dcc4", decor: '"/><script>' as "fence" }],
      },
      420,
    );
    expect(odd).toBe(square);
  });
});
