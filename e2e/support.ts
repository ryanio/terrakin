import { crc32, deflateSync } from "node:zlib";
import { type APIRequestContext, expect, type Page } from "@playwright/test";
import {
  freePlotsOver,
  type Http,
  isPreset,
  makePersona,
  openRecipesOver,
  type Persona,
  type PersonaSpec,
  type PresetName,
  settleFreeOver,
  stage,
} from "./personas";

/**
 * Helpers specs share: joining and acting over the REST API, signing a page in, finding free
 * plots in the shared world, tapping a tile on the map, running the server's minute sweep, and
 * watching for errors a user would hit. New specs use these instead of writing their own.
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
  return freePlotsOver(httpOf(request), n, corner);
}

/**
 * Settle the first of `plots` that's still free when asked, and return it. Specs share one world
 * and run side by side, so a free plot can be taken between reading the world and settling it;
 * then the next one is tried. Never settle a fixed plot: another spec may have it.
 */
export async function settleFree(
  request: APIRequestContext,
  token: string,
  plots: readonly (readonly [number, number])[],
): Promise<[number, number]> {
  return settleFreeOver(httpOf(request), token, plots);
}

/** Playwright's request context as the `Http` that `personas.ts` builds residents over. */
export function httpOf(request: APIRequestContext): Http {
  return {
    async call(method, path, { token, data } = {}) {
      const headers = token ? { authorization: `Bearer ${token}` } : {};
      const res =
        method === "GET"
          ? await request.get(path, { headers })
          : await request.post(path, { headers, ...(data === undefined ? {} : { data }) });
      const text = await res.text();
      return { status: res.status(), body: text ? JSON.parse(text) : null };
    },
  };
}

/**
 * A resident at a stage, built over the API (`personas.ts`): a preset by name with `spec` on top,
 * or a spec of its own. `persona(request, "stocked", { name: "Ivy" })` is settled on a free plot
 * with coins and things; coins, things, and staff need the test clock, which every e2e server has.
 */
export async function persona(
  request: APIRequestContext,
  preset: PresetName | PersonaSpec,
  spec?: PersonaSpec,
): Promise<Persona & { auth: { authorization: string } }> {
  if (typeof preset === "string" && !isPreset(preset)) throw new Error(`no preset ${preset}`);
  const full =
    typeof preset === "string" ? stage(preset, spec ?? { name: preset }) : { ...preset, ...spec };
  const made = await makePersona(httpOf(request), full);
  return { ...made, auth: { authorization: `Bearer ${made.token}` } };
}

/**
 * Switch recipes you learn on now (RFC 0024): residents made before it know every recipe, and those
 * made after start with free picks. Once per server, so only for a spec with a server of its own.
 */
export async function openRecipes(request: APIRequestContext) {
  await openRecipesOver(httpOf(request));
}

/** Join, settle a free plot, and build the starter home, which puts you on your hearth. */
export async function settler(request: APIRequestContext, name: string) {
  const who = await join(request, name);
  await settleFree(request, who.token, await freePlots(request, 5));
  expect((await act(request, who.token, { type: "build_starter_home" })).ok).toBe(true);
  return who;
}

/** The camera eases toward you; wait enough frames for it to land before tapping tiles. */
async function settleCamera(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let frames = 40;
        const tick = () => (--frames <= 0 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
}

/**
 * On the 2D map at /world, tap the tile `dx`, `dy` from where you stand (the middle of the screen),
 * once the loader a returning resident sees has stepped aside.
 */
export async function tapTile(page: Page, dx: number, dy: number) {
  const vp = page.viewportSize();
  if (!vp) throw new Error("no viewport");
  const scale = Math.max(16, Math.floor(Math.min(vp.width, vp.height) / 13));
  await expect(page.locator("#world-loader")).toBeHidden({ timeout: 15_000 });
  await settleCamera(page);
  await page.mouse.click(vp.width / 2 + dx * scale, vp.height / 2 + dy * scale);
}

/**
 * Move the shared test clock on `days` UTC days (one by default), in one jump the world takes as
 * one `new_day`. Only for specs in their own project.
 */
export async function advanceDay(request: APIRequestContext, days = 1) {
  expect((await request.post(`/v1/test/advance-day?days=${days}`)).ok()).toBe(true);
}

/**
 * Run the server's minute sweep now: residents with no socket and no call for 10 minutes go
 * offline, and routines that are due take their steps. It's what the next minute would do.
 */
export async function sweep(request: APIRequestContext) {
  expect((await request.post("/v1/test/sweep")).ok()).toBe(true);
}

/** Move the shared test clock on `minutes` (1 to 1,440), for an event's start. Own project only. */
export async function advanceMinutes(request: APIRequestContext, minutes: number) {
  expect((await request.post(`/v1/test/advance-day?minutes=${minutes}`)).ok()).toBe(true);
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

/**
 * How much the page has jumped since it loaded: the sum of the browser's layout shifts, the
 * number behind Cumulative Layout Shift. Content that moves on screen as something above it
 * loads adds to it; content that appears in place of a placeholder doesn't.
 */
export async function layoutShift(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0;
        const observer = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) total += (e as unknown as { value: number }).value;
        });
        observer.observe({ type: "layout-shift", buffered: true });
        // The buffered entries arrive on the next task.
        setTimeout(() => {
          observer.disconnect();
          resolve(total);
        }, 0);
      }),
  );
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

/** A tiny valid PNG (4x4, warm clay color), built by hand so the test needs no fixtures. */
export function tinyPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const size = 4;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // truecolor RGB
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array(size).fill([180, 83, 47]).flat()),
  ]);
  const raw = Buffer.concat(Array(size).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Count the animation frames a page asks for, so a spec can tell when nothing draws anymore. */
export async function countFrames(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: number };
    w.__frames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        w.__frames++;
        cb(t);
      });
  });
}

/** Frames drawn over 700 ms after a short settle. Needs `countFrames` before the page loads. */
export async function framesWhileIdle(page: Page): Promise<number> {
  await page.waitForTimeout(300);
  const read = () => page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  const before = await read();
  await page.waitForTimeout(700);
  return (await read()) - before;
}
