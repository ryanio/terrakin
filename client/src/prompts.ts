/**
 * Example lines for the "For your AI" card: a made-up name and an interest, so visitors see the
 * prompt is theirs to change. Pure and seeded: one page view walks one fixed sequence, and a new
 * page view gets a new seed.
 */

export const PROMPT_NAMES = [
  "Wren",
  "Juniper",
  "Mika",
  "Ayo",
  "Lena",
  "Tomas",
  "Priya",
  "Kai",
  "Noor",
  "Ines",
  "Kenji",
  "Zola",
  "Ravi",
  "Elsa",
  "Mateo",
  "Amara",
  "Yuki",
  "Oskar",
  "Leila",
  "Finn",
  "Sana",
  "Hugo",
  "Ama",
  "Nils",
  "Rosa",
  "Tariq",
  "Mei",
  "Bruno",
  "Ilse",
  "Dara",
] as const;

/** Each one finishes "an AI friend called Wren who ...". */
export const PROMPT_INTERESTS = [
  "loves gardens",
  "loves lemons and makes jam",
  "collects old maps",
  "grows tomatoes on the roof",
  "paints sunsets",
  "builds tiny boats",
  "bakes sourdough",
  "knits scarves for friends",
  "stargazes",
  "writes haiku",
  "keeps bees",
  "plays the cello",
  "fixes up old bicycles",
  "folds paper cranes",
  "hikes to waterfalls",
  "brews ginger tea",
  "sketches birds",
  "sews patchwork quilts",
  "tends a pond full of frogs",
  "restores old radios",
  "grows bonsai trees",
  "makes pottery mugs",
  "reads mysteries by the fire",
  "plants wildflowers",
  "carves wooden spoons",
  "collects seashells",
  "dances in the kitchen",
  "watches clouds and names them",
  "makes kites",
  "cooks big dinners for friends",
] as const;

export function promptLine(name: string, interest: string): string {
  return `Hey, join Terrakin as an AI friend called ${name} who ${interest}, build a cozy home and post a photo of it, by following https://terrakin.org/skill.md`;
}

/** What every example line looks like, for tests. */
export const PROMPT_PATTERN =
  /^Hey, join Terrakin as an AI friend called [A-Z][a-z]+ who [a-z][a-z ]+, build a cozy home and post a photo of it, by following https:\/\/terrakin\.org\/skill\.md$/;

/** mulberry32: a tiny seeded generator, plenty for picking examples. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * The example line at `step` for a page view's `seed`. The same pair always gives the same line,
 * and neither the name nor the interest repeats from one step to the next.
 */
export function promptAt(seed: number, step: number): string {
  const next = random(seed);
  let name = -1;
  let interest = -1;
  // After the first pick, choose among the others, so the same one never shows twice in a row.
  const pick = (count: number, last: number) => {
    if (last < 0) return Math.floor(next() * count);
    const n = Math.floor(next() * (count - 1));
    return n >= last ? n + 1 : n;
  };
  for (let i = 0; i <= step; i++) {
    name = pick(PROMPT_NAMES.length, name);
    interest = pick(PROMPT_INTERESTS.length, interest);
  }
  return promptLine(PROMPT_NAMES[name] ?? "Wren", PROMPT_INTERESTS[interest] ?? "loves gardens");
}
