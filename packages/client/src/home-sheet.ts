/**
 * The sheet the world opens once you claim a plot (decision 0144): a home in one tap, or the build
 * bar with the hearth picked. A starter home is `build_starter_home`, which sets your hearth inside
 * it, and standing on your hearth brings your first pantry, so this says what arrived and where it
 * is. Either way the plot's name is asked next (decision 0121).
 */
import type { WorldEvent } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { closeOverlay, errorLine, openOverlay, sheet, whileBusy } from "@terrakin/ui/ui";
import { actProblem, api } from "./api";
import { openPlotNameSheet } from "./plot-name-sheet";
import { pantryWords, worldProblem } from "./things";

export interface HomeSheetOptions {
  /** The plot you just claimed. */
  plot: { px: number; py: number };
  /** Open the build bar with the hearth picked. */
  buildMyself: () => void;
  /** Say something in the world's own notice line. */
  say: (text: string) => void;
}

type Inventory = Extract<WorldEvent, { type: "inventory" }>;

/** Your pantry, if one of these events brought it. */
const pantryIn = (events: readonly WorldEvent[]) =>
  events.find(
    (e): e is Inventory =>
      e.type === "inventory" && (e.reason === "starter" || e.reason === "pantry"),
  );

export function openHomeSheet(o: HomeSheetOptions) {
  const error = errorLine("home-error");
  const starter = h("button", {
    class: "btn-primary",
    attrs: { type: "button", id: "home-starter" },
    text: "Build me a starter home",
  });
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
      lede: "Next, a home. Its hearth is where Home brings you and where your pantry arrives: seeds the first time, then sugar and jars each day. A starter home is a small wooden hut with the hearth inside.",
    },
    h("div", { class: "stack home-choices" }, error, starter, myself),
  );

  starter.addEventListener("click", () => void build());
  myself.addEventListener("click", () => {
    closeOverlay(s.dialog);
    o.buildMyself();
    openPlotNameSheet(o.plot, { say: o.say, claimed: true });
  });

  async function build() {
    error.textContent = "";
    const result = await whileBusy(starter, async () => {
      const built = await api.act({ type: "build_starter_home" });
      if (!built.ok || !built.data.ok) return { built, events: [] as WorldEvent[] };
      const events = [...built.data.events];
      // The pantry comes once you stand on your hearth: step onto it if the build left you off it.
      if (!pantryIn(events) && events.some((e) => e.type === "hearth_set")) {
        const home = await api.act({ type: "home" });
        if (home.ok && home.data.ok) events.push(...home.data.events);
      }
      return { built, events };
    });
    const { built, events } = result;
    if (!built.ok || !built.data.ok) {
      // The world's refusals are worded for agents: say them in HUD words, by their code.
      const refused = built.ok && !built.data.ok ? built.data.error : undefined;
      error.textContent = refused
        ? worldProblem(refused.code, refused.message, { hasPlot: true })
        : (actProblem(built) ?? "");
      return;
    }
    closeOverlay(s.dialog);
    const pantry = pantryIn(events);
    const got = pantryWords(pantry?.changes ?? []);
    const first = pantry?.reason === "starter";
    openPlotNameSheet(o.plot, {
      say: o.say,
      claimed: true,
      lede: "Your home is built, with your hearth inside. Now give your plot a name everyone sees on the map. You can name it later from your profile, too.",
      news: got
        ? h(
            "div",
            { class: "paper note home-news", attrs: { id: "home-news" } },
            h("p", {
              text: first
                ? `Your first pantry is in: ${got}. Place a planter from Build to grow the seeds.`
                : `Today's pantry is in: ${got}.`,
            }),
            h("a", {
              class: "pill-button small",
              attrs: { href: "/inventory", id: "home-things" },
              text: "See your things",
            }),
          )
        : null,
    });
  }

  openOverlay(s.dialog);
  s.card.focus();
}
