/**
 * The town's jobs (RFC 0030) in plain words. The server owns the board, every bound, and every
 * count, and says whether you can take a job (`you.canTake` and `you.why`); this only says it, and
 * picks which button a row shows from that answer. A job's words are the server's fixed ones, and
 * the giver's name is the town's own, never a resident's text. Pure and tested.
 */
import type {
  HeldJobView,
  JobDeedView,
  JobGiverView,
  JobsResponse,
  JobView,
} from "@terrakin/protocol";
import {
  BIOME_PLACES,
  CARD_RECIPES,
  CATALOG,
  CROP_INFO,
  type CraftKind,
  type Crop,
  ITEM_INFO,
  type ItemKind,
  isJobWear,
  JAM,
  type JobWear,
  jobUnlocks,
  type RecipeName,
  type ShownTitle,
  STARTER_SEEDS,
  skillName,
  type TimeOfDay,
  titleLabel,
  WEAR_INFO,
} from "@terrakin/sim";
import { plural } from "@terrakin/ui/format";
import { aThing, needsLine, thingCount } from "./things";

/** Where you stand, as `GET /v1/jobs` answers with a token. */
export type JobStanding = NonNullable<JobsResponse["you"]>;

/** What the board and the held job share: enough to say who asked and what for. */
export type JobAsked = Pick<JobView, "from" | "skill" | "title" | "shape" | "deed" | "bring">;

/**
 * Who a job is for, after "for": the giver's name while that townsfolk lives in this world, else
 * the town, as the server's own lines have it.
 */
const forWhom = (from: JobGiverView): string => (from.id === undefined ? "the town" : from.name);

/** A board row's line under the job's words: "For Bram". */
export const askedLine = (from: JobGiverView): string => `For ${forWhom(from)}`;

/**
 * The line under the board: "2 of 3 left this week." When none are left, the server's `why` says
 * when the next can be taken, so this never says it again.
 */
export const weekLine = (week: JobStanding["week"]): string =>
  `${Math.max(0, week.max - week.done)} of ${week.max} left this week.`;

/**
 * The words over the board: how many the town asks for a day and what one pays, from the server's
 * own numbers, and then whether to take one. Someone not signed in has no button to take one with,
 * so they're told how to get one.
 */
export const boardLede = (rules: JobsResponse["rules"], signedIn: boolean): string =>
  `Small things the townsfolk ask for, ${rules.board} a day. Do one anywhere in the world and it adds ${rules.points} points to a skill, which raise your level and unlock titles and clothes. Jobs never pay coins. Bounties do. ${
    signedIn ? "Take one only if you'd enjoy it." : "Step into the world to take one."
  }`;

/** The seeds a crop grows from, in running words: "herb seeds". */
const seedsOf = (crop: Crop): string => {
  const seed = CROP_INFO[crop].seed;
  return seed ? ITEM_INFO[seed].plural.toLowerCase() : "seeds";
};

/** How to grow what a harvest job counts: any crop, or the one it names, and where its seeds come from. */
function harvestHow(crops: readonly Crop[] | undefined): string {
  const one = crops?.length === 1 ? crops[0] : undefined;
  if (one === undefined) {
    return "Plant seeds in a planter on your plot, then harvest them once they're ripe.";
  }
  const seed = CROP_INFO[one].seed;
  const bought = seed !== undefined && !(STARTER_SEEDS as readonly string[]).includes(seed);
  return `Plant ${seedsOf(one)} in a planter on your plot, then harvest them once they're ripe.${
    bought ? " The town shop sells the seeds." : ""
  }`;
}

/**
 * How to make what a craft or bring job asks for: the station, what it takes, and, for a recipe
 * nobody starts out knowing, where to learn it. Jam is any fruit's, so it takes three of one fruit.
 */
function makeHow(recipe: RecipeName): string {
  const card = CARD_RECIPES.includes(recipe)
    ? " Don't know the recipe? The town shop sells recipe cards."
    : "";
  if (recipe === JAM.suffix) {
    const plus = Object.entries(JAM.plus).map(([kind, n]) => thingCount(kind as ItemKind, n));
    return `Make it at a ${JAM.station}: it takes ${JAM.count} of one fruit, ${plus.join(", ")}.${card}`;
  }
  const station = CATALOG[recipe as CraftKind]?.recipe?.station;
  const needs = needsLine(recipe as Parameters<typeof needsLine>[0]);
  const where = station === "kiln" ? "Fire it in a kiln on your plot" : `Make it at a ${station}`;
  return `${where}: it takes ${needs}.${card}`;
}

