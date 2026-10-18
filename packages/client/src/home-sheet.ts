/**
 * The sheet the world opens once you claim a plot (decision 0144): a home in one tap, or the build
 * bar with the hearth picked. The homes are the designs (RFC 0032), drawn as they'd stand on your
 * plot (`design-picks.ts`, loaded when the sheet opens). Building one sets your hearth on the
 * plot's center, which every design leaves open, steps you onto it, which brings your first pantry,
 * and sends `build` with the design, so this says what arrived and where it is. The first pantry's
 * note offers Plant a seed, which puts one in by the hearth without leaving the sheet
 * (decision 0313). Either way the plot's name is asked next (decision 0121).
 */
import type { Action, WorldEvent } from "@terrakin/protocol";
import { plotCenter, type Season, type Tile, type WorldConfig } from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import type { Result } from "@terrakin/ui/http";
import {
  closeOverlay,
  openOverlay,
  overlayShowing,
  sheet,
  whileBusy,
  whileBusyAll,
} from "@terrakin/ui/ui";
import { worldApi } from "./api/world";
import type { DesignChoice } from "./design-picks";
import { doneAlready, homeSteps } from "./home-steps";
import { openPlotNameSheet } from "./plot-name-sheet";
import { pantryWords, worldProblem } from "./things";

export interface HomeSheetOptions {
  /** The plot you just claimed. */
  plot: { px: number; py: number };
  /** Open the build bar with the hearth picked. */
  buildMyself: () => void;
  /** Say something in the world's own notice line. */
  say: (text: string) => void;
  /** The world's size and reach, and its season, for drawing the designs on your plot. */
  where: { config: WorldConfig; season?: Season | undefined };
  /** Where the world says you stand now, and your hearth, from the mirror. */
  standing: () => Tile | undefined;
  hearth: () => Tile | null | undefined;
  /**
   * Walk until a tile is within `near` tiles, around whatever is in the way, done once the world
   * has you there (or the walk gives up).
   */
  walkNear: (tile: Tile, near: number) => Promise<void>;
  /**
   * Plant the first seed by the hearth in one tap, giving back what to say: the planted line, the
   * world's refusal, or null when there's no one-tap plan for it (`sendFirstPlanting`).
   */
  plantFirst: () => Promise<string | null>;
}

type Inventory = Extract<WorldEvent, { type: "inventory" }>;

/** The sheet closed during the walk to the plot's center, so nothing was sent. */
const CLOSED = "closed";

/** Your pantry, if one of these events brought it. */
const pantryIn = (events: readonly WorldEvent[]) =>
  events.find(
    (e): e is Inventory =>
      e.type === "inventory" && (e.reason === "starter" || e.reason === "pantry"),
  );

/**
 * The pantry note on the name sheet: what arrived, and, for the first pantry, Plant a seed, which
 * puts one in by the hearth without leaving the sheet (decision 0313). The plot still wants a name,
 * so the sheet stays open and the note says what happened in place of the button. Only the first
 * pantry brings seeds, so only it offers the tap.
 */
function pantryNews(got: string, first: boolean, plantFirst: () => Promise<string | null>): Node {
  const line = h("p", {
    attrs: { role: "status" },
    text: first ? `Your first pantry is in: ${got}.` : `Today's pantry is in: ${got}.`,
  });
  const things = h("a", {
    class: "pill-button small",
    attrs: { href: "/inventory", id: "home-things" },
    text: "See your things",
  });
  const plant = first
    ? h("button", {
        class: "btn-primary small",
        attrs: { type: "button", id: "home-plant" },
        text: "Plant a seed",
      })
    : null;
  plant?.addEventListener("click", () => {
    void (async () => {
      const said = await whileBusy(plant, plantFirst, "Planting…");
      // Either way the button has had its turn: what it did, or how to do it by hand, is the note,
      // which says it where a reader is told about it too (`role="status"`).
      line.textContent =
        said ??
        "There's no room for a planter by your hearth yet. Place one from Build, then tap it.";
      const held = document.activeElement === plant;
      plant.remove();
      // Focus was on the button that just left, so hand it to the link beside it, inside the sheet.
      if (held) things.focus();
    })();
  });
  return h(
    "div",
    { class: "paper note home-news", attrs: { id: "home-news" } },
    line,
    h("div", { class: "cluster" }, plant, things),
  );
}

