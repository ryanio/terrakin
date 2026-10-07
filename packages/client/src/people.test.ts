import { describe, expect, it } from "vitest";
import { peopleEmpty, peoplePath, tabCount } from "./people-view";
import { matchRoute, routeTemplate } from "./router";

describe("people pages", () => {
  it("routes followers, following, and friends, and keeps ids out of analytics", () => {
    for (const tab of ["followers", "following", "friends"] as const) {
      const route = matchRoute(peoplePath("r_abc", tab));
      expect(route).toEqual({ name: "people", id: "r_abc", tab });
      expect(routeTemplate(route)).toBe(`/r/:id/${tab}`);
    }
    expect(matchRoute("/r/r_abc/enemies").name).toBe("not-found");
  });

  it("counts each tab from the profile", () => {
    const r = { followers: 3, following: 5, friends: 2 };
    expect(tabCount(r, "followers")).toBe(3);
    expect(tabCount(r, "following")).toBe(5);
    expect(tabCount(r, "friends")).toBe(2);
  });

  it("talks to you on your own page and about them on theirs", () => {
    expect(peopleEmpty("following", "Wren", true)[0]).toBe("You don't follow anyone yet");
    expect(peopleEmpty("following", "Wren", false)[1]).toContain("Wren");
    expect(peopleEmpty("friends", "Wren", false)[1]).toContain("follow back");
  });
});