/** When a fish job's catch has to bite, after "Only a fish caught". */
const WHEN: Readonly<Record<TimeOfDay, string>> = {
  dawn: "at dawn",
  day: "by day",
  dusk: "at dusk",
  night: "at night",
};

/**
 * How to do a job, in one plain line, from what its deed counts or what it asks you to bring: where
 * to go and what to tap. Every claim is the sim's rule for that deed (`fits` and the `...Counts`
 * rules a job reads), never a rule of its own.
 */
export function howLine(job: Pick<JobAsked, "deed" | "bring">): string {
  if (job.bring) return makeHow(job.bring.recipe);
  const deed = job.deed;
  if (!deed) return "";
  switch (deed.type) {
    case "harvest":
      return harvestHow(deed.crops);
    case "craft":
      return makeHow(deed.recipe);
    case "find": {
      const where = deed.biome ? ` Look for one ${BIOME_PLACES[deed.biome]}.` : "";
      const which = deed.kinds?.length
        ? ` It has to be ${deed.kinds.map((k) => aThing(k)).join(" or ")}.`
        : "";
      return `Finds sparkle on the ground here and there. Tap one to pick it up.${where}${which}`;
    }
    case "fish": {
      const when = deed.timeOfDay ? ` Only a fish caught ${WHEN[deed.timeOfDay]} counts.` : "";
      return `Make a fishing rod at a workbench, stand beside a pond or the sea, and tap Fish.${when}`;
    }
    case "teach":
      return "Tap a neighbor in the world and teach them a recipe you know. They need a home of their own.";
    case "guest":
      return "Go to an event on the Town Hall's calendar while it's on, and stay a while.";
    case "host":
      return `Host an event from Coming up at the Town Hall. ${plural(deed.guests, "guest has", "guests have")} to come and stay a while.`;
    case "bounty":
      return "Take a bounty from the bounties page and do it. It counts once you're paid.";
    case "game":
      return deed.first
        ? "Sit at a game table in the town square and play to the end. You have to finish first."
        : "Sit at a game table in the town square and play to the end.";
  }
}

/**
 * What a board row offers: Take when the server says one can be taken, a mark on the job you
 * already hold, and nothing otherwise (nobody signed in, or the server's reason, which the list
 * says once under its rows).
 */
export type JobRowAction = "take" | "held" | "none";
export function jobRowAction(job: Pick<JobView, "id">, you: JobStanding | null): JobRowAction {
  if (!you) return "none";
  if (you.held?.job === job.id) return "held";
  return you.canTake ? "take" : "none";
}

/**
 * Why no row has a Take button, in the server's words (`why` comes only when none can be taken),
 * or null when the reason is already on screen: the job you hold sits above the list.
 */
export const cantTakeLine = (you: JobStanding | null): string | null =>
  !you || you.held ? null : (you.why ?? null);

/** A bring job's thing in running words: "herb tea", "pumpkin pie", "jam" for any fruit's. */
const broughtThing = (recipe: RecipeName): string =>
  Object.hasOwn(ITEM_INFO, recipe)
    ? ITEM_INFO[recipe as keyof typeof ITEM_INFO].name.toLowerCase()
    : recipe;

/**
 * A refused `take_job`, `hand_in`, or `drop_job` in the page's words. The server writes its
 * messages for agents, so the codes whose message names an action to send, a field, or a job by
 * its id get a line of our own, and the rest keep the server's text, like when the next job can be
 * taken. A refused hand-in names the thing the job you hold asks for (`bring`, its recipe), and
 * says so when the one you hold was made by someone else: the server's message for that case is
 * the one that starts "Someone else made".
 */
export function jobProblem(code: string, message: string, bring?: RecipeName): string {
  switch (code) {
    case "job_held":
      return "You already hold a job. Finish it, or let it go, before you take another.";
    case "unknown_job":
      return "That job isn't on today's board anymore. The board changes at midnight UTC.";
    case "no_job":
      return "You aren't holding that job anymore.";
    case "nothing_to_hand_in": {
      if (bring === undefined) return message;
      const thing = broughtThing(bring);
      return message.startsWith("Someone else made")
        ? `The ${thing} you hold was made by someone else. A job takes only what you made yourself.`
        : `You hold no ${thing} that you made yet.`;
    }
    default:
      return message;
  }
}

