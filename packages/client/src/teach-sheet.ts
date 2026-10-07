/**
 * Teaching on the web (RFC 0024): the sheet a neighbor opens when you tap them in the world once
 * recipes are learned, or from a kitchen or workbench sheet's "Teach a neighbor". It reads their
 * profile, which says what they could teach you (`canTeach`) and what you could teach them
 * (`canLearn`), and lists the second with a Teach button each, sending `teach`. The server decides:
 * a refusal shows its words under the list, and the lesson's toast comes from the
 * `recipe_learned` the world's socket brings both of you. Names are their own words: text only.
 * Only some visits need it, so it loads on its own.
 */
import { ITEM_CATALOG, type ProfileView } from "@terrakin/protocol";
import { type RecipeName, recipeOf, type Station } from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import { itemArt } from "@terrakin/ui/item-art";
import {
  closeOverlay,
  errorLine,
  itemRow,
  itemRows,
  openOverlay,
  sheet,
  whileBusy,
} from "@terrakin/ui/ui";
import { actProblem, api } from "./api";
import { canTeachLine, recipeWords } from "./things";

/** The station a recipe is made at, for its row. */
function stationOf(recipe: RecipeName): Station | undefined {
  return ITEM_CATALOG.recipes.find((r) => recipeOf(r.recipe) === recipe)?.station;
}

/** What you could teach them, and they you, from their profile as you see it. */
export interface Lessons {
  canTeach: RecipeName[];
  canLearn: RecipeName[];
}

/** A profile's lessons: empty lists before recipes are learned, or on your own profile. */
export const lessonsOf = (p: Pick<ProfileView, "canTeach" | "canLearn">): Lessons => ({
  canTeach: [...(p.canTeach ?? [])],
  canLearn: [...(p.canLearn ?? [])],
});

/** Read what a neighbor could teach you and learn from you. Undefined when the read fails. */
export async function lessonsWith(id: string): Promise<Lessons | undefined> {
  const r = await api.profile(id);
  return r.ok ? lessonsOf(r.data.resident) : undefined;
}

export interface TeachSheetOptions {
  /** The neighbor. `name` and `note` are their own words. */
  who: { id: string; name: string; kind: "human" | "agent"; note?: string };
  /** Whether they stand within reach of you now, as the world shows it. Only a hint. */
  near: boolean;
  /** The world's reach, for the line that says how close to stand. */
  reach: number;
  /** Already read, when the caller asked first. Read here otherwise. */
  lessons?: Lessons;
}

/**
 * Open the sheet for a neighbor. False, with nothing opened, when there's nothing to say: they
 * can't teach you anything and you can't teach them anything, or their profile can't be read.
 */
export async function openTeachSheet(o: TeachSheetOptions): Promise<boolean> {
  const lessons = o.lessons ?? (await lessonsWith(o.who.id));
  if (!lessons || (lessons.canTeach.length === 0 && lessons.canLearn.length === 0)) return false;
  const name = o.who.kind === "agent" ? `${o.who.name} ⚙` : o.who.name;
  const problem = errorLine("teach-error");

  const row = (recipe: RecipeName) => {
    const what = recipeWords(recipe);
    const button = h("button", {
      class: o.near ? "btn-primary small" : "pill-button small",
      attrs: {
        type: "button",
        disabled: !o.near,
        "aria-label": `Teach ${o.who.name} ${what.toLowerCase()}`,
      },
      text: "Teach",
    });
    button.addEventListener("click", async () => {
      problem.textContent = "";
      const r = await whileBusy(button, () => api.act({ type: "teach", recipe, to: o.who.id }));
      const why = actProblem(r);
      if (why) {
        problem.textContent = why;
        return;
      }
      closeOverlay(s.dialog);
    });
    const station = stationOf(recipe);
    return itemRow({
      className: "workshop-row",
      plain: true,
      attrs: { "data-recipe": recipe },
      lead: itemArt(recipe === "jam" ? "lemon_jam" : recipe, { size: 32 }),
      name: what,
      lines: [station === "workbench" ? "Made at a workbench" : "Made at a kitchen"],
      trail: button,
    });
  };

  const teachLine = canTeachLine(o.who.name, lessons.canTeach);
  const s = sheet(
    {
      id: "teach-title",
      title: name,
      className: "teach-sheet",
      closeOnBackdrop: true,
    },
    o.who.note ? h("p", { class: "sheet-lede teach-note", text: o.who.note }) : null,
    teachLine ? h("p", { class: "teach-can", text: teachLine }) : null,
    lessons.canLearn.length > 0
      ? h(
          "section",
          { class: "stack tight", attrs: { "aria-labelledby": "teach-them" } },
          h("h3", {
            class: "section-title",
            attrs: { id: "teach-them" },
            text: `Teach ${o.who.name} a recipe`,
          }),
          h("p", {
            class: "sheet-lede",
            text: o.near
              ? "Free, and theirs for good. You can teach one recipe a day, and they can learn one."
              : `Stand within ${o.reach} tiles of ${o.who.name} to teach them.`,
          }),
          itemRows(lessons.canLearn.map(row), { className: "workshop-list" }),
        )
      : null,
    problem,
  );
  openOverlay(s.dialog);
  return true;
}
