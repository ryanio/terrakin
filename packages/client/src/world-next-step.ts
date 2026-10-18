/**
 * The world's next-step chip: one small button naming your next first step (`first-steps.ts`), shown
 * while one is left and hidden once they're all done. It stacks in the `.world-near` column with
 * Gather all, Pat, and Fish and keeps to their width, so it never covers more of the map than they
 * do. It stays away only where the button for its own step is already on screen: Claim plot while
 * the step is a plot (decision 0234), and Gather all while the step is to gather, which the chip's
 * `data-step` lets style.css hide the moment that button comes or goes (decision 0312).
 * A tap does it or opens it: the plot name sheet, a starter home, a first seed planted by the
 * hearth (`first-plant.ts`: home, a planter inside the starter hut, and the seed, each sent and
 * checked like any action), the build bar, or the page where it's done. It asks the server while the world is on screen and every so often
 * after, since steps are done in many places.
 */
import type { Action } from "@terrakin/protocol";
import { canBuildOn } from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import { everyVisible } from "@terrakin/ui/poll";
import { whileBusy } from "@terrakin/ui/ui";
import { actFromButton } from "./act";
import { firstVisitApi } from "./api/first-visit";
import { inventoryApi } from "./api/inventory";
import { residentsApi } from "./api/residents";
import { actProblem, worldApi } from "./api/world";
import { planFirstPlanting, plantedLine } from "./first-plant";
import { nextStep, type StepRow, stepHref, stepRows } from "./first-steps";
import type { Mirror } from "./mirror";
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

/** Send one action; its refusal, if any, in the server's words. */
async function send(action: Action): Promise<string | null> {
  return actProblem(await worldApi.act(action));
}

/**
 * Plant a first seed by `me`'s hearth: home first when away from it, then a planter inside the
 * starter hut when there's no empty one within reach, then the seed that grows soonest. False
 * when there's no plan for it (no hearth, no seeds, no room), so the chip says how instead.
 */
async function plantFirst(m: Mirror, me: string, say: (line: string) => void): Promise<boolean> {
  const r = m.residents.get(me);
  const hearth = r?.hearth;
  if (!r || !hearth) return false;
  if (r.x !== hearth.x || r.y !== hearth.y || r.floor !== undefined) {
    const problem = await send({ type: "home" });
    if (problem) {
      say(problem);
      return true;
    }
  }
  const inv = await inventoryApi.inventory();
  if (!inv.ok) return false;
  const counts = new Map<string, number>(
    (inv.data.inventory?.stacks ?? []).map((s) => [s.kind, s.count]),
  );
  const plan = planFirstPlanting({
    config: m.config,
    hearth,
    blocks: m.blocks,
    crops: m.crops,
    mine: (t) => {
      const ownerId = m.ownerAt(t.x, t.y);
      return canBuildOn(
        ownerId ? { ownerId, coOwners: [...m.coOwnersAt(t.x, t.y)] } : undefined,
        me,
      );
    },
    standing: (t) =>
      [...m.residents.values()].some(
        (o) => o.online && o.x === t.x && o.y === t.y && o.floor === undefined,
      ),
    held: (kind) => counts.get(kind) ?? 0,
  });
  if ("problem" in plan) return false;
  const { tile, crop } = plan;
  const problem =
    (plan.place ? await send({ type: "place", ...tile, block: "planter" }) : null) ??
    (await send({ type: "plant", ...tile, seed: crop }));
  say(problem ?? plantedLine(crop));
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
    const planted = m ? await whileBusy(chip, () => plantFirst(m, me, o.toast)) : false;
    if (!planted) {
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
        });
        return;
      case "garden":
        void plantOrSay(step, me);
        return;
      case "gather":
        if (!press("world-gather")) o.toast(step.hint);
        break;
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
  everyVisible(REFRESH_MS, () => void refresh());
}
