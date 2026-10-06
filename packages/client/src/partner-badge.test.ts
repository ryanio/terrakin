import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PARTNER_BORDERS, PROFILE_DESIGNS } from "@terrakin/protocol";
import { RESIDENT_COLORS } from "@terrakin/sim";
import { isPartnerArt } from "@terrakin/ui/format";
import { describe, expect, it } from "vitest";
import { BANNER_H, BANNER_W, designShapes } from "./banner-art";
import { profileDesign } from "./partner-badge";

const ROOT = join(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("partner art", () => {
  it("draws only our own copies of partner marks", () => {
    expect(isPartnerArt("/partners/musegod/badge.svg")).toBe(true);
    for (const url of [
      "https://musegod.org/badge.svg",
      "//evil.example/partners/musegod/badge.svg",
      "/partners/../media/m_0123456789abcdef",
      "/partners/musegod/badge.png",
      "/partners/MuseGod/badge.svg",
      "javascript:alert(1)",
      undefined,
    ]) {
      expect(isPartnerArt(url), String(url)).toBe(false);
    }
  });
});

describe("the curated borders and profile designs (decision 0058)", () => {
  it("has a ring in base.css for every border, and styles for every design", () => {
    const base = read("packages/ui/src/base.css");
    for (const border of PARTNER_BORDERS) expect(base).toContain(`.avatar.ring-${border} {`);
    const app = read("packages/client/src/style.css");
    for (const design of PROFILE_DESIGNS) {
      expect(app).toContain(`.profile[data-design="${design}"] {`);
    }
  });

  it("wears only designs from the curated set", () => {
    const partner = { id: "x", name: "X", label: "X #1", badge: "", url: "" };
    expect(profileDesign({ partner: { ...partner, profile: "velvet" } })).toBe("velvet");
    expect(profileDesign({ partner })).toBeNull();
    expect(profileDesign({})).toBeNull();
    // A newer server's design this client doesn't know draws the usual profile.
    expect(profileDesign({ partner: { ...partner, profile: "neon" as "velvet" } })).toBeNull();
  });

  it("draws each design's header from resident colors, the same every time, within the banner", () => {
    for (const design of PROFILE_DESIGNS) {
      const shapes = designShapes(design);
      expect(shapes).toEqual(designShapes(design));
      expect(shapes.length).toBeGreaterThan(3);
      expect(shapes[0]?.attrs).toMatchObject({ x: 0, y: 0, width: BANNER_W, height: BANNER_H });
      for (const shape of shapes) {
        expect(RESIDENT_COLORS).toContain(shape.color);
        expect(shape.opacity).toBeGreaterThan(0);
        expect(shape.opacity).toBeLessThanOrEqual(1);
        for (const v of Object.values(shape.attrs)) {
          expect(String(v)).not.toMatch(/NaN|Infinity|undefined/);
        }
      }
    }
  });
});
