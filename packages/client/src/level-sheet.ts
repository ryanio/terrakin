/**
 * The skills sheet (RFC 0029), opened from the level chip on a profile: five rows, one a skill,
 * each with its level, a bar, and what it unlocks next. Anyone's shows levels only, from the
 * profile's `level`. Your own asks `GET /v1/progress` and adds what only you may see: the points to
 * each next level, what today has counted against the cap, the titles you may show (a tap sends
 * `profile` with `title`), and the earned wear that's yours to put on. The server counts and
 * checks everything; a refusal shows in its words. Loaded on its own, when a chip is tapped.
 */
import type { LevelView, ProgressResponse } from "@terrakin/protocol";
import {
  EARNED_WEAR,
  EARNED_WEAR_SKILL,
  PROGRESS,
  SKILLS,
  type Skill,
  type Title,
  UNLOCKS,
  WEAR_INFO,
} from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { plural } from "@terrakin/ui/format";
import { itemArt } from "@terrakin/ui/item-art";
import { skLine } from "@terrakin/ui/skeleton";
import {
  chips,
  errorLine,
  itemRow,
  itemRows,
  openOverlay,
  progressBar,
  sheet,
} from "@terrakin/ui/ui";
import { actProblem, api } from "./api";
import { ownSkillRow, publicSkillRow, type SkillRow, titleWords } from "./levels";

export interface LevelSheetOptions {
  /** Whose skills these are. Their name is their own words: shown as text. */
  name: string;
  /** Their levels as the profile has them. */
  level: LevelView;
  /** Your own profile: the sheet also shows your points, today's counts, and your titles. */
  mine: boolean;
  /** You picked a title, or none: the profile repaints its chip. */
  onTitle?: (title: Title | undefined) => void;
  /** Open the look editor, for earned wear that's yours to put on. */
  dressUp?: () => void;
}

/** The earned garment a skill brings, for its row's picture. */
const garmentOf = (skill: Skill) => EARNED_WEAR.find((w) => EARNED_WEAR_SKILL[w] === skill);

/**
 * One skill's row: its garment (faded until it's reached), its level, its bar, and its lines. With
 * `waiting`, placeholders stand in for the bar and the lines, so your own rows keep their height
 * while your points load.
 */
function skillRow(row: SkillRow, level: number, waiting = false): HTMLLIElement {
  const garment = garmentOf(row.skill);
  const reached = level >= UNLOCKS.wear;
  return itemRow({
    plain: true,
    className: `level-row${reached ? " reached" : ""}`,
    attrs: { "data-skill": row.skill },
    lead: garment
      ? itemArt(garment, {
          size: 32,
          title: reached
            ? WEAR_INFO[garment].label
            : `${WEAR_INFO[garment].label}, not reached yet`,
        })
      : null,
    name: row.name,
    lines: waiting
      ? [skLine(), skLine(56), skLine(72)]
      : [progressBar(row.bar.count, row.bar.total, row.bar.label), ...row.lines],
  });
}

/** The titles you may show, as chips, with None first. A tap asks the server. */
function titlePicker(
  progress: ProgressResponse,
  onTitle: (title: Title | undefined) => void,
): HTMLElement {
  const heading = h("h3", { class: "section-title", text: "Title on your profile" });
  if (progress.titles.length === 0) {
    return h(
      "section",
      { class: "stack tight level-titles" },
      heading,
      h("p", {
        class: "hint",
        text: `Your first title comes with level ${UNLOCKS.title} in any skill.`,
      }),
    );
  }
  type Choice = Title | "none";
  const problem = errorLine("level-title-error");
  let shown: Choice = progress.title ?? "none";
  const press = (value: Choice) => {
    for (const chip of picker.row.children) {
      chip.setAttribute("aria-pressed", String(chip.getAttribute("data-value") === value));
    }
  };
  const picker = chips<Choice>(
    ["none", ...progress.titles],
    shown,
    (value) =>
      value === "none"
        ? [h("span", { text: "None" })]
        : [h("span", { text: titleWords(value).label })],
    async (value) => {
      if (value === shown) return;
      problem.textContent = "";
      const r = await api.act({ type: "profile", title: value === "none" ? null : value });
      const why = actProblem(r);
      if (why) {
        // The server said no: the chip that was picked stays picked.
        problem.textContent = why;
        press(shown);
        return;
      }
      shown = value;
      onTitle(value === "none" ? undefined : value);
    },
    h("div", { class: "pick-row", attrs: { "aria-label": "Title on your profile" } }),
  );
  return h("section", { class: "stack tight level-titles" }, heading, picker.row, problem);
}

