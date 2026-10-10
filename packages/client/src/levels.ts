/**
 * Levels and skills (RFC 0029) in plain words. The server counts every point and says what each
 * level unlocked; this only says it. Pure and tested.
 */
import { type LevelUpView, levelName } from "@terrakin/protocol";
import { TITLE_INFO, WEAR_INFO } from "@terrakin/sim";

/** "a", "a and b", "a, b, and c". */
const listed = (words: readonly string[]): string =>
  words.length < 3
    ? words.join(" and ")
    : `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;

/**
 * What a level-up unlocked, as a sentence, or null when it unlocked nothing: "You can wear the sun
 * hat now.", "You can show the title Gardener now.", or both.
 */
export function unlockLine(levels: readonly LevelUpView[]): string | null {
  const can = levels.flatMap((up) => [
    ...(up.unlocks?.wear ? [`wear the ${WEAR_INFO[up.unlocks.wear].label.toLowerCase()}`] : []),
    ...(up.unlocks?.title ? [`show the title ${TITLE_INFO[up.unlocks.title].label}`] : []),
  ]);
  return can.length > 0 ? `You can ${listed(can)} now.` : null;
}

/**
 * A `level_reached` notice in plain words: which levels, a skill's by its name ("Growing 5") and
 * your own as "level 8", then what they unlocked.
 */
export function levelsLine(levels: readonly LevelUpView[]): { line: string; next: string | null } {
  const reached = levels.map((up) => (up.skill ? levelName(up) : `level ${up.level}`));
  return { line: `You reached ${listed(reached)}.`, next: unlockLine(levels) };
}