/**
 * What the error line under the board says after the board was read again: nothing once the
 * board's own line (`cantTakeLine`) says the same sentence, so a reason never shows twice.
 */
export const shownProblem = (problem: string, you: JobStanding | null): string =>
  problem !== "" && problem === cantTakeLine(you) ? "" : problem;

/**
 * Whether the job sheet has anything to show: a giver's sheet is about what they ask for today,
 * and the chip's about the job you hold. With nothing left it closes, unless a refusal is on
 * screen, which stays until it's read.
 */
export function sheetShows(
  board: Pick<JobsResponse, "jobs" | "you">,
  giver: string | undefined,
  problem = "",
): boolean {
  if (problem !== "") return true;
  return giver === undefined
    ? Boolean(board.you?.held)
    : board.jobs.some((job) => job.from.id === giver);
}

/**
 * Reads of one thing that may overlap, kept in order. Each call asks again, and only the newest
 * ask's answer is handed to `land`: an answer to an older ask is dropped, so a refresh sent before
 * a Take never lands after it and draws the board as it was. Every call resolves once the newest
 * answer has landed, so whoever waits on a read waits for what is on screen.
 */
export function newestOnly<T>(
  ask: () => Promise<T>,
  land: (answer: T) => void,
): () => Promise<void> {
  let newest = 0;
  let landing: Promise<void> = Promise.resolve();
  return () => {
    const mine = ++newest;
    const asking = (async () => {
      const answer = await ask();
      if (mine !== newest) return landing;
      land(answer);
    })();
    landing = asking;
    return asking;
  };
}

/**
 * Open what a tap opens once its code has loaded. When `open` says there's nothing to show, or the
 * code didn't load (a chunk gone after a deploy, a dropped link), `otherwise` does what the tap
 * did before there were jobs, so a tap is never lost.
 */
export function openedOr<T>(
  load: Promise<T>,
  open: (loaded: T) => boolean,
  otherwise: () => void,
): Promise<void> {
  return load
    .then((loaded) => {
      if (!open(loaded)) otherwise();
    })
    .catch(otherwise);
}

/** What the job you hold can do: a bring job is handed in, and any job can be let go. */
export const heldMoves = (held: Pick<HeldJobView, "shape">): ("hand_in" | "drop")[] =>
  held.shape === "bring" ? ["hand_in", "drop"] : ["drop"];

/** A held job's bar: how far along it is, in the words a screen reader says. */
export function heldBar(held: Pick<HeldJobView, "count" | "of" | "shape">): {
  count: number;
  total: number;
  label: string;
} {
  return {
    count: held.count,
    total: held.of,
    label: held.shape === "bring" ? "Not handed in yet" : `${held.count} of ${held.of} done`,
  };
}

/** The line under a held job's bar: where it stands, and what finishes it. */
export function heldJobLine(held: Pick<HeldJobView, "count" | "of" | "shape">): string {
  if (held.shape === "bring") return "Make it yourself, then hand it in. It goes to the town.";
  return `${held.count} of ${held.of} done.`;
}

/** How long a held job is kept, from the world's day: "5 days left to finish it." */
export function keptLine(held: Pick<HeldJobView, "lapsesDay">, day: number | null): string | null {
  if (day === null) return null;
  const days = held.lapsesDay - day;
  if (days <= 0) return null;
  return days === 1
    ? "Today is the last day to finish it. Nothing is lost if it lapses."
    : `${days} days left to finish it. Nothing is lost if it lapses.`;
}

/** The world's chip while you hold a job: "Job: 1 of 3". */
export const chipLabel = (held: Pick<HeldJobView, "count" | "of">): string =>
  `Job: ${held.count} of ${held.of}`;

/** One kind's plural in running words: "herbs", "jars of lemon jam". */
const kinds = (kind: string): string | undefined =>
  Object.hasOwn(ITEM_INFO, kind)
    ? ITEM_INFO[kind as keyof typeof ITEM_INFO].plural.toLowerCase()
    : undefined;

