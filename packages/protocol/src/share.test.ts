import { describe, expect, it } from "vitest";
import { CheckinResponse } from "./checkin";
import { EventView } from "./events";
import { GalleryView } from "./galleries";
import { YourMoveView } from "./games";
import { PlotView } from "./plots";
import {
  gameLinks,
  PageLinks,
  PlotLinks,
  PostLinks,
  plotLinks,
  postLinks,
  ResidentLinks,
  residentLinks,
} from "./share";
import { AuthorView, NotificationView, PostView, ProfileView } from "./social";

/** Links to share (decision 0161): the URLs the pictures and the web's deep links answer. */

const ORIGIN = "https://example.test";

describe("links to share", () => {
  it("builds each link on the origin it's given, from ids and plot coordinates", () => {
    expect(residentLinks(ORIGIN, "r_0123456789abcdef")).toEqual({
      profile: "https://example.test/r/r_0123456789abcdef",
      world: "https://example.test/world?at=r_0123456789abcdef",
      world3d: "https://example.test/world?at=r_0123456789abcdef&view=3d",
      look: "https://example.test/og/look/r_0123456789abcdef.png",
      near: "https://example.test/og/near/r_0123456789abcdef.png",
    });
    expect(plotLinks(ORIGIN, 3, 2)).toEqual({
      world: "https://example.test/world?at=3,2",
      world3d: "https://example.test/world?at=3,2&view=3d",
      picture: "https://example.test/og/plot/3-2.png",
    });
    expect(postLinks(ORIGIN, "p_1")).toEqual({
      page: "https://example.test/p/p_1",
      picture: "https://example.test/og/post/p_1.png",
    });
    expect(gameLinks(ORIGIN, "g_1")).toEqual({ page: "https://example.test/games/g_1" });
    // An id is one path segment and one query value, whatever it holds.
    expect(residentLinks(ORIGIN, "a/b&c").world).toBe("https://example.test/world?at=a%2Fb%26c");
  });

  it("is in the schemas wherever a resident, a plot, a post, an event, or a table is shared", () => {
    expect(ResidentLinks.parse(residentLinks(ORIGIN, "r_1"))).toBeTruthy();
    expect(PlotLinks.parse(plotLinks(ORIGIN, 0, 0))).toBeTruthy();
    expect(PostLinks.parse(postLinks(ORIGIN, "p_1"))).toBeTruthy();
    expect(PageLinks.parse(gameLinks(ORIGIN, "g_1"))).toBeTruthy();
    const where = [
      [ProfileView.shape.links, ResidentLinks],
      [AuthorView.shape.links, ResidentLinks],
      [PostView.shape.links, PostLinks],
      [NotificationView.shape.links, PostLinks],
      [PlotView.shape.links, PlotLinks],
      [GalleryView.shape.links, PlotLinks],
      [EventView.shape.place.shape.links, PlotLinks],
      [YourMoveView.shape.links, PageLinks],
    ] as const;
    for (const [field, links] of where) {
      expect(field.unwrap()).toBe(links);
      // Optional: a view read where nothing is shared leaves them out.
      expect(field.safeParse(undefined).success).toBe(true);
    }
    // The check-in always has the caller's own, and their plot's when they live on one.
    const links = CheckinResponse.shape.links;
    expect(links.safeParse({ you: residentLinks(ORIGIN, "r_1") }).success).toBe(true);
    expect(links.safeParse({}).success).toBe(false);
  });
});
