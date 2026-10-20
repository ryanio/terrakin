import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import satori from "satori";
import { describe, expect, it } from "vitest";
import { type Drawing, drawingSvg } from "./drawing";
import { FONTS } from "./fonts";
import { imageDataUri, MAX_IMAGE_PIXELS, probeImage } from "./images";
import { cards } from "./node";
import { nearSvg } from "./pictures";
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
import {
  sampleFigure,
  sampleLoft,
  sampleNear,
  samplePlot,
  samplePlotInTown,
  samples,
} from "./samples";
import { nightWash } from "./sky";
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

  it("titles a named plot's photo with its name, and keeps whose home it is beside it", async () => {
    for (const name of ["Lemon Grove", "Wild Meadow Workshop & Windmill Gardens!"]) {
      const nodes = await textNodes({ ...samplePlot("Juniper"), title: name });
      const title = nodes.find((n) => n.text === name);
      const line = nodes.find((n) => n.text.startsWith("Juniper's home"));
      expect(title, `${name}: drawn whole`).toBeDefined();
      expect(line && title && line.top > title.top, `${name}: whose home, beneath`).toBe(true);
    }
    // A name with nothing the fonts can draw leaves the home as the title.
    const undrawable = await textNodes({ ...samplePlot("Juniper"), title: "🍋🍋🍋" });
    expect(undrawable.map((n) => n.text)).toContain("Juniper's home");
    // A longer line of facts, like a home with a loft's "2 floors", stays one line beside the photo.
    const loft = await textNodes(sampleLoft("Juniper"));
    const facts = loft.find((n) => n.text.endsWith("2 floors"));
    expect(facts?.text.startsWith("Meadow and forest")).toBe(true);
    expect(facts && facts.left + facts.width <= W - 48).toBe(true);
  });

  it("stamps a photo with the day, the sky, and the weather it was taken in", async () => {
    const marks = ["Day 13 of Terrakin", "Autumn", "Dusk", "Rain"];
    for (const posted of [false, true]) {
      const nodes = await textNodes({ ...samplePlot("Juniper"), stamp: marks, posted });
      // Drawn in capitals by the card's own style; the words are the server's, as they came.
      const line = nodes.find((n) => n.text.includes("Day 13"));
      const title = nodes.find((n) => n.text === "Juniper's home");
      expect(line?.text, `posted: ${posted}`).toBe("Day 13 of Terrakin · Autumn · Dusk · Rain");
      expect(line && title && line.top > title.top, `posted: ${posted}`).toBe(true);
    }
    // A world counting no days has nothing to stamp, and the card is drawn without one.
    const bare = await textNodes({ ...samplePlot("Juniper"), stamp: [] });
    expect(bare.some((n) => n.text.includes("Day 13"))).toBe(false);
    // The longest stamp a world can make stays one line: a second would land on the brand under
    // it. Its tracking is a flat cost a character, which the size has to take off the width first.
    // The longest day words are a world's before it opened, and the longest sky four parts.
    const longest = ["before Day 1 of Terrakin", "Autumn", "Night", "Cloudy"];
    for (const posted of [false, true]) {
      const nodes = await textNodes({ ...samplePlot("Juniper"), stamp: longest, posted });
      const line = nodes.find((n) => n.text.includes("before Day 1"));
      expect(line?.text, `posted: ${posted}`).toContain("Cloudy");
      expect(line && line.height < 30, `posted: ${posted}, one line`).toBe(true);
      const brand = nodes.find((n) => n.text === "terrakin");
      expect(brand && line && brand.top >= line.top + line.height, `posted: ${posted}`).toBe(true);
    }
  });

  it("lets the night fall on the owner's home picture too, which sits over the drawing", async () => {
    const homeArt = { src: await picture(), width: 1200, height: 630 };
    const night = {
      ...samplePlot("Juniper"),
      homeArt,
      sky: { night: 1, weather: "clear" as const },
    };
    const wash = nightWash(night.sky);
    expect(wash).toBeDefined();
    expect(await cards.svg(night)).toContain(wash);
    // By day there's nothing to wash, and the picture is drawn as it was uploaded.
    expect(await cards.svg({ ...samplePlot("Juniper"), homeArt })).not.toContain("rgba(26, 18, 54");
  });

  it("puts a posted photo's brand on its frame, inside what a phone's crop of the picture shows", async () => {
    const title = "Wild Meadow Workshop & Windmill Gardens!";
    const marks = ["Day 13 of Terrakin", "Autumn", "Rain"];
    const nodes = await textNodes({ ...sampleLoft("Juniper"), title, stamp: marks, posted: true });
    const brand = nodes.find((n) => n.text === "terrakin");
    const line = nodes.find((n) => n.text.startsWith("Juniper's home"));
    expect(brand && line && brand.top >= line.top + line.height, "under the caption").toBe(true);
    // A 3:4 crop of the picture, narrower than any phone shows it, keeps every word whole.
    const side = (W - (H * 3) / 4) / 2;
    for (const n of nodes) {
      expect(n.left >= side && n.left + n.width <= W - side, n.text).toBe(true);
    }
    // The card for a link has the whole width: the photo on one side, its words and its brand on
    // the other, so no band of paper is left over (issue #80).
    const card = await textNodes({ ...samplePlot("Juniper"), stamp: marks });
    expect(card.find((n) => n.text === "terrakin")).toBeDefined();
    for (const n of card) expect(n.left > W / 2, n.text).toBe(true);
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
  /** Bytes from text (one byte a character) and numbers, end to end. */
  const bytes = (...parts: (string | number[])[]) =>
    Uint8Array.from(
      parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
    );
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const png = (w: number, h: number) =>
    bytes(PNG, [0, 0, 0, 13], "IHDR", [0, 0, w >> 8, w & 0xff, 0, 0, h >> 8, h & 0xff]);
  const riff = (chunk: string, data: number[]) =>
    bytes("RIFF", [0, 0, 0, 0], "WEBP", chunk, [data.length, 0, 0, 0], data);
  // 100 by 50 as each kind of WebP stores it.
  const lossless = riff("VP8L", [0x2f, 99, 0x40, 0x0c, 0]);
  const lossy = riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 100, 0, 50, 0]);
  const extended = riff("VP8X", [0, 0, 0, 0, 99, 0, 0, 49, 0, 0]);
  const webp = { type: "image/webp", width: 100, height: 50 };
  // A JPEG's pieces: an APP0 segment, a frame header of 400 by 300, an EXIF block, and the scan.
  const SOI = [0xff, 0xd8];
  const APP0 = [0xff, 0xe0, 0, 4, 0, 0];
  const FRAME = [0xff, 0xc0, 0, 11, 8, 1, 0x2c, 1, 0x90, 1, 1, 0x11, 0];
  const exif = (tiff: number[]) => [0xff, 0xe1, 0, 8 + tiff.length, ...bytes("Exif\0\0"), ...tiff];
  const SCAN = [0xff, 0xda, 0, 2, 0x11, 0xff, 0xd9];
  const jpeg = { type: "image/jpeg", width: 400, height: 300 };

  it("reads sizes from PNG, JPEG, GIF and WebP headers", () => {
    expect(probeImage(png(512, 256))).toEqual({ type: "image/png", width: 512, height: 256 });
    expect(probeImage(bytes(SOI, APP0, FRAME, SCAN))).toEqual(jpeg);
    expect(probeImage(bytes("GIF89a", [10, 0, 20, 0]))).toEqual({
      type: "image/gif",
      width: 10,
      height: 20,
    });
    expect(probeImage(lossless)).toEqual(webp);
    expect(probeImage(lossy)).toEqual(webp);
    expect(probeImage(extended)).toEqual(webp);

    expect(probeImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe(
      undefined,
    );
  });

  it("reads a header as short as its format allows, and nothing shorter", () => {
    const shortest: [Uint8Array, number][] = [
      [png(512, 256), 24],
      [bytes("GIF87a", [10, 0, 20, 0]), 10],
      [lossless, 25],
      [lossy, 30],
      [extended, 30],
    ];
    for (const [file, length] of shortest) {
      expect(file.length).toBe(length);
      expect(probeImage(file)).toBeDefined();
      expect(probeImage(file.slice(0, length - 1))).toBeUndefined();
    }
  });

  it("refuses a header whose signature or first chunk doesn't check out", () => {
    // A PNG needs its signature and IHDR as the first chunk, not one of the two.
    expect(probeImage(bytes(PNG, [0, 0, 0, 4], "CgBI", [0, 0, 2, 0, 0, 0, 1, 0]))).toBeUndefined();
    expect(probeImage(bytes(Array(12).fill(0), "IHDR", [0, 0, 2, 0, 0, 0, 1, 0]))).toBeUndefined();
    expect(probeImage(bytes("GIF12a", [10, 0, 20, 0]))).toBeUndefined();
    // Lossless WebP starts its data with 0x2f, and lossy with the key frame's start code.
    expect(probeImage(riff("VP8L", [0, 99, 0x40, 0x0c, 0]))).toBeUndefined();
    expect(probeImage(riff("VP8 ", [0, 0, 0, 0, 0, 0, 100, 0, 50, 0]))).toBeUndefined();
  });

  it("walks a JPEG to its scan, and reads nothing from one whose segments break first", () => {
    expect(probeImage(bytes(SOI, FRAME, [0, 0, 0, 0], SCAN))).toBeUndefined();
    // A length that runs past the file, a length too short to be one, and a frame with no size.
    expect(probeImage(bytes(SOI, FRAME, [0xff, 0xdb, 0, 67, 0, 0], SCAN))).toBeUndefined();
    expect(probeImage(bytes(SOI, FRAME, [0xff, 0xdb, 0, 1], SCAN))).toBeUndefined();
    expect(probeImage(bytes(SOI, [0xff, 0xc0, 0, 4, 8, 1], SCAN))).toBeUndefined();
    // Fill bytes before a marker, and a file that ends between segments, are both fine.
    expect(probeImage(bytes(SOI, [0xff, 0xff], APP0, [0xff], FRAME, SCAN))).toEqual(jpeg);
    expect(probeImage(bytes(SOI, APP0, FRAME))).toEqual(jpeg);
  });

  it("hands over each EXIF block before the scan, and leaves the size as the file stores it", () => {
    const seen: number[][] = [];
    const file = bytes(SOI, exif([1, 2, 3]), FRAME, exif([4, 5]), SCAN, exif([6]));
    expect(probeImage(file, (tiff) => seen.push([...tiff]))).toEqual(jpeg);
    expect(seen).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });

  it("refuses pictures too big to decode safely", () => {
    const side = Math.ceil(Math.sqrt(MAX_IMAGE_PIXELS)) + 1;
    expect(imageDataUri(png(side, side))).toBeUndefined();
    expect(imageDataUri(png(100, 100))).toMatch(/^data:image\/png;base64,/);
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

  it("draws with a satori that loads no HarfBuzz, which a Worker can't start", () => {
    // HarfBuzz's loader reads `self.location.href` and fetches its own wasm at run time. A Worker
    // has neither, so every card and plot photo fails there while this suite stays green in Node.
    const standalone = readFileSync(require.resolve("satori/standalone"), "utf8");
    expect(standalone).not.toMatch(/harfbuzz/i);
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
        tints: [{ x: 0, y: 0, w: 8, h: 8, fill: hostile }],
        blocks: [
          ...base.blocks.map((b) => ({ ...b, fill: hostile })),
          { x: Number.NaN, y: 1, glass: false, fill: "#b8834f" },
          { x: 99, y: 1, glass: false, fill: "#b8834f" },
        ],
        hearth: { x: -1, y: 3 },
        floors: [
          {
            flooring: [
              { x: 2, y: 2, paving: { fill: hostile, marks: [] } },
              { x: Number.NaN, y: 2, paving: { fill: "#c08a55", marks: [] } },
              { x: 99, y: 2, paving: { fill: "#c08a55", marks: [] } },
            ],
            blocks: [
              { x: 2, y: 2, glass: false, fill: hostile },
              { x: 2, y: Number.NaN, glass: false, fill: "#b8834f" },
            ],
          },
        ],
        floorPlan: true,
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

  it("draws a roof's slopes and what stands on its ridge (RFC 0041)", () => {
    const base = samplePlot("Wren");
    // A gable over four tiles: the north row at the eave, the south row along the ridge.
    const tiles = [
      { x: 2, y: 2, h: [0, 0, 1, 1] },
      { x: 3, y: 2, h: [0, 0, 1, 1] },
    ];
    const roofed = (top?: { kind: "vane" | "flag" | "nest"; x: number; y: number }) =>
      plotSvg({ ...base, roofs: [{ fill: "#b8834f", tiles, ...(top ? { top } : {}) }] }, 420);

    // The covering, and nothing standing on it until something does.
    const bare = roofed();
    expect(bare).toContain('fill="#b8834f"');
    expect(bare).not.toContain("M3.28 2.5L3.72 2.5");

    // A vane is a cross with a pointer, on the tile the spec names and nowhere else.
    const vane = roofed({ kind: "vane", x: 3, y: 2 });
    expect(vane).toContain("M3.28 2.5L3.72 2.5M3.5 2.28L3.5 2.72");
    // A nest is a ring of twigs instead, and a ridge off the picture is drawn not at all.
    expect(roofed({ kind: "nest", x: 3, y: 2 })).toContain('r="0.2" fill="none"');
    expect(roofed({ kind: "vane", x: 99, y: 2 })).not.toContain("M99");
  });

  it("draws paths and flooring from their marks, and keeps them on the tile and in the palette", () => {
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

  it("draws flooring upstairs over the ground floor's tiles, its shadow falling further than a block's (RFC 0028)", () => {
    const base = samplePlot("Wren");
    const wall = { x: 2, y: 2, glass: false, fill: "#b8834f" };
    const loft = { fill: "#c08a56", marks: [] };
    const svg = plotSvg(
      {
        ...base,
        blocks: [wall],
        floors: [{ flooring: [{ x: 2, y: 2, paving: loft }], blocks: [] }],
      },
      420,
    );
    const ground = svg.indexOf('fill="#b8834f"');
    const flooring = svg.indexOf('<rect x="2" y="2" width="1.02" height="1.02" fill="#c08a56"/>');
    expect(ground).toBeGreaterThan(-1);
    expect(flooring).toBeGreaterThan(ground);
    // The floor's shadow falls 0.22 of a tile per floor, under its flooring and over the wall below.
    const shadow = svg.indexOf('<rect x="2.22" y="2.22" width="1" height="1"');
    expect(shadow).toBeGreaterThan(ground);
    expect(shadow).toBeLessThan(flooring);
    // From above, nothing under it is dimmed.
    expect(svg).not.toContain("rgba(43, 38, 32, 0.38)");
  });

  it("draws a sliver of the world round the plot, washed back behind it (issue #80)", () => {
    const svg = plotSvg(samplePlotInTown("Wren"), 420);
    // The box is the plot and a tile of the world on each side, so the plot fills four fifths.
    expect(svg).toContain('viewBox="0 0 10 10"');
    // The band outside the plot is washed with paper: a rect per side, none over the plot itself.
    const bands = (drawn: string) =>
      [
        ...drawn.matchAll(
          /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="rgba\(255, 250, 240, 0\.52\)"\/>/g,
        ),
      ].map((m) => m.slice(1, 5).join(" "));
    expect(bands(svg)).toEqual(["0 0 10 1", "0 9 10 1", "0 1 1 8", "9 1 1 8"]);
    // The wash goes over everything standing in the area and under the night, so the light is even.
    const neighbor = svg.indexOf('fill="#c9b393"');
    expect(neighbor).toBeGreaterThan(-1);
    expect(svg.indexOf("rgba(255, 250, 240, 0.52)")).toBeGreaterThan(neighbor);
    // The neighbor's own home stands in the sliver, drawn like any other hearth.
    expect([...svg.matchAll(/fill="#8a7f70"/g)]).toHaveLength(2);
    // A plot in the world's corner sits in the corner of its box, so two sides have no band.
    const corner = plotSvg(
      { ...samplePlotInTown("Wren"), surround: { cols: 10, rows: 10, x: 0, y: 0 } },
      420,
    );
    expect(bands(corner)).toEqual(["0 8 10 2", "8 0 2 8"]);
    // The plot alone is washed nowhere.
    expect(plotSvg(samplePlot("Wren"), 420)).not.toContain("rgba(255, 250, 240, 0.52)");
  });

  it("draws a hearth's chimney and its smoke held still (issue #80)", () => {
    const base = samplePlot("Wren");
    const svg = plotSvg(base, 420);
    // The chimney stands on the roof's right slope, and the roof covers its foot.
    const chimney = svg.indexOf(
      '<rect x="3.63" y="3.14" width="0.08" height="0.21" fill="#8a7f70"/>',
    );
    const roof = svg.indexOf('<path d="M3.14 3.44L3.5 3.11L3.86 3.44z" fill="#d9653a"/>');
    expect(chimney).toBeGreaterThan(-1);
    expect(roof).toBeGreaterThan(chimney);
    // Three puffs rise from the chimney top, each fainter, all after the roof.
    const puffs = [...svg.matchAll(/rgba\(246, 244, 240, (0\.55|0\.42|0\.3)\)/g)];
    expect(puffs.map((m) => m[1])).toEqual(["0.55", "0.42", "0.3"]);
    expect(svg.indexOf("rgba(246, 244, 240, 0.55)")).toBeGreaterThan(roof);
    // The puffs are paths, so the hearth's shadow stays the photo's only ellipse.
    expect(svg.match(/<ellipse/g)).toHaveLength(1);
    // No hearth, no chimney and no smoke.
    const cold = plotSvg({ ...base, hearth: undefined }, 420);
    expect(cold).not.toContain("#8a7f70");
    expect(cold).not.toContain("rgba(246, 244, 240,");
  });

  it("draws a floor's plan with what's under it dimmed where it has no flooring (RFC 0028)", () => {
    const dim = 'fill="rgba(43, 38, 32, 0.38)"';
    const above = plotSvg(sampleLoft("Wren"), 420);
    const plan = plotSvg(sampleLoft("Wren", 1), 420);
    // The loft's 19 tiles of flooring (the hut's 4 rows of 5, but the stairwell) stay bright, the
    // other 45 of the plot's 64 tiles are dimmed, and the loft is drawn over them.
    expect(plan.split(dim).length - 1).toBe(64 - 19);
    expect(plan.lastIndexOf(dim)).toBeLessThan(plan.lastIndexOf('fill="#c08a55"'));
    expect(above).not.toContain(dim);
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
    // Fruit set before they ripen (issue #80), so a half-grown tomato reads as a tomato rather
    // than as the same green sprout every other crop would be.
    const circles = (svg: string) => (svg.match(/<circle/g) ?? []).length;
    const berry = (done: number) => circles(grown("strawberry", done, "#d9434f"));
    expect(berry(0.7) - berry(0.3)).toBe(3);
    expect(grown("strawberry", 0.7, "#d9434f")).not.toBe(grown("strawberry", 0.9, "#d9434f"));
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

  it("draws a recorded figure only from parts that check out: path data, colors, and its own clips and tiles", () => {
    const hostile = {
      box: [-62, -120, 124, 138],
      shapes: [
        { d: "M0 0L10 10Z", fill: "#df7a3c", clip: [0, 7] },
        { d: 'M0 0"/><script>x</script>', fill: "#ffffff" },
        { d: "M1 1L2 2", stroke: 'red" onload="x()', width: Number.NaN, cap: "url(#x)" },
        { d: "M2 2L3 3Z", tile: 5, alpha: 7 },
        { d: "M3 3L4 4Z", tile: 0, alpha: 0.5 },
      ],
      clips: ['M0 0"/><image href="x'],
      tiles: [{ size: 18, at: [1, 0, 0, 1, "x"], shapes: [{ d: "M0 0L1 1Z", fill: "#ffffff" }] }],
    } as unknown as Drawing;
    const svg = drawingSvg(hostile, "f0");
    expect(svg).not.toMatch(/<script|<image|href|onload|NaN|url\(#x\)|red"/);
    expect(svg).toContain('<clipPath id="f0c0"><path d="M0 0Z"/></clipPath>');
    // A clip it doesn't have is dropped; one it has wraps the shape.
    expect(svg).toContain('<g clip-path="url(#f0c0)"><path d="M0 0L10 10Z" fill="#df7a3c"/></g>');
    expect(svg).toContain('stroke="#b3ab9b"');
    expect(svg).toContain('<path d="M2 2L3 3Z" fill="none"/>');
    expect(svg).toContain('<path d="M3 3L4 4Z" fill="url(#f0t0)" opacity="0.5"/>');
    expect(svg).not.toContain("patternTransform");
    // Ids are ours alone.
    expect(drawingSvg(sampleFigure(), '"><script>')).toBe("");
  });

  it("keeps the map around someone our own markup, whatever the light and sky say", () => {
    const odd = nearSvg(
      sampleNear("Wren", { sky: { night: Number.NaN, weather: "<script>" as never } }),
      1040,
      430,
    );
    expect(odd).not.toMatch(/<script|NaN|radialGradient/);
    const night = nearSvg(sampleNear("Wren", { sky: { night: 1, weather: "snow" } }), 1040, 430);
    expect(night).toContain("radialGradient");
    expect(night).toContain('fill="rgba(255, 255, 255, 0.9)"');
    // Figures are scaled from the figure's units, a tile to a hundred, and stand where they're put.
    expect(night).toContain('<g transform="translate(11.5 6.88) scale(0.01)">');
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
