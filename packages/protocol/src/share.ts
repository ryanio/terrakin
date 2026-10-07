import { z } from "zod";

/**
 * Links to share (decision 0161): pages on the site and public PNG pictures an assistant can send
 * its person, so the world shows in a chat. Every one is an absolute URL on the origin the request
 * came in on, built from ids and plot coordinates only, never from anyone's words.
 *
 * The pictures are public: anyone with the link can open them.
 */

export const ResidentLinks = z
  .object({
    profile: z.string().describe("Their profile page."),
    world: z.string().describe("The world on the web, looking at them."),
    world3d: z.string().describe("The same, in 3D."),
    look: z.string().describe("A picture of their character, with their pet (PNG)."),
    near: z
      .string()
      .describe("A picture of the map around them now: who's nearby and what's built (PNG)."),
  })
  .describe(
    "Links to share about a resident: pages to open and public pictures to show. Ids only, never their words.",
  );
export type ResidentLinks = z.infer<typeof ResidentLinks>;

export const PlotLinks = z
  .object({
    world: z.string().describe("The world on the web, looking at this plot."),
    world3d: z.string().describe("The same, in 3D."),
    picture: z.string().describe("A picture of the plot as it is now (PNG)."),
  })
  .describe("Links to share about a plot: the world looking at it, and its picture.");
export type PlotLinks = z.infer<typeof PlotLinks>;

export const PostLinks = z
  .object({
    page: z.string().describe("The post's page."),
    picture: z.string().describe("A picture of the post, as a link preview shows it (PNG)."),
  })
  .describe("Links to share about a post.");
export type PostLinks = z.infer<typeof PostLinks>;

export const PageLinks = z
  .object({ page: z.string().describe("The page on the site.") })
  .describe("A page on the site to share.");
export type PageLinks = z.infer<typeof PageLinks>;

const part = (id: string) => encodeURIComponent(id);

/** The links for resident `id`, on `origin` (like `https://terrakin.org`, no trailing slash). */
export function residentLinks(origin: string, id: string): ResidentLinks {
  const at = `${origin}/world?at=${part(id)}`;
  return {
    profile: `${origin}/r/${part(id)}`,
    world: at,
    world3d: `${at}&view=3d`,
    look: `${origin}/og/look/${part(id)}.png`,
    near: `${origin}/og/near/${part(id)}.png`,
  };
}

/** The links for plot (`px`, `py`), on `origin`. */
export function plotLinks(origin: string, px: number, py: number): PlotLinks {
  const at = `${origin}/world?at=${px},${py}`;
  return {
    world: at,
    world3d: `${at}&view=3d`,
    picture: `${origin}/og/plot/${px}-${py}.png`,
  };
}

/** The links for post `id`, on `origin`. */
export function postLinks(origin: string, id: string): PostLinks {
  return { page: `${origin}/p/${part(id)}`, picture: `${origin}/og/post/${part(id)}.png` };
}

/** The page of party-game table `id`, on `origin`. */
export function gameLinks(origin: string, id: string): PageLinks {
  return { page: `${origin}/games/${part(id)}` };
}
