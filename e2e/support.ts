import { type APIRequestContext, expect, type Page } from "@playwright/test";

/**
 * Helpers specs share: joining and acting over the REST API, signing a page in, finding free
 * plots in the shared world, and watching for errors a user would hit. New specs use these
 * instead of writing their own.
 */

export interface Resident {
  id: string;
  token: string;
}

export async function join(request: APIRequestContext, name: string): Promise<Resident> {
  const res = await request.post("/v1/session", { data: { name, kind: "human" } });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return { id: body.residentId as string, token: body.token as string };
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

/** Open pages as `who`, the way the app remembers a resident. */
export async function signIn(page: Page, who: Resident) {
  await page.addInitScript(
    ([token, id]) => {
      localStorage.setItem("terrakin.token", token);
      localStorage.setItem("terrakin.resident", id);
    },
    [who.token, who.id] as const,
  );
}

/** Unclaimed plots, read from the shared world (other specs settle too), skipping the Commons. */
export async function freePlots(
  request: APIRequestContext,
  n: number,
): Promise<[number, number][]> {
  const world = await (await request.get("/v1/world")).json();
  const { width, height, plotSize } = world.config;
  const taken = new Set(world.plots.map((p: { px: number; py: number }) => `${p.px},${p.py}`));
  taken.add(`${world.commons.px},${world.commons.py}`);
  const out: [number, number][] = [];
  for (let py = height / plotSize - 1; py >= 0 && out.length < n; py--) {
    for (let px = width / plotSize - 1; px >= 0 && out.length < n; px--) {
      if (!taken.has(`${px},${py}`)) out.push([px, py]);
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

/** Page errors and Content-Security-Policy refusals, which fail a test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

/** Whether the page scrolls sideways: it never should on a phone. */
export async function overflowsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}
