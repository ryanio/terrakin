/**
 * The skills sheet (RFC 0029), opened from the level chip on a profile: five rows, one a skill,
 * each with its level, a bar, and what it unlocks next. Anyone's shows levels only, from the
 * profile's `level`. Your own asks `GET /v1/progress` and adds what only you may see: the points to
 * each next level, what today has counted against the cap, the titles you may show (a tap sends
 * `profile` with `title`), and the earned wear that's yours to put on. In a world with jobs open
 * (RFC 0030) a sixth row counts the jobs they've finished, which is public, with the next thing
 * that count brings, and your own sheet asks `GET /v1/jobs` for the titles and the satchel your
 * count has unlocked. The server counts and checks everything; a refusal shows in its words.
 * Loaded on its own, when a chip is tapped.
 */
import type { LevelView, ProgressResponse } from "@terrakin/protocol";
import {
  EARNED_WEAR,
  EARNED_WEAR_SKILL,
  jobUnlocks,
  PROGRESS,
  type ShownTitle,
  SKILLS,
  type Skill,
  titleLabel,
  UNLOCKS,
  WEAR_INFO,
  type WearItem,
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
import { jobsApi } from "./api/jobs";
import { progressApi } from "./api/progress";
import { actProblem, worldApi } from "./api/world";
import { jobsRow, jobTitles, jobWear } from "./jobs";
import { ownSkillRow, publicSkillRow, type SkillRow } from "./levels";
import "./level-sheet.css";

export interface LevelSheetOptions {
  /** Whose skills these are. Their name is their own words: shown as text. */
  name: string;
  /** Their levels as the profile has them. */
  level: LevelView;
  /** How many jobs they've finished, from their profile. Absent in a world where jobs aren't open. */
  jobs?: number | undefined;
  /** Your own profile: the sheet also shows your points, today's counts, and your titles. */
  mine: boolean;
  /** You picked a title, or none: the profile repaints its chip. */
  onTitle?: (title: ShownTitle | undefined) => void;
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

/**
 * The row that counts jobs finished (RFC 0030): the satchel the count brings, faint until it's
 * reached, "Jobs: 12 finished", a bar to the next thing the count unlocks, and what that is.
 */
function jobsCountRow(finished: number): HTMLLIElement {
  const row = jobsRow(finished);
  return itemRow({
    plain: true,
    className: `level-row level-jobs${row.wear?.reached ? " reached" : ""}`,
    attrs: { "data-jobs": String(finished) },
    lead: row.wear
      ? itemArt(row.wear.item, {
          size: 32,
          title: row.wear.reached
            ? WEAR_INFO[row.wear.item].label
            : `${WEAR_INFO[row.wear.item].label}, not reached yet`,
        })
      : null,
    name: row.name,
    lines: [progressBar(row.bar.count, row.bar.total, row.bar.label), ...row.lines],
  });
}

/**
 * The titles you may show, as chips, with None first: the ones your skills' levels unlocked, the
 * ones your count of jobs finished did (`fromJobs`, RFC 0030), and the one you show now. A tap asks
 * the server. `jobsOpen` adds how many jobs the first of those takes to the line a resident with
 * no title reads.
 */
function titlePicker(
  progress: ProgressResponse,
  fromJobs: readonly ShownTitle[],
  jobsOpen: boolean,
  onTitle: (title: ShownTitle | undefined) => void,
): HTMLElement {
  const heading = h("h3", { class: "section-title", text: "Title on your profile" });
  if (progress.titles.length === 0 && fromJobs.length === 0 && !progress.title) {
    const jobsAt = jobsOpen ? jobUnlocks().find((u) => u.title)?.jobs : undefined;
    return h(
      "section",
      { class: "stack tight level-titles" },
      heading,
      h("p", {
        class: "hint",
        text:
          jobsAt === undefined
            ? `Your first title comes with level ${UNLOCKS.title} in any skill.`
            : `Your first title comes with level ${UNLOCKS.title} in any skill, or with ${jobsAt} jobs finished.`,
      }),
    );
  }
  type Choice = ShownTitle | "none";
  const problem = errorLine("level-title-error");
  let shown: Choice = progress.title ?? "none";
  const press = (value: Choice) => {
    for (const chip of picker.row.children) {
      chip.setAttribute("aria-pressed", String(chip.getAttribute("data-value") === value));
    }
  };
  const picker = chips<Choice>(
    [
      "none",
      ...new Set([...progress.titles, ...fromJobs, ...(progress.title ? [progress.title] : [])]),
    ],
    shown,
    (value) =>
      value === "none" ? [h("span", { text: "None" })] : [h("span", { text: titleLabel(value) })],
    async (value) => {
      if (value === shown) return;
      problem.textContent = "";
      const r = await worldApi.act({ type: "profile", title: value === "none" ? null : value });
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

/**
 * The earned wear that's yours, from your skills' levels and from jobs finished, with a way to the
 * look editor, which takes the sheet's place.
 */
function wearNote(
  wear: readonly WearItem[],
  dressUp: (() => void) | undefined,
): HTMLElement | null {
  if (wear.length === 0) return null;
  return h(
    "section",
    { class: "stack tight level-wear" },
    h("h3", { class: "section-title", text: "Yours to wear" }),
    h(
      "div",
      { class: "cluster" },
      ...wear.map((w) =>
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
  const publicRows = (waiting = false) => [
    ...SKILLS.map((skill) =>
      skillRow(publicSkillRow(skill, o.level.skills[skill]), o.level.skills[skill], waiting),
    ),
    // The count of jobs finished is public, so it needs no waiting.
    ...(o.jobs === undefined ? [] : [jobsCountRow(o.jobs)]),
  ];
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
  // What your count of jobs unlocked is yours alone to read, and asked for only where jobs are open.
  const standing = o.jobs === undefined ? null : jobsApi.jobs();
  void Promise.all([progressApi.progress(), standing]).then(([result, jobs]) => {
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
      ...(o.jobs === undefined ? [] : [jobsCountRow(o.jobs)]),
    );
    const unlocked = jobs?.ok ? (jobs.data.you?.unlocked ?? []) : [];
    const wear = wearNote([...p.wear, ...(jobWear(unlocked) as WearItem[])], o.dressUp);
    extras.replaceChildren(
      titlePicker(p, jobTitles(unlocked), o.jobs !== undefined, (title) => o.onTitle?.(title)),
      ...(wear ? [wear] : []),
    );
  });
}
