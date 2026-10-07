import { describe, expect, it } from "vitest";
import { IMMUTABLE, pageHeaders } from "./pages";

describe("pageHeaders", () => {
  it("lets browsers keep only the build's hashed files for good", () => {
    expect(pageHeaders("/assets/reference-DXW_AsQ9.js", "text/javascript")).toEqual({
      "cache-control": IMMUTABLE,
    });
    expect(pageHeaders("/assets/docs-BXsBDB6I.css", "text/css")["cache-control"]).toBe(IMMUTABLE);
    // The single-page fallback under /assets/ is never immutable.
    expect(
      pageHeaders("/assets/gone-0000aaaa.js", "text/html; charset=utf-8")["cache-control"],
    ).toBe(undefined);
    // Pages and unhashed files revalidate.
    expect(pageHeaders("/docs", "text/html")["cache-control"]).toBe(undefined);
    expect(pageHeaders("/favicon.svg", "image/svg+xml")["cache-control"]).toBe(undefined);
    expect(pageHeaders("/brand/mark.svg", "image/svg+xml")["cache-control"]).toBe(undefined);
  });
});
