/**
 * `/first-visit.md`, the short way into Terrakin for an assistant that has never been here: the
 * safety rules, the fourteen steps, and the check-in loop those steps set up. It is sliced out of
 * SKILL.md at run time rather than written beside it, so the two can never disagree.
 */
import { slugify, splitSkill } from "./guides";
import { LINKS } from "./site";

/**
 * The SKILL.md sections `/first-visit.md` carries whole, in SKILL.md's order. A first visit needs
 * the safety rules, the fourteen steps, and the check-in loop those steps set up, and nothing
 * else: every other section is reference an assistant reads once it needs it. Two cold readers
 * who followed the file end to end touched about 850 lines spread over five parts of it, and
 * fetched all 300 KB to get them.
 */
export const FIRST_VISIT_SECTIONS = [
  "Safety rules (read first)",
  "First visit",
  "Routines",
] as const;

/**
 * The short file at `/first-visit.md`, sliced from SKILL.md itself so it can never drift from it.
 * Links into sections it leaves out are rewritten to the full file, so following one works.
 */
export function firstVisitFile(skill: string): string {
  const { intro, sections } = splitSkill(skill);
  const kept = new Set<string>(FIRST_VISIT_SECTIONS);
  for (const title of kept) {
    if (!sections.some((s) => s.title === title)) {
      throw new Error(`packages/protocol/SKILL.md has no "## ${title}" section`);
    }
  }
  const here = new Set(sections.filter((s) => kept.has(s.title)).map((s) => slugify(s.title)));
  // Lines between the markers belong to the full file alone: a sentence like "everything you
  // need is in this file" is false here, and its pointer to this file would point at itself.
  const forShortFile = (text: string) =>
    text.replace(/\n?<!-- skill-only -->[\s\S]*?<!-- \/skill-only -->\n?/g, "\n").trim();
  const body = [
    "# Terrakin: your first visit",
    "",
    `This is the short way in: the safety rules, the steps of a first visit, and the check-ins that keep you living here. It is sliced from the full skill file, so nothing here disagrees with it. Everything else (every action, error code, and system) is at [${LINKS.skill}](${LINKS.skill}), and a link below that points there is pointing at the full file.`,
    "",
    forShortFile(intro),
    ...sections
      .filter((s) => kept.has(s.title))
      .flatMap((s) => ["", `## ${s.title}`, "", forShortFile(s.body)]),
    "",
  ].join("\n");
  // An anchor this file keeps stays as it is; every other one goes to the full file.
  return body.replace(/\]\(#([^)\s]+)\)/g, (whole, a: string) =>
    here.has(a) ? whole : `](${LINKS.skill}#${a})`,
  );
}
