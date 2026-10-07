import { describe, expect, it } from "vitest";
import { MEDIA_TYPES } from "../../packages/protocol/src/index";
import { checkPortrait, IMAGE_MAX_BYTES, parsePicks, planAvatar } from "./avatar-plan.ts";
import { PERSONAS } from "./personas.ts";

const HANDLES = PERSONAS.map((p) => p.handle);

/** The first 24 bytes of a PNG: the signature and an IHDR of `w` by `h`. */
function png(w: number, h: number, size = 1_000): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, w);
  view.setUint32(20, h);
  return bytes;
}

describe("parsePicks", () => {
  it("reads handle=number for any of the townsfolk", () => {
    const picked = parsePicks("juniper=1, bram=2,", HANDLES);
    expect(picked.ok && [...picked.picks]).toEqual([
      ["juniper", 1],
      ["bram", 2],
    ]);
  });

  it("refuses a stranger, a repeat, a zero, a bad shape, and nothing at all", () => {
    for (const [spec, error] of [
      ["ryan=1", /isn't townsfolk/],
      ["pip=1,pip=2", /twice/],
      ["pip=0", /start at 1/],
      ["pip:1", /handle=number/],
      ["", /no picks/],
    ] as const) {
      const picked = parsePicks(spec, HANDLES);
      expect(picked.ok ? "" : picked.error, spec).toMatch(error);
    }
  });
});

describe("checkPortrait", () => {
  it("takes a square PNG and turns away anything else", () => {
    expect(IMAGE_MAX_BYTES).toBe(MEDIA_TYPES["image/png"].maxBytes);
    expect(checkPortrait(png(512, 512))).toBeUndefined();
    expect(checkPortrait(png(512, 384))).toMatch(/not square/);
    expect(checkPortrait(png(64, 64))).toMatch(/under 256/);
    expect(checkPortrait(png(512, 512, 5_000_001))).toMatch(/upload cap/);
    const jpeg = png(512, 512);
    jpeg.set([0xff, 0xd8, 0xff]);
    expect(checkPortrait(jpeg)).toMatch(/isn't a PNG/);
  });
});

describe("planAvatar", () => {
  const file = "juniper-1.png";
  const portrait = { sha256: "abc", media: "m_0000000000000001" };
  const base = { file, bytes: png(512, 512), sha256: "abc", stored: {}, avatar: null };

  it("sets a portrait the profile doesn't show yet", () => {
    expect(planAvatar(base)).toEqual({ kind: "set", file });
    // The drawn avatar from the seed is replaced.
    expect(planAvatar({ ...base, avatar: "/media/m_00000000000000aa" }).kind).toBe("set");
    // Another candidate than the one set before.
    expect(
      planAvatar({
        ...base,
        sha256: "def",
        stored: { portrait },
        avatar: "/media/m_0000000000000001",
      }).kind,
    ).toBe("set");
    // Someone changed the avatar since.
    expect(
      planAvatar({ ...base, stored: { portrait }, avatar: "/media/m_00000000000000aa" }).kind,
    ).toBe("set");
  });

  it("leaves a profile that already shows the picked portrait", () => {
    expect(
      planAvatar({ ...base, stored: { portrait }, avatar: "/media/m_0000000000000001" }),
    ).toEqual({ kind: "done", file });
  });

  it("skips a persona that isn't seeded, and a file that's missing or won't do", () => {
    expect(planAvatar({ ...base, stored: undefined })).toEqual({ kind: "unseeded" });
    expect(planAvatar({ ...base, bytes: undefined })).toMatchObject({
      kind: "bad",
      problem: "isn't there",
    });
    expect(planAvatar({ ...base, bytes: png(300, 200) })).toMatchObject({ kind: "bad" });
  });
});
