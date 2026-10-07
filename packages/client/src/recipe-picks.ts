/**
 * The sheet that asks a newcomer to pick their first recipes (RFC 0024), opened from a kitchen or a
 * workbench while they have free picks. It lists today's Recipes shelf from `GET /v1/shop`, this
 * station's cards first, each with its picture and what it uses, and sends `pick_recipe` for a tap.
 * The server decides; a refusal shows its words under the list. Closing it puts it off until the
 * next kitchen or workbench, and picking the last one (or Not now) opens the station's own sheet.
 * Only newcomers ever see it, so it loads on its own.
 */
import type { RecipeCardView } from "@terrakin/protocol";
import { cardOf, RECIPES_RULES, type Station } from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import { plural } from "@terrakin/ui/format";
import { itemArt } from "@terrakin/ui/item-art";
import {
  errorLine,
  itemRow,
  itemRows,
  openOverlay,
  overlayShowing,
  sheet,
  whileBusy,
} from "@terrakin/ui/ui";
import { actProblem, api } from "./api";
import { needsListLine, recipeWords } from "./things";

/** The cards you can still pick, grouped by station, `first`'s group first. Pure, so tests pin it. */
export function pickGroups(
  cards: readonly RecipeCardView[],
  first: Station,
): { station: Station; cards: RecipeCardView[] }[] {
  const order: Station[] =
    first === "kitchen" ? ["kitchen", "workbench"] : ["workbench", "kitchen"];
  return order
    .map((station) => ({
      station,
      cards: cards.filter((c) => !c.known && c.recipe.station === station),
    }))
    .filter((g) => g.cards.length > 0);
}

export interface RecipePicksOptions {
  /** The station that was tapped: its cards come first. */
  station: Station;
  /** Free picks left, from `inventory.recipePicks`. */
  picks: number;
  /** The station's sheet. The picks sheet opens only while it's still showing, in its place. */
  over: HTMLDialogElement;
  /** After the last pick, or Not now: open the station's sheet again. */
  done: () => void;
}

/** Open the picks sheet in place of `over`. False when there's nothing to pick from. */
export async function openRecipePicks(o: RecipePicksOptions): Promise<boolean> {
  const shop = await api.shop();
  const groups = shop.ok ? pickGroups(shop.data.shop?.recipes ?? [], o.station) : [];
  if (groups.length === 0 || !overlayShowing(o.over)) return false;
  let left = o.picks;
  const count = h("p", { class: "picks-left", attrs: { "aria-live": "polite" } });
  const say = () => {
    count.textContent = `${plural(left, "free pick", "free picks")} left`;
  };
  say();
  const problem = errorLine("picks-error");

  const row = (card: RecipeCardView) => {
    const recipe = cardOf(card.sku);
    const name = recipe ? recipeWords(recipe) : card.name;
    const button = h("button", {
      class: "btn-primary small",
      attrs: { type: "button", "aria-label": `Pick ${name.toLowerCase()}` },
      text: "Pick",
    });
    button.addEventListener("click", async () => {
      if (!recipe || left === 0) return;
      problem.textContent = "";
      const r = await whileBusy(button, () => api.act({ type: "pick_recipe", recipe }));
      const why = actProblem(r);
      if (why) {
        problem.textContent = why;
        return;
      }
      left -= 1;
      button.textContent = "Picked";
      button.className = "pill-button small";
      button.disabled = true;
      if (left === 0) return o.done();
      say();
    });
    return itemRow({
      className: "workshop-row",
      plain: true,
      attrs: { "data-recipe": card.sku },
      lead: itemArt(card.recipe.makes, { size: 32 }),
      name,
      lines: [`Uses ${needsListLine(card.recipe.needs)}`],
      trail: button,
    });
  };

  const s = sheet(
    {
      id: "picks-title",
      title: `Pick ${RECIPES_RULES.starterPicks} recipes to start`,
      className: "picks-sheet",
      lede: "They're free and yours for good. Everyone already knows herb tea, jam, a bouquet, and the first furniture; the town shop sells the rest.",
    },
    count,
    ...groups.map((g) =>
      h(
        "section",
        { class: "stack tight", attrs: { "aria-labelledby": `picks-${g.station}` } },
        h("h3", {
          class: "section-title",
          attrs: { id: `picks-${g.station}` },
          text: g.station === "kitchen" ? "At a kitchen" : "At a workbench",
        }),
        itemRows(g.cards.map(row), { className: "workshop-list" }),
      ),
    ),
    problem,
    h("button", {
      class: "pill-button small picks-later",
      attrs: { type: "button" },
      text: "Not now",
      on: { click: () => o.done() },
    }),
  );
  openOverlay(s.dialog);
  return true;
}
