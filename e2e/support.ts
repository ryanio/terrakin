import { type APIRequestContext, expect, type Page } from "@playwright/test";

/**
 * Helpers specs share: joining and acting over the REST API, signing a page in, finding free
 * plots in the shared world, and watching for errors a user would hit. New specs use these
 * instead of writing their own.
 */

export interface Resident {
  id: string;
  token: string;
  /** The `authorization` header for requests as this resident. */
  auth: { authorization: string };
}

export interface JoinOptions {
  kind?: "human" | "agent";
  color?: string;
  /**
   * Keep trying for up to 90 seconds when the server refuses, for a spec that joins after others
   * have spent the per-IP budget for new sessions.
   */
  retry?: boolean;
}

/** A new resident over the API, a human unless `kind` says otherwise. */
export async function join(
  request: APIRequestContext,
  name: string,
  { kind = "human", color, retry = false }: JoinOptions = {},
): Promise<Resident> {
  const data = color === undefined ? { name, kind } : { name, kind, color };
  let body: { residentId: string; token: string } | undefined;
  const attempt = async () => {
    const res = await request.post("/v1/session", { data });
    expect(res.ok()).toBe(true);
    body = await res.json();
  };
  if (retry) await expect(attempt).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });
  else await attempt();
  if (!body) throw new Error("no session");
  return {
    id: body.residentId,
    token: body.token,
    auth: { authorization: `Bearer ${body.token}` },
  };
}

/** A world action. The body says whether the rules took it: check `ok`. */
export async function act(request: APIRequestContext, token: string, action: unknown) {
  const res = await request.post("/v1/actions", {
    headers: { authorization: `Bearer ${token}` },
    data: action,
  });
  return res.json();
}

/** A GET with your token, parsed. */
export async function read(request: APIRequestContext, token: string, path: string) {
  const res = await request.get(path, { headers: { authorization: `Bearer ${token}` } });
  expect(res.ok()).toBe(true);
  return res.json();
}

/**
 * Open pages as `who`, the way the app remembers a resident. With `now`, sign in only the page as
 * it is, so pages opened later (on the admin host, say) start signed out.
 */
export async function signIn(
  page: Page,
  who: Pick<Resident, "id" | "token">,
  { now = false } = {},
) {
  const save = ([token, id]: readonly [string, string]) => {
    localStorage.setItem("terrakin.token", token);
    localStorage.setItem("terrakin.resident", id);
  };
  if (now) await page.evaluate(save, [who.token, who.id] as const);
  else await page.addInitScript(save, [who.token, who.id] as const);
}

/**
 * Unclaimed plots, read from the shared world (other specs settle too), skipping the Commons. The
 * search starts in `corner` and goes a row at a time.
 */
export async function freePlots(
  request: APIRequestContext,
  n: number,
  corner: "bottom-right" | "bottom-left" | "top-right" = "bottom-right",
): Promise<[number, number][]> {
  const world = await (await request.get("/v1/world")).json();
  const { width, height, plotSize } = world.config;
  const taken = new Set(world.plots.map((p: { px: number; py: number }) => `${p.px},${p.py}`));
  taken.add(`${world.commons.px},${world.commons.py}`);
  const span = (size: number, backwards: boolean) => {
    const all = Array.from({ length: size / plotSize }, (_, i) => i);
    return backwards ? all.reverse() : all;
  };
  const out: [number, number][] = [];
  for (const py of span(height, corner !== "top-right")) {
    for (const px of span(width, corner !== "bottom-left")) {
      if (out.length < n && !taken.has(`${px},${py}`)) out.push([px, py]);
    }
  }
  return out;
}

/** Join, settle a free plot, and build the starter home, which puts you on your hearth. */
export async function settler(request: APIRequestContext, name: string) {
  const who = await join(request, name);
  const [plot] = await freePlots(request, 1);
  if (!plot) throw new Error("No free plots left in the test world");
  expect((await act(request, who.token, { type: "settle", px: plot[0], py: plot[1] })).ok).toBe(
    true,
  );
  expect((await act(request, who.token, { type: "build_starter_home" })).ok).toBe(true);
  return who;
}

/** Move the shared test clock to the next UTC day. Only for specs in their own project. */
export async function advanceDay(request: APIRequestContext) {
  expect((await request.post("/v1/test/advance-day")).ok()).toBe(true);
}

export interface WatchOptions {
  /** Fail on any dialog the page opens (and dismiss it). */
  dialogs?: boolean;
  /** Which console errors fail: Content-Security-Policy refusals (the default), all, or none. */
  console?: "csp" | "all" | "none";
}

/** Page errors and Content-Security-Policy refusals, which fail a test. */
export function watchErrors(
  page: Page,
  { dialogs = false, console: logged = "csp" }: WatchOptions = {},
): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (logged !== "none") {
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      if (logged === "all" || /Content.Security.Policy/i.test(m.text())) errors.push(m.text());
    });
  }
  if (dialogs) {
    page.on("dialog", (d) => {
      errors.push(`unexpected dialog: ${d.message()}`);
      void d.dismiss();
    });
  }
  return errors;
}

/** Whether the page scrolls sideways: it never should on a phone. */
export async function overflowsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

/**
 * Cards on the page stacked so close they touch: each as "class -> class: Npx". Two paper
 * surfaces one above the other need at least `min` pixels between them.
 */
export async function touchingCards(page: Page, min = 8): Promise<string[]> {
  return page.evaluate((min) => {
    const shown = (el: Element) => el.checkVisibility();
    const out: string[] = [];
    for (const el of document.querySelectorAll(".paper")) {
      let next = el.nextElementSibling;
      while (next && !shown(next)) next = next.nextElementSibling;
      if (!next?.matches(".paper") || !shown(el)) continue;
      const a = el.getBoundingClientRect();
      const b = next.getBoundingClientRect();
      const gap = b.top - a.bottom;
      // Side by side (a grid of cards) is fine; only one under the other counts.
      if (b.top >= a.bottom - 1 && gap < min)
        out.push(`${el.className} -> ${next.className}: ${Math.round(gap)}px`);
    }
    return out;
  }, min);
}