/** The earned wear that's yours, with a way to the look editor, which takes the sheet's place. */
function wearNote(
  progress: ProgressResponse,
  dressUp: (() => void) | undefined,
): HTMLElement | null {
  if (progress.wear.length === 0) return null;
  return h(
    "section",
    { class: "stack tight level-wear" },
    h("h3", { class: "section-title", text: "Yours to wear" }),
    h(
      "div",
      { class: "cluster" },
      ...progress.wear.map((w) =>
        h(
          "span",
          { class: "cluster level-garment", attrs: { "data-wear": w } },
          itemArt(w, { size: 28 }),
          h("span", { text: WEAR_INFO[w].label }),
        ),
      ),
    ),
    dressUp
      ? h(
          "button",
          {
            class: "pill-button small level-dress",
            attrs: { type: "button" },
            on: { click: dressUp },
          },
          icon("sparkle"),
          h("span", { text: "Dress up" }),
        )
      : null,
  );
}

/** Open the skills sheet for a profile. */
export function openLevelSheet(o: LevelSheetOptions): void {
  const total = h("p", { class: "level-total", text: `Level ${o.level.level}` });
  /** Their rows from the profile's levels alone: anyone's, and yours until your points come. */
  const publicRows = (waiting = false) =>
    SKILLS.map((skill) =>
      skillRow(publicSkillRow(skill, o.level.skills[skill]), o.level.skills[skill], waiting),
    );
  const list = itemRows(publicRows(o.mine), { className: "level-rows" });
  const extras = h("div", { class: "stack level-extras" });
  const s = sheet(
    {
      id: "level-title",
      // A name is resident text: `sheet` puts the title in as text.
      title: o.mine ? "Your skills" : `${o.name}'s skills`,
      className: "level-sheet",
      lede: o.mine
        ? `Each skill counts up to ${PROGRESS.dailyCap} points a day. Levels bring a title and something to wear, never anything you need.`
        : "Levels come from growing, making, foraging, hosting, and playing. They bring a title and something to wear.",
      closeOnBackdrop: true,
    },
    total,
    list,
    extras,
  );
  openOverlay(s.dialog);
  if (!o.mine) return;

  list.setAttribute("aria-busy", "true");
  void api.progress().then((result) => {
    if (!s.dialog.isConnected) return;
    list.removeAttribute("aria-busy");
    if (!result.ok) {
      // Your levels still show, as anyone sees them, with why the rest didn't come.
      list.replaceChildren(...publicRows());
      const problem = errorLine();
      problem.textContent = result.message;
      extras.replaceChildren(problem);
      return;
    }
    const p = result.data;
    total.textContent = `Level ${p.level}. ${plural(p.nextAt - p.points, "point", "points")} to level ${p.level + 1}.`;
    list.replaceChildren(
      ...p.skills.map((sk) =>
        skillRow(
          ownSkillRow(
            sk,
            p.next.find((n) => n.skill === sk.skill),
          ),
          sk.level,
        ),
      ),
    );
    const wear = wearNote(p, o.dressUp);
    extras.replaceChildren(
      titlePicker(p, (title) => o.onTitle?.(title)),
      ...(wear ? [wear] : []),
    );
  });
}