export function openHomeSheet(o: HomeSheetOptions) {
  /** "Saving…" while the home goes up, or why it couldn't. */
  const status = h("p", {
    class: "field-hint home-status",
    attrs: { id: "home-status", role: "status" },
  });
  // Off until the designs are drawn, so a tap never builds a home nobody saw picked.
  const starter = h("button", {
    class: "btn-primary",
    attrs: { type: "button", id: "home-build", disabled: "" },
    text: "Build this home",
  });
  /** The designs, once their code is in. Until then, and if it never comes, the starter home. */
  let picker: { choice: () => DesignChoice } | undefined;
  const picks = h("div", { class: "home-picks" });
  const myself = h("button", {
    class: "pill-button",
    attrs: { type: "button", id: "home-myself" },
    text: "I'll build it myself",
  });
  const s = sheet(
    {
      id: "home-title",
      title: "This plot is yours",
      className: "home-sheet",
      lede: "Next, a home. Pick one: its hearth goes in the middle of your plot, where Home brings you and where your pantry arrives, seeds the first time, then sugar and jars each day. Every home here is free.",
    },
    picks,
    h("div", { class: "stack home-choices" }, status, starter, myself),
  );
  void import("./design-picks")
    .then(({ designPicker }) => {
      const made = designPicker(o.where, o.plot);
      picker = made;
      picks.replaceChildren(made.element);
      starter.disabled = false;
    })
    .catch(() => {
      // No designs to show: the one-tap starter home still works.
      picks.remove();
      starter.textContent = "Build me a starter home";
      starter.disabled = false;
    });

  starter.addEventListener("click", () => void build());
  myself.addEventListener("click", () => {
    closeOverlay(s.dialog);
    o.buildMyself();
    openPlotNameSheet(o.plot, { say: o.say, claimed: true });
  });

  async function build() {
    // Both choices are off while it builds, so neither can open a second sheet over the first.
    const res = await whileBusyAll(
      [starter, myself],
      starter,
      status,
      async (): Promise<Result<WorldEvent[]>> => {
        const events: WorldEvent[] = [];
        /** One action, its events kept, or why the world turned it down in HUD words. */
        const send = async (action: Action): Promise<Result<WorldEvent[]> | undefined> => {
          const done = await worldApi.act(action);
          if (!done.ok) return done;
          if (!done.data.ok) {
            // The world's refusals are worded for agents: say them in HUD words, by their code.
            const { code, message } = done.data.error;
            return {
              ok: false,
              status: 200,
              code,
              message: worldProblem(code, message, { hasPlot: true }),
            };
          }
          events.push(...done.data.events);
          return undefined;
        };
        const chosen = picker?.choice();
        if (chosen) {
          // The hearth on the plot's center, which every design leaves open, set from within reach.
          const { config } = o.where;
          const center = plotCenter(config, o.plot.px, o.plot.py);
          const steps = homeSteps({
            standing: o.standing(),
            center,
            reach: config.reach,
            hearth: o.hearth(),
          });
          if (steps.walk) {
            await o.walkNear(center, config.reach);
            // Closed during the walk: that was a no, so nothing is sent.
            if (!overlayShowing(s.dialog))
              return { ok: false, status: 0, code: CLOSED, message: "" };
          }
          /** A refusal that still leaves the way to the build clear is no refusal. */
          const stopped = (r: Result<WorldEvent[]> | undefined) =>
            r && (r.ok || !doneAlready(r.code)) ? r : undefined;
          const hearth = steps.setHearth
            ? stopped(await send({ type: "set_hearth", ...center }))
            : undefined;
          if (hearth) return hearth;
          // Standing on it brings the pantry: step onto it if setting it left you off it.
          if (!pantryIn(events)) {
            const home = stopped(await send({ type: "home" }));
            if (home) return home;
          }
          const built = await send({ type: "build", px: o.plot.px, py: o.plot.py, ...chosen });
          if (built) return built;
          return { ok: true, data: events };
        }
        const refused = await send({ type: "build_starter_home" });
        if (refused) return refused;
        // The pantry comes once you stand on your hearth: step onto it if the build left you off it.
        if (!pantryIn(events) && events.some((e) => e.type === "hearth_set")) {
          const home = await worldApi.act({ type: "home" });
          if (home.ok && home.data.ok) events.push(...home.data.events);
        }
        return { ok: true, data: events };
      },
    );
    if (!res.ok) {
      // Closed meanwhile: the status line went with it, so say it in the world.
      if (!overlayShowing(s.dialog) && res.code !== CLOSED) o.say(res.message);
      return;
    }
    // Closed while it built (Escape, the back gesture): the home is up, and nothing else opens.
    const showing = overlayShowing(s.dialog);
    closeOverlay(s.dialog);
    if (!showing) return;
    const events = res.data;
    const pantry = pantryIn(events);
    const got = pantryWords(pantry?.changes ?? []);
    const first = pantry?.reason === "starter";
    openPlotNameSheet(o.plot, {
      say: o.say,
      claimed: true,
      lede: "Your home is built, with your hearth inside. Now give your plot a name everyone sees on the map. You can name it later from your profile, too.",
      news: got ? pantryNews(got, first, o.plantFirst) : null,
    });
  }

  openOverlay(s.dialog);
  s.card.focus();
}
