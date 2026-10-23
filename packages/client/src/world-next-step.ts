/**
 * The world's next-step chip: one small button naming your next first step (`first-steps.ts`), shown
 * while one is left and hidden once they're all done. It stacks in the `.world-near` column with
 * Gather all, Pat, and Fish and keeps to their width, so it never covers more of the map than they
 * do. It stays away only where the button for its own step is already on screen: Claim plot while
 * the step is a plot (decision 0234), and Gather all while the step is to gather, which the chip's
 * `data-step` lets style.css hide the moment that button comes or goes (decision 0312).
 * A tap does it or opens it: the plot name sheet, a starter home, a first seed planted by the
 * hearth (`sendFirstPlanting` in `first-plant.ts`, which the sheet after a home shares), the build
 * bar, or the page where it's done. It asks the server when the world comes on screen, when the last
 * sheet over it closes, and every so often after, since steps are done in many places.
 */
import { h } from "@terrakin/ui/dom";
import { everyVisible } from "@terrakin/ui/poll";
import { whileBusy } from "@terrakin/ui/ui";
import { actFromButton } from "./act";
import { firstVisitApi } from "./api/first-visit";
import { residentsApi } from "./api/residents";
import { sendFirstPlanting } from "./first-plant";
import { nextStep, type StepRow, stepHref, stepRows } from "./first-steps";
import type { Mirror } from "./mirror";
import { savedResidentId, savedToken } from "./net";
import { openPlotNameSheet } from "./plot-name-sheet";
import { worldProblem } from "./things";

/** How often to ask again while you're in the world. */
const REFRESH_MS = 20_000;
/** After a tap, ask again this soon, once the world has had time to answer. */
const AFTER_TAP_MS = 3000;

/** Click a world button by id when it's on screen. True when it was. */
function press(id: string): boolean {
  const button = document.getElementById(id);
  if (!(button instanceof HTMLButtonElement) || button.hidden || button.disabled) return false;
  button.click();
  return true;
}

/**
 * Put the chip in the world's HUD. `navigate` goes to another page of the site, `mirror` is the
 * world as this page has it, and `toast` is the world's own toast, which shows over the map. Call
 * once, when the world's code loads.
 */
export function mountNextStep(o: {
  navigate: (path: string) => void;
  mirror: () => Mirror | undefined;
  toast: (line: string) => void;
  /** The way to the nearest branch or stone you may pick up, in words, when nothing is in reach. */
  nearestPickup: () => string | undefined;
}) {
  const hud = document.getElementById("hud");
  const near = document.querySelector(".world-near");
  if (!hud || !near) return;
  const label = h("span", { class: "world-next-label" });
  const chip = h(
    "button",
    {
      class: "pill-button small world-next",
      attrs: { type: "button", id: "world-next", title: "Your next step", hidden: true },
    },
    label,
  );
  near.append(chip);

  let step: StepRow | undefined;
  let asking = false;
  async function refresh() {
    const me = savedResidentId();
    if (asking || hud?.hidden || !me || !savedToken()) return;
    asking = true;
    const r = await firstVisitApi.firstVisit();
    asking = false;
    step = r.ok ? nextStep(stepRows(r.data)) : undefined;
    chip.hidden = !step || step.id === "plot";
    if (!step) return;
    // style.css reads this, so the chip gives its place up to Gather all the moment that shows.
    chip.dataset.step = step.id;
    label.textContent = step.chip;
    chip.setAttribute("aria-label", `Next step: ${step.name}`);
  }
  const soon = () => setTimeout(() => void refresh(), AFTER_TAP_MS);

  async function namePlot(me: string) {
    const r = await residentsApi.profile(me);
    const home = r.ok ? r.data.resident.home : undefined;
    if (home) openPlotNameSheet(home, { after: refresh });
    else press("claim");
  }

  async function plantOrSay(row: StepRow, me: string) {
    const m = o.mirror();
    const said = m ? await whileBusy(chip, () => sendFirstPlanting(m, me)) : null;
    // The planted line, a refusal, or how to plant by hand (`plantByHandLine`), never the hint,
    // which says this tap plants it.
    if (said) o.toast(said);
    else {
      // No hearth to plant by: the build bar and the hint are how it's done by hand.
      if (document.getElementById("build")?.getAttribute("aria-pressed") !== "true") press("build");
      o.toast(row.hint);
    }
    void refresh();
  }

  chip.addEventListener("click", () => {
    const me = savedResidentId();
    if (!step || !me) return;
    switch (step.id) {
      case "plot_name":
        void namePlot(me);
        return;
      case "home":
        void actFromButton(chip, { type: "build_starter_home" }, "Your home is built", {
          after: refresh,
          say: o.toast,
          words: (code, message) => worldProblem(code, message, { hasPlot: true }),
        });
        return;
      case "garden":
        void plantOrSay(step, me);
        return;
      case "gather": {
        if (press("world-gather")) break;
        // Nothing within reach: say which way the nearest one lies, so the step has somewhere to go.
        const way = o.nearestPickup();
        o.toast(
          way
            ? `Nothing to pick up right beside you. The nearest branch or stone is ${way}: walk there and tap it.`
            : step.hint,
        );
        break;
      }
      case "make":
        o.toast(step.hint);
        break;
      default:
        o.navigate(stepHref(step.place, me));
        return;
    }
    soon();
  });

  // Into the world: ask now. Out of it, the HUD hides and the chip with it.
  new MutationObserver(() => void refresh()).observe(hud, {
    attributes: true,
    attributeFilter: ["hidden"],
  });
  // Most first steps are done in a sheet (a home, a seed from its pantry note, a plot's name), so
  // ask again as the last sheet closes, rather than show a step that's done until the next refresh.
  const root = document.documentElement;
  let sheetOpen = root.classList.contains("overlay-open");
  new MutationObserver(() => {
    const open = root.classList.contains("overlay-open");
    if (sheetOpen && !open) void refresh();
    sheetOpen = open;
  }).observe(root, { attributes: true, attributeFilter: ["class"] });
  everyVisible(REFRESH_MS, () => void refresh());
}