/** What a deed job counts, as the words after "2 of 3": "harvests of herbs", "fish", "games". */
function deedNoun(deed: JobDeedView): string {
  switch (deed.type) {
    case "harvest": {
      // A harvest counts once however much it brings up, so the word is the harvest, with the
      // crop as the job's own words have it: "harvests of herbs", not "bunches of herbs".
      const crop = deed.crops?.length === 1 ? kinds(deed.crops[0] ?? "") : undefined;
      return crop ? `harvests of ${crop.replace(/^.+ of /, "")}` : "harvests";
    }
    case "craft":
      return kinds(deed.recipe) ?? "made";
    case "find":
      return "finds";
    case "fish":
      return "fish";
    case "teach":
      return "lessons";
    case "guest":
    case "host":
      return "events";
    case "bounty":
      return "bounties";
    case "game":
      return deed.first ? "wins" : "games";
  }
}

/** A deed that moved your job: "2 of 3 harvests of herbs for Juniper." */
export function progressLine(
  progress: { count: number; of: number },
  job: Pick<JobAsked, "from" | "deed"> | undefined,
): string {
  const so = `${progress.count} of ${progress.of}`;
  if (!job) return `Your job: ${so} done.`;
  return `${so} ${job.deed ? deedNoun(job.deed) : "done"} for ${forWhom(job.from)}.`;
}

/**
 * A job you just finished: "Job done for Juniper: 10 Growing points." It joins the toast of the
 * deed that finished it, so it stays one short sentence: the week's count is at the Town Hall, and
 * what the count unlocked is in the `job_done` notice.
 */
export function doneLine(
  done: { skill: JobView["skill"]; points: number },
  from: JobGiverView | undefined,
): string {
  const whom = from ? ` for ${forWhom(from)}` : "";
  return `Job done${whom}: ${done.points} ${skillName(done.skill)} points.`;
}

/** A job that lapsed after its seven days, or one you let go. */
export const droppedLine = (lapsed: boolean): string =>
  lapsed ? "Your job lapsed. Nothing is lost, and you can take another." : "You let the job go.";

/** One thing the count unlocks, in a few words: "the town satchel", "the title Helping hand". */
const unlockWords = (u: { title?: ShownTitle | undefined; wear?: JobWear | undefined }): string =>
  u.wear
    ? `the ${WEAR_INFO[u.wear].label.toLowerCase()}`
    : `the title ${titleLabel(u.title as ShownTitle)}`;

/**
 * The skills sheet's row for jobs: "Jobs: 12 finished", a bar from the last thing the count
 * unlocked to the next, and what that is. Full, with nothing left to say, past the last one.
 */
export function jobsRow(finished: number): {
  name: string;
  bar: { count: number; total: number; label: string };
  lines: string[];
  /** The garment the count brings, and whether it's reached, for the row's picture. */
  wear: { item: JobWear; reached: boolean } | undefined;
} {
  const unlocks = jobUnlocks();
  const garment = unlocks.find((u) => u.wear);
  const wear =
    garment?.wear === undefined
      ? undefined
      : { item: garment.wear, reached: finished >= garment.jobs };
  const name = `Jobs: ${finished} finished`;
  const next = unlocks.find((u) => u.jobs > finished);
  if (!next) {
    return {
      name,
      bar: { count: 1, total: 1, label: "Everything jobs bring is yours" },
      lines: ["Nothing left to unlock."],
      wear,
    };
  }
  const from = Math.max(0, ...unlocks.filter((u) => u.jobs <= finished).map((u) => u.jobs));
  const count = finished - from;
  const total = next.jobs - from;
  return {
    name,
    bar: {
      count,
      total,
      label: `${count} of ${plural(total, "job", "jobs")} to ${unlockWords(next)}`,
    },
    lines: [`${plural(next.jobs, "job", "jobs")} finished bring ${unlockWords(next)}.`],
    wear,
  };
}

/** The titles your count of jobs has unlocked, from `you.unlocked`, for the title picker. */
export const jobTitles = (unlocked: JobStanding["unlocked"]): ShownTitle[] =>
  unlocked.flatMap((u) => (u.title ? [u.title] : []));

/** The garments your count of jobs has unlocked, from `you.unlocked`, for the look editor. */
export const jobWear = (unlocked: JobStanding["unlocked"]): JobWear[] =>
  unlocked.flatMap((u) => (isJobWear(u.wear) ? [u.wear] : []));

/** What the look editor says on the job garment before it's reached: "25 jobs". */
export function jobWearAt(item: JobWear): string {
  const at = jobUnlocks().find((u) => u.wear === item)?.jobs;
  return at === undefined ? "Jobs" : plural(at, "job", "jobs");
}
