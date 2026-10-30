/**
 * The sheet the world opens once you claim a plot (decision 0144): a home in one tap, or the build
 * bar with the hearth picked. The homes are the designs (RFC 0032), drawn as they'd stand on your
 * plot (`design-picks.ts`, loaded when the sheet opens). Building one sets your hearth on the
 * plot's center, which every design leaves open, steps you onto it, which brings your first pantry,
 * and sends `build` with the design, so the world's notice says what arrived. Nothing else opens:
 * planting the first seed and naming the plot are the next-step chip's (decision 0380).
 */
import type { Action, WorldEvent } from "@terrakin/protocol";
import { plotCenter, type Season, type Tile, type WorldConfig } from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import type { Result } from "@terrakin/ui/http";
import { closeOverlay, openOverlay, overlayShowing, sheet, whileBusyAll } from "@terrakin/ui/ui";
import { worldApi } from "./api/world";
import type { DesignChoice } from "./design-picks";
import { doneAlready, homeSteps } from "./home-steps";
import { worldProblem } from "./things";

export interface HomeSheetOptions {
  /** The plot you just claimed. */
  plot: { px: number; py: number };
  /** Open the build bar with the hearth picked. */
  buildMyself: () => void;
  /** Say something in the world's own notice line. */
  say: (text: string) => void;
  /** The world's size and reach, and its season, for drawing the designs on your plot. */
  /** `roomy` where the world builds homes from walls between tiles (RFC 0050). */
  where: { config: WorldConfig; season?: Season | undefined; roomy?: boolean | undefined };
  /** Where the world says you stand now, and your hearth, from the mirror. */
  standing: () => Tile | undefined;
  hearth: () => Tile | null | undefined;
  /**
   * Walk until a tile is within `near` tiles, around whatever is in the way, done once the world
   * has you there (or the walk gives up).
   */
  walkNear: (tile: Tile, near: number) => Promise<void>;
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
      lede: "Next, a home. Pick one and it's built for you, free. Its hearth is where Home brings you and where your pantry arrives.",
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
    // The home is up, and the world's own notice says what the pantry brought.
    closeOverlay(s.dialog);
  }

  openOverlay(s.dialog);
  s.card.focus();
}
