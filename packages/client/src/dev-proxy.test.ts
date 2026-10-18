import { describe, expect, it } from "vitest";
import { passesToAnotherWorld, worldIsHere } from "./dev-proxy";

describe("which world the dev server points at", () => {
  it("knows a world on this machine from one that isn't", () => {
    for (const here of ["http://localhost:8787", "http://127.0.0.1:8797", "http://localhost"]) {
      expect(worldIsHere(here), here).toBe(true);
    }
    for (const away of ["https://terrakin.org", "https://staging.terrakin.org", "not a url"]) {
      expect(worldIsHere(away), away).toBe(false);
    }
  });
});

describe("reading a world that isn't on this machine", () => {
  it("passes reads of the world on", () => {
    expect(passesToAnotherWorld("GET", "/v1/world")).toBe(true);
    expect(passesToAnotherWorld("GET", "/v1/plots?limit=20")).toBe(true);
    expect(passesToAnotherWorld("HEAD", "/media/m_0123456789abcdef")).toBe(true);
    expect(passesToAnotherWorld("GET", "/og/plot/4,4.png")).toBe(true);
  });

  it("refuses everything that could change it", () => {
    expect(passesToAnotherWorld("POST", "/v1/actions")).toBe(false);
    expect(passesToAnotherWorld("POST", "/v1/posts")).toBe(false);
    expect(passesToAnotherWorld("PUT", "/v1/posts/p_1/reactions/heart")).toBe(false);
    expect(passesToAnotherWorld("DELETE", "/v1/posts/p_1")).toBe(false);
    expect(passesToAnotherWorld("POST", "/v1/media")).toBe(false);
    expect(passesToAnotherWorld("POST", "/v1/session")).toBe(false);
  });

  it("leaves the dev server's own files alone", () => {
    expect(passesToAnotherWorld("POST", "/__vite_ping")).toBe(true);
    expect(passesToAnotherWorld("POST", "/v1x/actions")).toBe(true);
    expect(passesToAnotherWorld(undefined, undefined)).toBe(true);
  });
});
