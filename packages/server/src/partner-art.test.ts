import { isExclusiveWear } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { cat, jpegWithExif, mp4WithGps } from "./media-fixtures";
import { ART_MAX_BYTES, httpArtReader } from "./partner-art";
import { MUSEGOD, PARTNERS, partnerArtUrl, partnerItems, promoRuns } from "./partners";

const jpeg = () => jpegWithExif();
const image = (bytes: Uint8Array, type = "image/jpeg", status = 200) =>
  new Response(bytes as Uint8Array<ArrayBuffer>, { status, headers: { "content-type": type } });

/** A reader whose host answers `res`, counting what it was asked. */
function reader(res: (url: string) => Response | Promise<Response>) {
  const asked: string[] = [];
  const read = httpArtReader({
    fetch: async (url) => {
      asked.push(String(url));
      return res(String(url));
    },
  });
  return { read, asked };
}

describe("the partner art reader", () => {
  it("reads a JPEG from https", async () => {
    const { read } = reader(() => image(jpeg()));
    const got = await read("https://musegod.org/muse/art/480/464.jpg");
    expect(got.ok).toBe(true);
  });

  // The address rules are fetchOutside's, which the card reader's table in chain.test.ts holds.
  // These show art reads through them, and that art, unlike a card, is never inline.
  it.each(["http://musegod.org/muse/art/480/464.jpg", "data:image/jpeg;base64,/9j/"])(
    "refuses %s before fetching",
    async (url) => {
      const { read, asked } = reader(() => image(jpeg()));
      expect(await read(url)).toMatchObject({ ok: false, bad: true });
      expect(asked).toEqual([]);
    },
  );

  it("follows redirects only to addresses that pass the same rules", async () => {
    const { read, asked } = reader((url) =>
      url.endsWith("/a")
        ? new Response(null, { status: 302, headers: { location: "http://10.0.0.1/b" } })
        : image(jpeg()),
    );
    expect(await read("https://art.example/a")).toMatchObject({ ok: false, bad: true });
    expect(asked).toEqual(["https://art.example/a"]);
  });

  it("asks allowHost first, so Node never fetches from a private address", async () => {
    let fetched = 0;
    const read = httpArtReader({
      allowHost: async (host) => host !== "private.example",
      fetch: async () => {
        fetched++;
        return image(jpeg());
      },
    });
    expect(await read("https://private.example/a.jpg")).toMatchObject({ ok: false, bad: true });
    expect(fetched).toBe(0);
  });

  it("refuses art over the size cap", async () => {
    const big = cat([0xff, 0xd8, 0xff, 0xe0], new Uint8Array(ART_MAX_BYTES));
    const { read } = reader(() => image(big));
    expect(await read("https://art.example/big.jpg")).toMatchObject({
      ok: false,
      bad: true,
      message: "The art is too big.",
    });
  });

  it("refuses anything that doesn't say it is an image we take", async () => {
    for (const type of ["text/html", "image/svg+xml", "application/octet-stream", ""]) {
      const { read } = reader(() => image(jpeg(), type));
      expect(await read("https://art.example/a.jpg")).toMatchObject({ ok: false, bad: true });
    }
  });

  it("refuses bytes that aren't an image, whatever the host says", async () => {
    for (const bytes of [mp4WithGps(), new TextEncoder().encode("<svg onload=alert(1)>")]) {
      const { read } = reader(() => image(bytes, "image/jpeg"));
      expect(await read("https://art.example/a.jpg")).toMatchObject({ ok: false, bad: true });
    }
  });

  it("says the host is down on errors, and that a missing picture is missing", async () => {
    expect(
      await reader(() => image(jpeg(), "image/jpeg", 500)).read("https://a.example/x.jpg"),
    ).toMatchObject({ ok: false, bad: false });
    expect(
      await reader(() => {
        throw new Error("timeout");
      }).read("https://a.example/x.jpg"),
    ).toMatchObject({ ok: false, bad: false });
    expect(
      await reader(() => image(jpeg(), "image/jpeg", 404)).read("https://a.example/x.jpg"),
    ).toMatchObject({ ok: false, bad: true });
  });
});

describe("partner art in the config", () => {
  it("is on each partner's own https site, never somewhere else", () => {
    for (const partner of PARTNERS) {
      const url = partnerArtUrl(partner, "1");
      if (!url) continue;
      const art = new URL(url);
      expect(art.protocol).toBe("https:");
      expect(art.hostname).toBe(new URL(partner.url).hostname);
      expect(url).not.toContain("{");
    }
  });

  it("names the muse's 480 px cut", () => {
    const musegod = PARTNERS.find((p) => p.id === "musegod");
    expect(musegod && partnerArtUrl(musegod, "464")).toBe(
      "https://musegod.org/muse/art/480/464.jpg",
    );
  });
});

describe("partner wear and promos in the config", () => {
  it("names only partner wear, and promos with real UTC days in order", () => {
    for (const partner of PARTNERS) {
      for (const item of partner.perks.items ?? []) expect(isExclusiveWear(item)).toBe(true);
      for (const promo of partner.promos ?? []) {
        expect(promo.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(promo.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Date.parse(`${promo.from}T00:00:00Z`)).toBeLessThan(
          Date.parse(`${promo.until}T00:00:00Z`),
        );
        for (const item of promo.perks.items ?? []) expect(isExclusiveWear(item)).toBe(true);
      }
    }
  });

  it("runs a promo from its first day up to, not including, its last", () => {
    const promo = { id: "p", from: "2026-11-01", until: "2026-12-01", perks: {} };
    const lantern = [
      { ...MUSEGOD, promos: [{ ...promo, perks: { items: ["muse_lantern" as const] } }] },
    ];
    expect(promoRuns(promo, Date.UTC(2026, 9, 31, 23, 59))).toBe(false);
    expect(promoRuns(promo, Date.UTC(2026, 10, 1))).toBe(true);
    expect(promoRuns(promo, Date.UTC(2026, 10, 30, 23, 59))).toBe(true);
    expect(promoRuns(promo, Date.UTC(2026, 11, 1))).toBe(false);
    expect(partnerItems("musegod", "464", Date.UTC(2026, 10, 5), lantern)).toEqual([
      "muse_halo",
      "muse_lantern",
    ]);
    expect(partnerItems("musegod", "464", Date.UTC(2026, 9, 5), lantern)).toEqual(["muse_halo"]);
    expect(partnerItems("musegod", "464", Date.UTC(2026, 10, 5))).toEqual(["muse_halo"]);
    expect(partnerItems("musegod", "0", Date.UTC(2026, 9, 5))).toEqual([]);
    expect(partnerItems("nobody", "1", Date.UTC(2026, 9, 5))).toEqual([]);
  });
});
