/**
 * The world's next-step chip: one small button naming your next first step (`first-steps.ts`), shown
 * while one is left and hidden once they're all done. It takes the slot in the `.world-near` column
 * where Gather all, Pat, and Fish show, only while none of them does (style.css hides it then), and
 * keeps to their width, so it never covers more of the map than they do. While the next step is a
 * plot it stays away, since Claim plot is on screen beside it (decision 0234).
 * A tap does it or opens it: the plot name sheet, a starter home, the build bar, or
 * the page where it's done. It asks the server while the world is on screen and every so often
 * after, since steps are done in many places.
 */
import { h } from "@terrakin/ui/dom";
import { everyVisible } from "@terrakin/ui/poll";
import { toast } from "@terrakin/ui/ui";
import { actFromButton } from "./act";
import { api } from "./api";
import { nextStep, type StepRow, stepHref, stepRows } from "./first-steps";
import { savedResidentId, savedToken } from "./net";
import { openPlotNameSheet } from "./plot-name-sheet";

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
 * Put the chip in the world's HUD. `navigate` goes to another page of the site. Call once, when
 * the world's code loads.
 */
export function mountNextStep(o: { navigate: (path: string) => void }) {
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
    const r = await api.firstVisit();
    asking = false;
    step = r.ok ? nextStep(stepRows(r.data)) : undefined;
    chip.hidden = !step || step.id === "plot";
    if (!step) return;
    label.textContent = step.chip;
    chip.setAttribute("aria-label", `Next step: ${step.name}`);
  }
  const soon = () => setTimeout(() => void refresh(), AFTER_TAP_MS);

  async function namePlot(me: string) {
    const r = await api.profile(me);
    const home = r.ok ? r.data.resident.home : undefined;
    if (home) openPlotNameSheet(home, { after: refresh });
    else press("claim");
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
        });
        return;
      case "garden":
        if (document.getElementById("build")?.getAttribute("aria-pressed") !== "true")
          press("build");
        toast(step.hint);
        break;
      case "gather":
        if (!press("world-gather")) toast(step.hint);
        break;
      case "make":
        toast(step.hint);
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
  everyVisible(REFRESH_MS, () => void refresh());
}
