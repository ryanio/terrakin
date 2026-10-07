/**
 * The loader between a tap on World and the world on screen, for someone coming back: the bobbing
 * mark, a resident hopping along a path that fills as each stage lands, and a cheerful line that
 * changes every second. Its markup is static in index.html, so it shows on the tap, before the
 * world's code arrives. The bar moves by CSS transitions, which keep running while three.js parses.
 */

import { h } from "@terrakin/ui/dom";
import { initBrandMarks } from "./chrome";

/** What has arrived so far: nothing, the world's code, a snapshot, the server's welcome. */
type LoadStage = "start" | "code" | "world" | "welcome";

/**
 * How far the bar creeps during each stage while it waits for the next. It slows as it nears the
 * ceiling and never fills on its own: only `finish` does that.
 */
const CEILING: Record<LoadStage, number> = { start: 0.3, code: 0.55, world: 0.75, welcome: 0.92 };
/** Waiting on the 3D scene after the welcome is the longest stretch, so that creep is slowest. */
const CREEP_MS: Record<LoadStage, number> = { start: 2400, code: 2400, world: 2400, welcome: 6000 };
/** Quick at first, then slower and slower: an early jump reads as speed. */
const CREEP_EASE = "cubic-bezier(0.15, 0.85, 0.35, 1)";
const FILL_MS = 280;
const LIFT_MS = 600;
const LINE_MS = 1100;

const LINES = [
  "Waking the townsfolk…",
  "Watering the planters…",
  "Sweeping the Commons…",
  "Lighting the hearths…",
  "Gathering fallen branches…",
  "Stacking loose stones…",
  "Opening the shop…",
  "Ringing the Town Hall bell…",
  "Fluffing the clouds…",
  "Finding your front door…",
];

export interface WorldLoader {
  /** Put it up at once. Does nothing while it is already up. */
  show(): void;
  /** True while it is up and not yet on its way out. */
  isUp(): boolean;
  /** A stage has landed: move the bar on toward the next one. Never moves it back. */
  reach(stage: LoadStage): void;
  /** The world is drawn: fill the bar and fade into the world, which comes into focus. */
  finish(): void;
  /** Take it down at once: you left, the server can't be reached, or it's back to the landing. */
  hide(): void;
}

export function createWorldLoader(root: HTMLElement): WorldLoader {
  const view = root.parentElement ?? root;
  const bar = root.querySelector<HTMLElement>("[role=progressbar]");
  const moving = root.querySelectorAll<HTMLElement>("[data-progress]");
  const line = root.querySelector<HTMLElement>(".world-loader-line");
  initBrandMarks(root);

  let up = false;
  let leaving = false;
  let level = 0;
  let next = 0;
  let lineTimer = 0;
  let liftTimer = 0;

  const move = (to: number, ms: number, ease: string) => {
    level = to;
    for (const el of moving) {
      el.style.transition = ms ? `transform ${ms}ms ${ease}` : "none";
      el.style.transform = `translateX(${(to - 1) * 100}%)`;
    }
    bar?.setAttribute("aria-valuenow", String(Math.round(to * 100)));
  };

  /** The next line slides up into place as the last one slides out above it. */
  const say = (text: string) => {
    if (!line) return;
    for (const old of line.querySelectorAll(".out")) old.remove();
    line.firstElementChild?.classList.add("out");
    line.append(h("span", { text }));
  };
  const rotate = () => {
    say(LINES[next % LINES.length] ?? "");
    next++;
  };

  const stop = () => {
    clearInterval(lineTimer);
    clearTimeout(liftTimer);
  };
  const hide = () => {
    stop();
    up = false;
    leaving = false;
    root.hidden = true;
    root.classList.remove("leaving", "lifted");
    view.classList.remove("world-loading");
    line?.replaceChildren();
  };

  return {
    show() {
      if (up && !leaving) return;
      stop();
      up = true;
      leaving = false;
      root.classList.remove("lifted");
      root.hidden = false;
      view.classList.add("world-loading");
      line?.replaceChildren();
      // A different first line each time, so coming back often still has something new.
      next = Math.floor(Math.random() * LINES.length);
      rotate();
      lineTimer = window.setInterval(rotate, LINE_MS);
      move(0, 0, "linear");
      // Lay out the empty bar before the creep starts, or the browser skips the transition.
      void bar?.offsetWidth;
      move(CEILING.start, CREEP_MS.start, CREEP_EASE);
    },
    isUp: () => up && !leaving,
    reach(stage) {
      if (!up || leaving || CEILING[stage] <= level) return;
      move(CEILING[stage], CREEP_MS[stage], CREEP_EASE);
    },
    finish() {
      if (!up || leaving) return;
      leaving = true;
      clearInterval(lineTimer);
      say("Welcome back!");
      move(1, FILL_MS, "ease-out");
      // Taps go through to the world from here on, while the bar fills and the loader fades.
      root.classList.add("leaving");
      liftTimer = window.setTimeout(() => {
        root.classList.add("lifted");
        view.classList.remove("world-loading");
        liftTimer = window.setTimeout(hide, LIFT_MS);
      }, FILL_MS);
    },
    hide,
  };
}
