import { checkAwardGrant } from "./awards";
import {
  type BountiesChecked,
  bountiesNewDay,
  checkCancelBounty,
  checkClaimBounty,
  checkCompleteBounty,
  checkConfirmBounty,
  checkConfirmTownBounty,
  checkDropBounty,
  checkOpenBounties,
  checkPostBounty,
  checkReopenBounty,
  checkVoidBounty,
} from "./bounties";
import { type BuildPlan, checkBuild } from "./build";
import { checkOpenPresent, checkTownPresents, presentsNewDay } from "./christmas";
import {
  checkCancelCircleInvite,
  checkChipInCircle,
  checkCircleTitle,
  checkClearCircleName,
  checkDeclineCircleInvite,
  checkDisbandCircle,
  checkFoundCircle,
  checkInviteToCircle,
  checkJoinCircle,
  checkLeaveCircle,
  checkNameCircle,
  checkOpenCircles,
  checkRemoveFromCircle,
  checkSetCircleHall,
  checkSetCircleSteward,
  circlesNewDay,
  hallsLeavingPlot,
} from "./circles";
import { checkClearBlock } from "./clear-block";
import {
  checkAdmire,
  checkDisplay,
  checkMakePiece,
  checkRemoveDisplay,
  checkSetGallery,
  checkTakeDown,
  displayRemoveProblem,
  returnHeldAside,
} from "./display";
import {
  allowanceDue,
  checkEconomyServer,
  checkGive,
  type EconomyChecked,
  economyNewDay,
  economyTownsfolkChange,
  isTownsfolk,
  markNewcomer,
  payAllowance,
  payWelcome,
  welcomeDue,
} from "./economy";
import { checkSetEntitlements, unentitled } from "./entitlements";
import {
  checkAttendAtTen,
  checkCancelEvent,
  checkEventEnd,
  checkEventStart,
  checkEventTick,
  checkJoinEvent,
  checkScheduleEvent,
  checkScheduleInPerson,
  checkScheduleTownEvent,
  checkVoidEvent,
  type EventsChecked,
  eventsLeavingPlot,
  eventsNewDay,
} from "./events";
import { checkFish } from "./fishing";
import {
  blockProblem,
  checkAddFloor,
  checkClimb,
  floorField,
  floorGround,
  floorOf,
  layerFor,
  noFlooringHint,
  outOfReachHere,
  plotHasAnything,
  removeProblem,
  setFloor,
  stairwellProblem,
  standingFloor,
} from "./floors";
import { checkStarterDoors } from "./front-doors";
import {
  checkCloseRound,
  checkCloseTable,
  checkDecide,
  checkOpenTable,
  checkSit,
  checkStand,
  checkStartGame,
  type GamesChecked,
  gamesNewDay,
} from "./games";
import { checkGather, checkOpenFinds, checkOpenWayPickups, checkOwnPlotPickups } from "./gather";
import { checkLay, checkLift } from "./ground";
import { checkTrickOrTreat, halloweenNewDay } from "./halloween";
import { canonicalJson, fnv1a } from "./hash";
import { HOLIDAY_INFO, holidayDates, inHoliday } from "./holiday";
import {
  blockNeeds,
  blockPlaceProblem,
  blockRemoveProblem,
  checkCraft,
  checkDeclineGift,
  checkGiveItem,
  checkHarvest,
  checkOpenGifts,
  checkOpenItems,
  checkPlant,
  checkRaiseInventory,
  cropAt,
  type ItemsChecked,
  itemsNewDay,
  moveBlockCost,
  pantryDue,
  payPantry,
} from "./items";
import {
  checkDropJob,
  checkHandIn,
  checkJobTitle,
  checkOpenJobs,
  checkSetJobEdition,
  checkTakeJob,
  creditJob,
  jobsNewDay,
  unearnedJobWear,
} from "./jobs";
import { plotKey, tileKey } from "./keys";
import { checkOpenLand, isStreet, onLand, squareWords, streetWords } from "./lands";
import {
  checkCreditEvent,
  checkOpenLevels,
  checkTitle,
  levelsNewDay,
  unearnedWear,
} from "./levels";
import {
  HAIR_COLORS,
  HAIR_STYLES,
  isShopWear,
  LOOK_KEYS,
  LOOK_MEDIA_KEYS,
  type Look,
  lookOf,
  MEDIA_ID_PATTERN,
  mergeWearStyles,
  PATTERNS,
  sortWear,
  THEMES,
  wearProblem,
  wearStyleProblem,
} from "./looks";
import {
  checkBuyListing,
  checkListItem,
  checkOpenMarket,
  checkRemoveListing,
  checkUnlistItem,
  type MarketChecked,
} from "./market";
import { checkMergeResident, mergedInto } from "./merge";
import { checkRenameResident, NAME_MAX_LENGTH } from "./names";
import { checkSetOffFirework } from "./newyear";
import { nearestFreePlot } from "./openings";
import { residentById } from "./own";
import {
  checkAdoptPet,
  checkGroomPet,
  checkRenamePet,
  checkTreatPet,
  checkWalkPet,
  type PetsChecked,
  petView,
} from "./pets";
import {
  anotherPlotWords,
  checkBuyPlot,
  checkListPlot,
  checkOpenPlotMarket,
  checkRemovePlotListing,
  checkUnlistPlot,
  plotListedProblem,
  tileListedProblem,
} from "./plot-market";
import { checkClearPlotName, checkNamePlot } from "./plot-names";
import {
  checkOpenClay,
  checkPlacePot,
  checkTakeUpPot,
  KILN,
  kilnRemoveProblem,
  POT_BLOCK,
  potteryClosed,
} from "./pottery";
import { checkImplicitPresence, checkLeaveIdle, type PresenceChecked } from "./presence";
import { isDirection, PUTTER_MAX_STEPS } from "./putter";
import { checkRebuildHome } from "./rebuild-home";
import {
  checkBuyCard,
  checkOpenRecipes,
  checkPickRecipe,
  checkSetPageEdition,
  checkTeach,
  isCardSku,
  type RecipesChecked,
  recipeUnknown,
} from "./recipes";
import { currentCommand } from "./renamed";
import { checkRetireRepeatJoins, isRetired } from "./repeat-joins";
import { checkRest } from "./rest";
import { checkSetRoof } from "./roofs";
import { checkRoutineStep, checkSetRoutines, type RoutinesChecked } from "./routines";
import {
  checkLowerHolidayPrices,
  checkOpenShop,
  checkSellToTown,
  checkSetShopShare,
  checkShopBuy,
  checkShopInPerson,
  ownsWear,
  type ShopChecked,
  shopNewDay,
  stockHoliday,
} from "./shop";
import { checkTestGrant } from "./test-grant";
import { checkBringDish } from "./thanksgiving";
import {
  checkKeepTableSpots,
  checkPropose,
  checkProposeInPerson,
  checkTown,
  isActivity,
  isServerCommand,
  type TownChecked,
} from "./town";
import type {
  ApplyResult,
  Command,
  Input,
  Plot,
  ProfileFields,
  Rejection,
  RejectionCode,
  Resident,
  Tile,
  WorldConfig,
  WorldEvent,
  WorldState,
} from "./types";
import {
  BLOCK_KINDS,
  isCircleTitle,
  isJobTitle,
  RESIDENT_COLORS,
  RESIDENT_SHAPES,
  TOWN_ACTOR,
} from "./types";
import { checkVisit } from "./visit";
import { checkSolidBuildings, STEPS_GO, stepFrom, walkSteps } from "./walk";
import { checkCloseWay, checkOpenWay, isWay, wayProblem } from "./ways";
import {
  canBuildOn,
  chebyshev,
  claimLimit,
  inBounds,
  isSolid,
  isTownSquare,
  plotAtTile,
  plotCenter,
  plotOf,
  plotsOwnedBy,
  STEP,
  settleProblem,
  spawnTile,
  starterHome,
} from "./world";

export { NAME_MAX_LENGTH } from "./names";
export const NOTE_MAX_LENGTH = 80;

/** How many residents an owner can share one plot with. */
export const MAX_CO_OWNERS = 3;

/**
 * A validated input, ready to commit. `commit()` mutates the state it was prepared against,
 * bumps `seq`, and returns the events. Call it at most once, and only if the state hasn't changed
 * since `prepare()`. A `build` also carries `plan`, the changes its commit makes, worked out with
 * the actor as the commit will find them, so the server answers with what the sim does. A
 * `commons_build` proposal carries the plan it would build in the Commons if it passed now.
 */
export type Prepared =
  | { ok: true; commit: () => { seq: number; events: WorldEvent[] }; plan?: BuildPlan }
  | { ok: false; rejection: Rejection };

const reject = (code: RejectionCode, message: string): Prepared => ({
  ok: false,
  rejection: { code, message },
});

/** `out_of_reach` for building at `at`, worded for building, or null when it's within reach. */
const outOfBuildReach = (state: WorldState, me: Resident, at: Tile) =>
  outOfReachHere(
    state,
    me,
    at,
    state.config.reach,
    `You can only build within ${state.config.reach} tiles.`,
  );

/**
 * `out_of_reach` for building on `floor` from the floor `me` stands on, or null: a floor counts
 * as a tile (RFC 0028).
 */
function outOfFloorReach(config: WorldConfig, me: Resident, floor: number): Prepared | null {
  const from = standingFloor(me);
  if (Math.abs(floor - from) <= config.reach) return null;
  return reject(
    "out_of_reach",
    `You can only build within ${config.reach} tiles, and a floor counts as one. Go ${floor > from ? "up" : "down"} the stairs first.`,
  );
}

/** A stable starting look derived from the id, so new residents don't all look alike. */
function defaultLook(id: string): Pick<Resident, "color" | "shape"> {
  const h = Number.parseInt(fnv1a(id), 16);
  return {
    color: RESIDENT_COLORS[h % RESIDENT_COLORS.length] ?? "sun",
    shape:
      RESIDENT_SHAPES[Math.floor(h / RESIDENT_COLORS.length) % RESIDENT_SHAPES.length] ?? "round",
  };
}

type Profile = Pick<Resident, "color" | "shape" | "note"> & Look;

/** Validate profile fields and merge them over `base`. Returns a rejection or the merged profile. */
function mergeProfile(base: Profile, fields: ProfileFields): Profile | Prepared {
  const note = fields.note === undefined ? base.note : fields.note.trim();
  if (note.length > NOTE_MAX_LENGTH) {
    return reject("invalid_profile", `Notes can be at most ${NOTE_MAX_LENGTH} characters.`);
  }
  if (fields.color !== undefined && !RESIDENT_COLORS.includes(fields.color)) {
    return reject("invalid_profile", "Unknown color.");
  }
  if (fields.shape !== undefined && !RESIDENT_SHAPES.includes(fields.shape)) {
    return reject("invalid_profile", "Unknown shape.");
  }
  const look = mergeLook(base, fields);
  if ("ok" in look) return look;
  return { color: fields.color ?? base.color, shape: fields.shape ?? base.shape, note, ...look };
}

/**
 * The look after applying `fields` over `base`. Absent means keep, `null` (or an empty wear list)
 * means clear. Only fields that end up set appear in the result, so a world that never used looks
 * hashes exactly as before.
 */
function mergeLook(base: Look, fields: ProfileFields): Look | Prepared {
  const pick = <K extends Exclude<keyof Look, "wearStyle">>(key: K): Look[K] | null => {
    const value = fields[key];
    return value === undefined ? (base[key] ?? null) : (value as Look[K] | null);
  };
  const out: Look = {};
  const theme = pick("theme");
  if (theme !== null && theme !== undefined) {
    if (!THEMES.includes(theme)) return reject("invalid_profile", "Unknown theme.");
    out.theme = theme;
  }
  const pattern = pick("pattern");
  if (pattern !== null && pattern !== undefined) {
    if (!PATTERNS.includes(pattern)) return reject("invalid_profile", "Unknown pattern.");
    out.pattern = pattern;
  }
  // An earned garment (RFC 0029) is kept in `wear` with the rest: `WEAR_ITEMS` holds the five of
  // them, so `wearProblem` takes one like any wear. Whether this resident has reached it is
  // `unearnedWear`'s to say, with the levels in the world, after the look is checked.
  const wear = pick("wear");
  if (wear !== null && wear !== undefined) {
    if (!Array.isArray(wear)) return reject("invalid_profile", "Wear is a list.");
    const problem = wearProblem(wear);
    if (problem) return reject("invalid_profile", problem);
    if (wear.length > 0) out.wear = sortWear(wear);
  }
  for (const key of LOOK_MEDIA_KEYS) {
    const id = pick(key);
    if (id === null || id === undefined) continue;
    if (typeof id !== "string" || !MEDIA_ID_PATTERN.test(id)) {
      return reject("invalid_profile", "Media must be an upload id like m_0123456789abcdef.");
    }
    out[key] = id;
  }
  // Garment styles merge item by item: null clears them all, and an item set to null clears its own.
  const changes = fields.wearStyle;
  if (changes !== undefined) {
    if (changes !== null) {
      const problem = wearStyleProblem(changes, RESIDENT_COLORS);
      if (problem) return reject("invalid_profile", problem);
    }
    const styles = changes === null ? undefined : mergeWearStyles(base.wearStyle, changes);
    if (styles) out.wearStyle = styles;
  } else if (base.wearStyle) {
    out.wearStyle = base.wearStyle;
  }
  const own = Object.values(out.wearStyle ?? {}).some((s) => s.pattern === "own");
  if (own && !out.patternMedia) {
    return reject("invalid_profile", "A garment in your own pattern needs patternMedia set.");
  }
  const hair = pick("hair");
  if (hair !== null && hair !== undefined) {
    if (!HAIR_STYLES.includes(hair)) return reject("invalid_profile", "Unknown hair style.");
    out.hair = hair;
  }
  const hairColor = pick("hairColor");
  if (hairColor !== null && hairColor !== undefined) {
    if (!HAIR_COLORS.includes(hairColor)) return reject("invalid_profile", "Unknown hair color.");
    out.hairColor = hairColor;
  }
  return out;
}

/**
 * Wear in `fields` that `actor` may not put on, as a rejection, or null: shop wear they haven't
 * bought, a partner's piece (worn or styled) they have no entitlement to (RFC 0007), a garment from
 * a skill level they haven't reached (RFC 0029), or the garment from jobs finished short of its
 * count (RFC 0030), worn or named in `wearStyle` at all.
 */
function unownedWear(state: WorldState, actor: string, fields: ProfileFields): Prepared | null {
  const wear: readonly unknown[] = Array.isArray(fields.wear) ? fields.wear : [];
  const missing = wear.find((w) => isShopWear(w) && !ownsWear(state, actor, w));
  if (missing !== undefined) {
    // A costume the shop isn't selling today: say when it is, since shop_buy would refuse it now.
    const holiday = isShopWear(missing) ? stockHoliday(missing) : undefined;
    if (holiday && (state.day === undefined || !inHoliday(holiday, state.day))) {
      return reject(
        "not_owned",
        `That's from the town shop, which sells it only for ${HOLIDAY_INFO[holiday].name}, ${holidayDates(holiday, state.day)} (UTC). Buy it then with shop_buy, and it's yours to wear any day.`,
      );
    }
    return reject("not_owned", "That's from the town shop. Buy it there with shop_buy first.");
  }
  // A style on partner wear needs the entitlement too (clearing one never does).
  const styled =
    fields.wearStyle && typeof fields.wearStyle === "object"
      ? Object.entries(fields.wearStyle)
          .filter(([, style]) => style !== null)
          .map(([item]) => item)
      : [];
  if (unentitled(state, actor, [...wear, ...styled]) !== undefined) {
    return reject(
      "not_entitled",
      "That's a partner's piece: only its verified characters can wear it.",
    );
  }
  // The job garment takes no style either before its count, not even `null`: no input names it
  // until it's earned, so a world's log holds nothing of jobs before a resident finishes them.
  const named =
    fields.wearStyle && typeof fields.wearStyle === "object" ? Object.keys(fields.wearStyle) : [];
  const unearned =
    unearnedWear(state, actor, wear) ?? unearnedJobWear(state, actor, [...wear, ...named]);
  if (unearned) return { ok: false, rejection: unearned };
  return null;
}

/** Set a resident's profile: every look key in `profile`, and none of the ones it leaves out. */
function setProfile(r: Resident, profile: Profile) {
  r.color = profile.color;
  r.shape = profile.shape;
  r.note = profile.note;
  for (const key of LOOK_KEYS) delete r[key];
  Object.assign(r, lookOf(profile));
}

const sameProfile = (a: Profile, b: Profile) =>
  a.color === b.color &&
  a.shape === b.shape &&
  a.note === b.note &&
  canonicalJson(lookOf(a)) === canonicalJson(lookOf(b));

/**
 * Check an input against the rules without changing anything.
 *
 * Splitting check from commit lets the server persist an input before the world changes: if the
 * write fails, the world is untouched and memory never gets ahead of the log.
 *
 * Contract:
 * - Deterministic: same state + same input always gives the same result. No clocks, no Math.random, no I/O.
 * - `prepare` never mutates. All checks happen here.
 * - `commit` mutates in place, increases `state.seq` by exactly one, and returns events that describe
 *   every change, so clients can mirror the world without re-running the rules.
 */
export function prepare(state: WorldState, input: Input): Prepared {
  const { actor } = input;
  // A command logged under an old name reads as today's, so old logs replay as they were made.
  const command = currentCommand(input.command);
  // Once presence comes with acting (RFC 0014), a known resident acting while offline comes back
  // first, in the same input. The checks run with them back in place, then everything is put back
  // as it was, so nothing changes until commit.
  const back = state.implicitPresence && isActivity(command) ? rejoined(state, actor) : undefined;
  const away = back && residentById(state, actor);
  if (back) state.residents[actor] = back;
  let checked: Checked;
  let welcome: ReturnType<typeof welcomeDue>;
  let newcomer: boolean;
  try {
    checked = check(state, actor, command, back !== undefined);
    // Every command the protocol takes has a rule, so this is a logged command no rule knows: a
    // rename without its old name in `renamed.ts`. Replaying past it would build a different world.
    if (checked === undefined) {
      throw new Error(`No rule for a logged "${command.type}" command, at seq ${state.seq + 1}.`);
    }
    // Coin bookkeeping worked out against the state as it is now (RFC 0008). All of it is a no-op
    // until the economy opens.
    welcome = "ok" in checked ? null : welcomeDue(state, actor, command);
    newcomer = command.type === "join" && !state.residents[actor];
  } finally {
    if (back && away) state.residents[actor] = away;
  }
  if ("ok" in checked) return checked;
  const seq = state.seq + 1;
  const act = typeof checked === "function" ? checked : checked.commit;
  const plan = typeof checked === "function" ? undefined : checked.plan;
  let done = false;
  return {
    ok: true,
    ...(plan ? { plan } : {}),
    commit: () => {
      if (done) throw new Error("Prepared input committed twice");
      done = true;
      const events: WorldEvent[] = [];
      if (back) {
        state.residents[actor] = back;
        events.push(joinedEvent(back));
      }
      events.push(...act());
      if (newcomer) markNewcomer(state, actor);
      if (welcome !== null) events.push(...payWelcome(state, actor, welcome, seq));
      // The allowance: whatever the resident did, if it leaves them on their own hearth.
      if (state.residents[actor] && isActivity(command)) {
        // Things held aside for them while their things were full, as far as there's room now.
        events.push(...returnHeldAside(state, actor));
        events.push(...payAllowance(state, actor, seq));
        // The pantry (RFC 0005), on the same terms: a no-op until items open.
        events.push(...payPantry(state, actor));
      }
      // Town Hall bookkeeping: the last day each resident acted. Only once the world counts days,
      // so logs from before the Town Hall replay to the same hash. No event: no client draws it,
      // and /v1/town reports what it means (eligibility).
      if (state.day !== undefined && state.residents[actor] && isActivity(command)) {
        state.lastActiveDay ??= {};
        state.lastActiveDay[actor] = state.day;
      }
      state.seq += 1;
      return { seq: state.seq, events };
    },
  };
}

/** Prepare and commit in one step. Rejected inputs leave `state` untouched. */
export function apply(state: WorldState, input: Input): ApplyResult {
  const prepared = prepare(state, input);
  if (!prepared.ok) return prepared;
  return { ok: true, ...prepared.commit() };
}

type Mutation = () => WorldEvent[];

/**
 * What `check` finds: the change to make, the same for `build` (and a Commons build proposal) with
 * the plan it makes, or a rejection (a `Prepared` with `ok: false`).
 */
type Checked = Mutation | { plan: BuildPlan; commit: Mutation } | Prepared;

const northToSouth = (a: Plot, b: Plot) => a.py - b.py || a.px - b.px;
const sameTile = (a: Tile, b: Tile) => a.x === b.x && a.y === b.y;

/**
 * The plot a resident's plot-wide commands act on: the one they stand in if it's theirs, else the
 * first one they own (north to south, then west to east), else, when `shared` is set, the first
 * one shared with them.
 */
/** The plot `build_starter_home` builds on for `actor`, or undefined. The server's notes read it. */
export function starterHomePlot(state: WorldState, actor: string): Plot | undefined {
  const me = residentById(state, actor);
  return me && workingPlot(state, me, true);
}

function workingPlot(state: WorldState, me: Resident, shared: boolean): Plot | undefined {
  const mine = (p: Plot | undefined): p is Plot =>
    p !== undefined && (shared ? canBuildOn(p, me.id) : p.ownerId === me.id);
  const here = plotAtTile(state, me.x, me.y);
  if (mine(here)) return here;
  const plots = Object.values(state.plots).sort(northToSouth);
  return (
    plots.find((p) => p.ownerId === me.id) ??
    (shared ? plots.find((p) => p.coOwners?.includes(me.id)) : undefined)
  );
}

/**
 * Ground-floor tiles where an online resident other than `except` is standing, as tile keys.
 * Someone upstairs stands on flooring, never in the way of a block or a landing below.
 */
function standingTiles(state: WorldState, except: string): Set<string> {
  const tiles = new Set<string>();
  for (const r of Object.values(state.residents)) {
    if (r.online && r.id !== except && standingFloor(r) === 0) tiles.add(tileKey(r.x, r.y));
  }
  return tiles;
}

/** Whether a resident stands on their hearth: its tile, on the ground floor. */
const onHearth = (me: Resident): boolean =>
  me.hearth !== null && sameTile(me, me.hearth) && standingFloor(me) === 0;

/** Every resident's hearth (except `except`'s), as tile keys. Nobody builds on a hearth. */
function hearthTiles(state: WorldState, except?: string): Set<string> {
  const tiles = new Set<string>();
  for (const r of Object.values(state.residents)) {
    if (r.hearth && r.id !== except) tiles.add(tileKey(r.hearth.x, r.hearth.y));
  }
  return tiles;
}

/**
 * Where `settle` puts a resident on plot (px, py): the plot's center, or the free tile nearest to
 * it (by Chebyshev distance, then north to south, then west to east). Free means no block and no
 * other online resident. If the whole plot is taken, the center.
 */
function landingTile(state: WorldState, actor: string, px: number, py: number): Tile {
  const { plotSize } = state.config;
  const center = plotCenter(state.config, px, py);
  const others = standingTiles(state, actor);
  const tiles: Tile[] = [];
  for (let y = py * plotSize; y < (py + 1) * plotSize; y++) {
    for (let x = px * plotSize; x < (px + 1) * plotSize; x++) tiles.push({ x, y });
  }
  tiles.sort((a, b) => chebyshev(a, center) - chebyshev(b, center) || a.y - b.y || a.x - b.x);
  const free = tiles.find((t) => !isSolid(state, t.x, t.y) && !others.has(tileKey(t.x, t.y)));
  return free ?? center;
}

// ---------- next steps: a rejection names the call that would work ----------

/**
 * Where to settle or claim next: the free plot nearest to plot (px, py), as a call to make. Of
 * plots as near, one whose claim closes nobody in (`nearestFreePlot`, decision 0354).
 */
function freePlotHint(state: WorldState, actor: string, px: number, py: number): string {
  const owned = plotsOwnedBy(state, actor).length;
  // Pointing at a free plot would only lead to plot_limit.
  if (owned >= claimLimit(state.config, !!state.plotMarket)) {
    return state.plotMarket
      ? ` ${anotherPlotWords(state, owned)}`
      : " You already own as many plots as you can.";
  }
  const free = nearestFreePlot(state, px, py);
  if (!free) return " Every plot is taken right now.";
  // `settle` is only for a first plot; with one already, the way to another is to walk and claim.
  return owned === 0
    ? ` Try settle at px ${free.px}, py ${free.py}.`
    : ` The nearest free plot is px ${free.px}, py ${free.py}: walk there and claim.`;
}

/** The same, from the plot a resident is standing in. */
const settleHint = (state: WorldState, me: Resident) => {
  const { px, py } = plotOf(state.config, me.x, me.y);
  return freePlotHint(state, me.id, px, py);
};

/** What to do when blocks or the edge leave a resident nowhere to walk. */
function stuckHint(state: WorldState, me: Resident): string {
  if (me.hearth && !onHearth(me)) return " Try home to jump to your hearth.";
  if (canBuildOn(plotAtTile(state, me.x, me.y), me.id)) {
    return " Remove a block next to you to open a path.";
  }
  const ask = " Ask whoever built around you to open a path";
  if (me.hearth) return `${ask}.`;
  if (workingPlot(state, me, true)) {
    return `${ask}, or try build_starter_home, which sets a hearth, and then home.`;
  }
  return `${ask}.${settleHint(state, me)}`;
}

/** Where a resident may build: the tiles of their working plot, or how to get one. */
function buildHint(state: WorldState, me: Resident): string {
  const plot = workingPlot(state, me, true);
  if (!plot) return ` You have no plot yet.${settleHint(state, me)}`;
  const { plotSize } = state.config;
  const x = plot.px * plotSize;
  const y = plot.py * plotSize;
  return ` You can build on x ${x} to ${x + plotSize - 1}, y ${y} to ${y + plotSize - 1}.`;
}

/** The resident `join` makes, or why it can't. Reads only; the caller puts them in the world. */
function joining(
  state: WorldState,
  actor: string,
  command: Extract<Command, { type: "join" }>,
): Resident | Prepared {
  const me = state.residents[actor];
  const name = command.name.trim();
  if (name.length < 1 || name.length > NAME_MAX_LENGTH) {
    return reject("invalid_name", `Names must be 1 to ${NAME_MAX_LENGTH} characters.`);
  }
  // Returning residents keep their spot, upstairs too (RFC 0028). If someone built on it, or
  // took the flooring away, while they were away, they go to their hearth, or to the Commons if they
  // have none.
  const floor = me ? standingFloor(me) : 0;
  const keepSpot =
    me !== undefined &&
    (floor === 0
      ? !isSolid(state, me.x, me.y)
      : floorGround(state, floor).obstacle(me.x, me.y) === undefined);
  const spawn = me?.hearth ?? spawnTile(state);
  const unowned = unownedWear(state, actor, command);
  if (unowned) return unowned;
  const look = mergeProfile(me ?? { ...defaultLook(actor), note: "" }, command);
  if ("ok" in look) return look;
  return {
    id: actor,
    name,
    kind: command.kind,
    ...look,
    x: keepSpot ? me.x : spawn.x,
    y: keepSpot ? me.y : spawn.y,
    online: true,
    hearth: me?.hearth ?? null,
    // A pet stays theirs while they're away (RFC 0019).
    ...(me?.pet ? { pet: me.pet } : {}),
    ...(keepSpot ? floorField(floor) : {}),
  };
}

const joinedEvent = (resident: Resident): WorldEvent => ({
  type: "joined",
  resident: {
    ...resident,
    ...lookOf(resident),
    ...(resident.pet ? { pet: petView(resident.pet) } : {}),
  },
});

/**
 * Who a known, offline resident would be if they came back now, as `join` with their own name and
 * kind would make them: where they stand (moved to their hearth or the Commons if their spot was
 * built on) and online. Undefined for anyone else. The implicit join uses it (RFC 0014), and the
 * server plans walks and dry runs from it.
 */
export function rejoined(state: WorldState, actor: string): Resident | undefined {
  const me = residentById(state, actor);
  if (!me || me.online) return undefined;
  const back = joining(state, actor, { type: "join", name: me.name, kind: me.kind });
  return "ok" in back ? undefined : back;
}

/**
 * A view of the world with `actor` back online (`rejoined`), sharing everything else with
 * `state`. For reading only: planning a walk, or checking an input without committing it.
 */
export function asJoined(state: WorldState, actor: string): WorldState {
  const back = rejoined(state, actor);
  return back ? { ...state, residents: { ...state.residents, [actor]: back } } : state;
}

/** A Town Hall or coins check's answer in this file's shape. */
function town(
  checked:
    | TownChecked
    | EconomyChecked
    | ItemsChecked
    | ShopChecked
    | MarketChecked
    | BountiesChecked
    | PresenceChecked
    | RoutinesChecked
    | EventsChecked
    | PetsChecked
    | GamesChecked
    | RecipesChecked
    | Mutation
    | Rejection,
): Mutation | Prepared {
  return typeof checked === "function" ? checked : { ok: false, rejection: checked };
}

/** `{ claimedDay }` once the world counts days, else nothing, so older worlds hash as before. */
const stampDay = (state: WorldState) => (state.day === undefined ? {} : { claimedDay: state.day });

/**
 * One input's rules. `rejoining` says the input brings its actor back online (implicit presence),
 * for the few rules that read it.
 */
function check(state: WorldState, actor: string, command: Command, rejoining: boolean): Checked {
  const { config } = state;
  const me = state.residents[actor];

  // Day changes, the townsfolk list, closes, voids, and the coin lists come from the server.
  if (isServerCommand(command)) {
    if (actor !== TOWN_ACTOR) return reject("server_only", "Only the server can do that.");
    switch (command.type) {
      case "open_economy":
      case "set_owner_pairs":
      case "add_owner_pair":
      case "remove_owner_pair":
      case "set_maintainers":
      case "daily_awards":
        return town(checkEconomyServer(state, command));
      case "open_items":
        return town(checkOpenItems(state));
      case "open_gifts":
        return town(checkOpenGifts(state));
      case "town_presents":
        return town(checkTownPresents(state, actor, command));
      case "own_plot_pickups":
        return town(checkOwnPlotPickups(state));
      case "open_way_pickups":
        return town(checkOpenWayPickups(state));
      case "open_finds":
        return town(checkOpenFinds(state));
      case "solid_buildings":
        return town(checkSolidBuildings(state));
      case "keep_table_spots":
        return town(checkKeepTableSpots(state));
      case "starter_doors":
        return town(checkStarterDoors(state));
      case "open_shop":
        return town(checkOpenShop(state));
      case "set_shop_share":
        return town(checkSetShopShare(state, command));
      case "lower_holiday_prices":
        return town(checkLowerHolidayPrices(state));
      case "raise_inventory":
        return town(checkRaiseInventory(state));
      case "shop_in_person":
        return town(checkShopInPerson(state));
      case "propose_in_person":
        return town(checkProposeInPerson(state));
      case "schedule_in_person":
        return town(checkScheduleInPerson(state));
      case "attend_at_ten":
        return town(checkAttendAtTen(state));
      case "open_land":
        return town(checkOpenLand(state, command));
      case "open_market":
        return town(checkOpenMarket(state));
      case "open_plot_market":
        return town(checkOpenPlotMarket(state, command));
      case "remove_plot_listing":
        return town(checkRemovePlotListing(state, command));
      case "open_recipes":
        return town(checkOpenRecipes(state));
      case "retire_repeat_joins":
        return town(checkRetireRepeatJoins(state, command));
      case "merge_resident":
        return town(checkMergeResident(state, command));
      case "open_levels":
        return town(checkOpenLevels(state, command));
      case "credit_event": {
        const credit = checkCreditEvent(state, command);
        if (typeof credit !== "function") return town(credit);
        // The guests it counted may hold a job that asks for it, and so may the host (RFC 0030).
        const jobs = creditJob(state, command);
        return jobs ? () => [...credit(), ...jobs()] : credit;
      }
      case "open_jobs":
        return town(checkOpenJobs(state));
      case "open_clay":
        return town(checkOpenClay(state, command));
      case "set_job_edition":
        return town(checkSetJobEdition(state, command));
      case "set_page_edition":
        return town(checkSetPageEdition(state, command));
      case "open_circles":
        return town(checkOpenCircles(state));
      case "clear_circle_name":
        return town(checkClearCircleName(state, command));
      case "disband_circle":
        return town(checkDisbandCircle(state, command));
      case "remove_listing":
        return town(checkRemoveListing(state, command));
      case "remove_display":
        return town(checkRemoveDisplay(state, command));
      case "clear_plot_name":
        return town(checkClearPlotName(state, command));
      case "rename_resident":
        return town(checkRenameResident(state, command));
      case "clear_block":
        return town(checkClearBlock(state, command));
      case "open_way":
        return town(checkOpenWay(state, command));
      case "close_way":
        return town(checkCloseWay(state, command));
      case "rebuild_home":
        return town(checkRebuildHome(state, command));
      case "set_entitlements":
        return town(checkSetEntitlements(state, command));
      case "open_bounties":
        return town(checkOpenBounties(state));
      case "confirm_town_bounty":
        return town(checkConfirmTownBounty(state, command));
      case "void_bounty":
        return town(checkVoidBounty(state, command));
      case "reopen_bounty":
        return town(checkReopenBounty(state, command));
      case "implicit_presence":
        return town(checkImplicitPresence(state));
      case "leave_idle":
        return town(checkLeaveIdle(state, command));
      case "routine_step":
        return town(checkRoutineStep(state, command));
      case "schedule_town_event":
        return town(checkScheduleTownEvent(state, command));
      case "event_start":
        return town(checkEventStart(state, command));
      case "event_tick":
        return town(checkEventTick(state, command));
      case "event_end":
        return town(checkEventEnd(state, command));
      case "void_event":
        return town(checkVoidEvent(state, command));
      case "close_round":
        return town(checkCloseRound(state, command));
      case "close_table":
        return town(checkCloseTable(state, command));
      case "award_grant":
        return town(checkAwardGrant(state, command));
      case "test_grant":
        return town(checkTestGrant(state, command));
      case "new_day":
      case "set_townsfolk": {
        const checked = checkTown(state, actor, command);
        if (typeof checked !== "function") return town(checked);
        const coins =
          command.type === "new_day"
            ? economyNewDay(state, command.day)
            : economyTownsfolkChange(state, [...new Set(command.ids)]);
        const items = command.type === "new_day" ? itemsNewDay(state) : null;
        const shop = command.type === "new_day" ? shopNewDay(state) : null;
        const bounties = command.type === "new_day" ? bountiesNewDay(state, command.day) : null;
        const events = command.type === "new_day" ? eventsNewDay(state, command.day) : null;
        const games = command.type === "new_day" ? gamesNewDay(state) : null;
        const knocks = command.type === "new_day" ? halloweenNewDay(state) : null;
        const levels = command.type === "new_day" ? levelsNewDay(state) : null;
        const jobs = command.type === "new_day" ? jobsNewDay(state, command.day) : null;
        const circles = command.type === "new_day" ? circlesNewDay(state, command.day) : null;
        const presents = command.type === "new_day" ? presentsNewDay(state, command.day) : null;
        if (
          !coins &&
          !items &&
          !shop &&
          !bounties &&
          !events &&
          !games &&
          !knocks &&
          !levels &&
          !jobs &&
          !circles &&
          !presents
        ) {
          return checked;
        }
        return () => [
          ...checked(),
          ...(coins ? coins() : []),
          ...(items ? items() : []),
          ...(shop ? shop() : []),
          ...(bounties ? bounties() : []),
          ...(events ? events() : []),
          ...(games ? games() : []),
          ...(knocks ? knocks() : []),
          ...(levels ? levels() : []),
          ...(jobs ? jobs() : []),
          ...(circles ? circles() : []),
          ...(presents ? presents() : []),
        ];
      }
      default:
        return town(checkTown(state, actor, command));
    }
  }

  if (command.type === "join") {
    if (me?.online) return reject("already_joined", "You are already in the world.");
    if (isRetired(state, actor)) {
      return reject("not_eligible", "That record was retired as a repeat of another's name.");
    }
    if (mergedInto(state, actor) !== undefined) {
      return reject("not_eligible", "That record was merged into another resident's record.");
    }
    const resident = joining(state, actor, command);
    if ("ok" in resident) return resident;
    return () => {
      state.residents[actor] = resident;
      return [joinedEvent(resident)];
    };
  }

  if (!me?.online) return reject("not_joined", "Join the world first.");

  switch (command.type) {
    case "leave":
      return () => {
        me.online = false;
        return [{ type: "left", residentId: actor }];
      };

    case "profile": {
      const unowned = unownedWear(state, actor, command);
      if (unowned) return unowned;
      const look = mergeProfile(me, command);
      if ("ok" in look) return look;
      // The title to show (RFC 0029, RFC 0030, RFC 0033) is checked here and kept with levels, not
      // on the resident: a skill's by its level, one from jobs by the count of jobs finished, and
      // one from circle nights by the count of nights that counted.
      const title = isJobTitle(command.title)
        ? checkJobTitle(state, actor, command.title)
        : isCircleTitle(command.title)
          ? checkCircleTitle(state, actor, command.title)
          : checkTitle(state, actor, command.title);
      if (title && typeof title !== "function") return { ok: false, rejection: title };
      const same = sameProfile(look, me);
      // A no-op would still cost a permanent log line and a broadcast.
      if (same && !title) return reject("invalid_profile", "Nothing to change.");
      return () => {
        const events: WorldEvent[] = [];
        if (!same) {
          setProfile(me, look);
          const { color, shape, note } = look;
          events.push({
            type: "profile_changed",
            residentId: actor,
            color,
            shape,
            note,
            ...lookOf(look),
          });
        }
        if (title) events.push(...title());
        return events;
      };
    }

    case "move": {
      // Up and down a staircase (RFC 0028).
      if (command.dir === "up" || command.dir === "down") {
        return town(checkClimb(state, me, command.dir));
      }
      if (!isDirection(command.dir)) return reject("out_of_bounds", STEPS_GO);
      // A step keeps to the floor you stand on.
      const floor = standingFloor(me);
      const step = stepFrom(floorGround(state, floor), me, command.dir);
      if (!step.ok) {
        // A tile upstairs with nothing to stand on is the one obstacle you build your way past
        // (RFC 0028), so the refusal names the call that floors the tile the step aimed at. A
        // corner in the way says to step around it, which is advice enough, and keeps its words.
        let hint = "";
        if (step.obstacle === "no_flooring" && step.at) {
          const [dx, dy] = STEP[command.dir];
          const aimed = step.at.x === me.x + dx && step.at.y === me.y + dy;
          if (aimed) hint = noFlooringHint(state, me, step.at, floor);
        }
        return reject(step.code, `${step.message}${hint}`);
      }
      const { x, y } = step.to;
      return () => {
        me.x = x;
        me.y = y;
        return [{ type: "moved", residentId: actor, x, y, ...floorField(floor) }];
      };
    }

    case "rest":
      return town(checkRest(state, me, command));

    case "putter": {
      const { steps } = command;
      if (!Array.isArray(steps) || steps.length === 0) {
        return reject("nowhere_to_go", `There's nowhere to walk from here.${stuckHint(state, me)}`);
      }
      if (steps.length > PUTTER_MAX_STEPS) {
        return reject("too_far", `A putter walks at most ${PUTTER_MAX_STEPS} tiles.`);
      }
      // Each step is checked like a move, from where the last one left off, on your floor.
      const floor = standingFloor(me);
      const walked = walkSteps(floorGround(state, floor), me, steps);
      if (!walked.ok) return reject(walked.code, walked.message);
      const { path } = walked;
      return () =>
        path.map(({ x, y }) => {
          me.x = x;
          me.y = y;
          return { type: "moved", residentId: actor, x, y, ...floorField(floor) };
        });
    }

    case "claim": {
      const { px, py } = plotOf(config, me.x, me.y);
      // The Commons, or a land's own square, which a resident can stand on and never claim.
      if (isTownSquare(state, px, py)) {
        return reject("plot_is_commons", squareWords(state, px, py));
      }
      // A land's street, which everyone walks and nobody claims (RFC 0046).
      if (isStreet(state, px, py)) {
        return reject(
          "public_ground",
          `${streetWords(state, px, py)}${freePlotHint(state, actor, px, py)}`,
        );
      }
      // A bridge tile is inside a water plot slot, so standing on one puts a resident on a slot
      // that is nobody's ground. `settle` has always refused it; `claim` must too, or the first
      // resident across owns the channel and can wall the crossing off (RFC 0038).
      if (!onLand(state, px, py)) {
        return reject(
          "out_of_bounds",
          "That's open water between the lands, not a plot. Claim on land, or cross the bridge and claim there.",
        );
      }
      if (state.plots[plotKey(px, py)]) {
        return reject(
          "plot_owned",
          `This plot is already claimed.${freePlotHint(state, actor, px, py)}`,
        );
      }
      // Only a first plot, once plots are for sale: the rest are bought (`claimLimit`).
      const owned = plotsOwnedBy(state, actor).length;
      if (owned >= claimLimit(config, !!state.plotMarket)) {
        return reject(
          "plot_limit",
          state.plotMarket
            ? anotherPlotWords(state, owned)
            : `You can own at most ${config.maxPlotsPerResident} plot(s).`,
        );
      }
      return () => {
        state.plots[plotKey(px, py)] = { px, py, ownerId: actor, ...stampDay(state) };
        return [{ type: "plot_claimed", px, py, ownerId: actor }];
      };
    }

    case "release": {
      const { px, py } = plotOf(config, me.x, me.y);
      const key = plotKey(px, py);
      const plot = state.plots[key];
      if (!plot || plot.ownerId !== actor) {
        return reject("not_your_plot", "You can only release a plot you own.");
      }
      const releaseListed = plotListedProblem(state, px, py);
      if (releaseListed) return { ok: false, rejection: releaseListed };
      // Releasing never demolishes: clear the blocks first. That keeps release a single,
      // honest change instead of a silent teardown (see decision 0018). Paths and flooring too
      // (RFC 0016), so nobody inherits a stranger's.
      const { plotSize } = config;
      for (let y = py * plotSize; y < (py + 1) * plotSize; y++) {
        for (let x = px * plotSize; x < (px + 1) * plotSize; x++) {
          if (state.blocks[tileKey(x, y)] !== undefined) {
            return reject("plot_has_blocks", "Remove every block on the plot first.");
          }
          if (state.ground?.[tileKey(x, y)] !== undefined) {
            return reject(
              "plot_has_blocks",
              "Lift all the paths and flooring on the plot first. One build with a lift list clears them all.",
            );
          }
        }
      }
      // Upstairs too (RFC 0028). The floors themselves go with the plot's record.
      if (plotHasAnything(state, px, py)) {
        return reject(
          "plot_has_blocks",
          "Remove every block and lift all the flooring upstairs on the plot first.",
        );
      }
      // A roof goes with the plot's record too, and its covering would go with it (RFC 0041).
      if (plot.roof) {
        return reject(
          "plot_has_blocks",
          'Take the roof down first, with set_roof and "style": "flat", so its covering comes back to you.',
        );
      }
      // Every hearth on the plot goes with it: a hearth must sit on a plot its resident can build
      // on, and this one is about to be nobody's. Co-owners lose their share exactly as if the
      // owner had sent unshare_plot for each of them, so the events read the same.
      const hearthHere = (r: Resident | undefined): boolean => {
        if (!r?.hearth) return false;
        const p = plotOf(config, r.hearth.x, r.hearth.y);
        return p.px === px && p.py === py;
      };
      const coOwners = (plot.coOwners ?? []).map((id) => {
        const resident = state.residents[id];
        return { id, clear: hearthHere(resident) ? resident : undefined };
      });
      const clearMyHearth = hearthHere(me);
      // Events on the plot are called off: it's about to be nobody's (RFC 0010). A circle's hall
      // there is cleared (RFC 0033).
      const calledOff = eventsLeavingPlot(state, px, py);
      const hall = hallsLeavingPlot(state, px, py);
      return () => {
        const events: WorldEvent[] = calledOff ? calledOff() : [];
        if (hall) events.push(...hall());
        for (const { id, clear } of coOwners) {
          events.push({ type: "plot_unshared", px, py, residentId: id });
          if (clear) {
            clear.hearth = null;
            events.push({ type: "hearth_cleared", residentId: id });
          }
        }
        delete state.plots[key];
        events.push({ type: "plot_released", px, py, ownerId: actor });
        if (clearMyHearth) {
          me.hearth = null;
          events.push({ type: "hearth_cleared", residentId: actor });
        }
        return events;
      };
    }

    case "set_hearth": {
      const { x, y } = command;
      if (!inBounds(config, x, y)) return reject("out_of_bounds", "That's outside the world.");
      const far = outOfBuildReach(state, me, { x, y });
      if (far) return { ok: false, rejection: far };
      if (!canBuildOn(plotAtTile(state, x, y), actor)) {
        return reject(
          "not_your_plot",
          `Your hearth has to be on your own plot.${buildHint(state, me)}`,
        );
      }
      const hearthListed = tileListedProblem(state, x, y);
      if (hearthListed) return { ok: false, rejection: hearthListed };
      // Any block, stairs too (RFC 0028).
      if (state.blocks[tileKey(x, y)] !== undefined) {
        return reject("tile_occupied", "A block is there.");
      }
      // Like profile, a no-op would still cost a permanent log line and a broadcast.
      if (me.hearth?.x === x && me.hearth.y === y) {
        return reject(
          "already_home",
          onHearth(me)
            ? "That's already your hearth, and you're on it."
            : "That's already your hearth. Try home to go there.",
        );
      }
      return () => {
        me.hearth = { x, y };
        return [{ type: "hearth_set", residentId: actor, x, y }];
      };
    }

    case "home": {
      const hearth = me.hearth;
      if (!hearth) {
        return reject(
          "no_hearth",
          workingPlot(state, me, true)
            ? "Set a hearth on your plot first. Try build_starter_home, which sets one for you."
            : `Set a hearth on your plot first. You have no plot yet.${settleHint(state, me)}`,
        );
      }
      if (onHearth(me)) {
        // Already home is fine when it collects today's allowance or pantry (paid in prepare's
        // commit).
        if (allowanceDue(state, actor) || pantryDue(state, actor)) return () => [];
        return reject(
          "already_home",
          state.economy && state.day !== undefined && !isTownsfolk(state, actor)
            ? "You're already home, and today's allowance is paid. Come back tomorrow."
            : "You're already home.",
        );
      }
      // A jump, so it lands on the ground floor (RFC 0028).
      return () => {
        me.x = hearth.x;
        me.y = hearth.y;
        setFloor(me, 0);
        return [{ type: "moved", residentId: actor, x: hearth.x, y: hearth.y }];
      };
    }

    case "place":
    case "remove":
    case "lay":
    case "lift": {
      const { x, y } = command;
      if (!inBounds(config, x, y)) return reject("out_of_bounds", "That's outside the world.");
      const far = outOfBuildReach(state, me, { x, y });
      if (far) return { ok: false, rejection: far };
      const plot = plotAtTile(state, x, y);
      if (!canBuildOn(plot, actor)) {
        const slot = plotOf(config, x, y);
        // An island street is everyone's to walk, like a public way (RFC 0046).
        if (isStreet(state, slot.px, slot.py)) {
          return reject(
            "public_ground",
            `${streetWords(state, slot.px, slot.py)} Nothing is built on it.${buildHint(state, me)}`,
          );
        }
        return reject(
          "not_your_plot",
          `You can only build on your own plot.${buildHint(state, me)}`,
        );
      }
      const buildListed = tileListedProblem(state, x, y);
      if (buildListed) return { ok: false, rejection: buildListed };
      // The floor the tile is on (RFC 0028): absent is the ground floor.
      const floor = floorOf(plot, command.floor);
      if (typeof floor !== "number") return { ok: false, rejection: floor };
      const climb = outOfFloorReach(config, me, floor);
      if (climb) return climb;
      // Paths and flooring (RFC 0016) keep the same where-rules, and their own checks.
      if (command.type === "lay") return town(checkLay(state, actor, command, floor));
      if (command.type === "lift") return town(checkLift(state, actor, command, floor));
      const key = tileKey(x, y);
      const blocks = floor === 0 ? state.blocks : layerFor(state, floor).blocks;
      // Hearths, crops, and displays are on the ground floor, keyed by their tile alone.
      const groundFloor = floor === 0;
      if (command.type === "remove") {
        const taken = blocks[key];
        if (taken === undefined) return reject("no_block", "Nothing to remove there.");
        // A pot set down (RFC 0047) goes back to whoever set it down.
        if (taken === POT_BLOCK) return town(checkTakeUpPot(state, actor, { x, y, floor }, blocks));
        if (groundFloor && cropAt(state, x, y)) {
          return reject("tile_occupied", "Something is growing in that planter. Harvest it first.");
        }
        const shown = groundFloor ? displayRemoveProblem(state, x, y) : null;
        if (shown) return { ok: false, rejection: shown };
        const firing = groundFloor ? kilnRemoveProblem(state, x, y) : null;
        if (firing) return { ok: false, rejection: firing };
        const holding = removeProblem(state, x, y, floor);
        if (holding) return { ok: false, rejection: holding };
        const full = blockRemoveProblem(state, actor, taken);
        if (full) return { ok: false, rejection: full };
        return () => {
          delete blocks[key];
          return [
            { type: "block_removed", x, y, ...floorField(floor), by: actor },
            ...moveBlockCost(state, actor, taken, 1),
          ];
        };
      }
      if (blocks[key] !== undefined) return reject("tile_occupied", "A block is already there.");
      const stairwell = stairwellProblem(state, x, y, floor);
      if (stairwell) return { ok: false, rejection: stairwell };
      if (groundFloor && me.hearth?.x === x && me.hearth.y === y) {
        return reject("tile_occupied", "That's your hearth. Keep it clear.");
      }
      // A shared plot can hold more than one hearth, and nobody builds on anyone's.
      if (groundFloor && hearthTiles(state).has(key)) {
        return reject("tile_occupied", "That's someone's hearth. Keep it clear.");
      }
      const standingThere = Object.values(state.residents).some(
        (r) => r.online && r.x === x && r.y === y && standingFloor(r) === floor,
      );
      if (standingThere) return reject("tile_occupied", "Someone is standing there.");
      const { block } = command;
      if (!(BLOCK_KINDS as readonly unknown[]).includes(block)) {
        return reject("unknown_item", "That isn't a block you can place.");
      }
      // A kiln (RFC 0047) waits for `open_clay`.
      const kilnShut = block === KILN ? potteryClosed(state) : null;
      if (kilnShut) return { ok: false, rejection: kilnShut };
      // A public way holds no block on the ground floor (RFC 0046).
      const onWay = wayProblem(state, x, y, floor);
      if (onWay) return { ok: false, rejection: onWay };
      const unheld = blockProblem(state, plot, x, y, floor, block);
      if (unheld) return { ok: false, rejection: unheld };
      // A pot (RFC 0047) is set down by its id, and nothing else is.
      if (block === POT_BLOCK) {
        return town(checkPlacePot(state, actor, command, { x, y, floor }, blocks));
      }
      if (command.item !== undefined || command.flower !== undefined) {
        return reject(
          "unknown_item",
          "Only a pot is set down by its id. Leave out item and flower.",
        );
      }
      const cost = blockPlaceProblem(state, actor, block);
      if (cost) return { ok: false, rejection: cost };
      return () => {
        blocks[key] = block;
        return [
          { type: "block_placed", x, y, ...floorField(floor), block, by: actor },
          ...moveBlockCost(state, actor, block, -1),
        ];
      };
    }

    case "add_floor":
      return town(checkAddFloor(state, actor, command));

    case "set_roof":
      return town(checkSetRoof(state, actor, command));

    case "settle": {
      const { px, py } = command;
      const key = plotKey(px, py);
      const problem = settleProblem(config, px, py, {
        claimed: state.plots[key] !== undefined,
        ownsAPlot: plotsOwnedBy(state, actor).length > 0,
        square: isTownSquare(state, px, py),
        street: isStreet(state, px, py),
        onLand: onLand(state, px, py),
      });
      switch (problem) {
        case "out_of_bounds":
          return reject(problem, "That plot is outside the world.");
        case "plot_is_water":
          // The same code as a tile off the map: either way the next move is another plot, so
          // this needs no error code of its own, only its own words (RFC 0038).
          return reject(
            "out_of_bounds",
            "That's open water between the lands, not a plot. Settle on land, or cross the bridge and claim there.",
          );
        case "plot_is_square":
          // Downtown's square is the Commons; a land's is the ground its own hall and counter
          // stand on. Both belong to everyone, so both answer with the Commons' code (RFC 0038).
          return reject("plot_is_commons", squareWords(state, px, py));
        case "plot_is_street":
          // A land's street is ground everyone walks, like a public way, so it answers with
          // the same code, and names the nearest plot that is there to claim (RFC 0046).
          return reject(
            "public_ground",
            `${streetWords(state, px, py)}${freePlotHint(state, actor, px, py)}`,
          );
        case "plot_owned":
          return reject(
            problem,
            `This plot is already claimed.${freePlotHint(state, actor, px, py)}`,
          );
        case "plot_limit":
          return reject(
            problem,
            state.plotMarket
              ? `You already have a plot, and settle is for your first one. ${anotherPlotWords(state, plotsOwnedBy(state, actor).length)}`
              : "You already have a plot. Settle is for your first one; walk to another and claim it.",
          );
      }
      const to = landingTile(state, actor, px, py);
      return () => {
        state.plots[key] = { px, py, ownerId: actor, ...stampDay(state) };
        const events: WorldEvent[] = [{ type: "plot_claimed", px, py, ownerId: actor }];
        // A jump, so it lands on the ground floor (RFC 0028).
        if (!sameTile(me, to) || standingFloor(me) !== 0) {
          me.x = to.x;
          me.y = to.y;
          setFloor(me, 0);
          events.push({ type: "moved", residentId: actor, x: to.x, y: to.y });
        }
        return events;
      };
    }

    case "visit":
      return town(checkVisit(state, me, command));

    case "build_starter_home": {
      const plot = workingPlot(state, me, true);
      if (!plot) return reject("no_plot", `You need a plot first.${settleHint(state, me)}`);
      const starterListed = plotListedProblem(state, plot.px, plot.py);
      if (starterListed) return { ok: false, rejection: starterListed };
      const onPlot = (t: Tile) => {
        const p = plotOf(config, t.x, t.y);
        return inBounds(config, t.x, t.y) && p.px === plot.px && p.py === plot.py;
      };
      if (blockNeeds(command.walls).length > 0 || blockNeeds(command.windows).length > 0) {
        return reject(
          "unknown_item",
          "A starter home is built from free blocks. Place decor, furniture, and ponds yourself with place.",
        );
      }
      const home = starterHome(
        config,
        plot.px,
        plot.py,
        command.walls ?? "wood",
        command.windows ?? "glass",
        // A door in the doorway only from the server's `starter_doors` on, so starter homes
        // built before it replay with the open doorway they were built with (decision 0349).
        state.starterDoors === true,
      );
      // Any block, stairs too (RFC 0028), keeps a hut's tile and its hearth.
      const blockAt = (t: Tile) => state.blocks[tileKey(t.x, t.y)] !== undefined;
      const hearthFree = onPlot(home.hearth) && !blockAt(home.hearth);
      const setHearth = hearthFree && !(me.hearth && sameTile(me.hearth, home.hearth));
      // Never build on a block, a hearth, or anyone else standing there. The builder's own hearth
      // is fair game when this moves it to the middle of the hut.
      const others = standingTiles(state, actor);
      const hearths = hearthTiles(state, setHearth ? actor : undefined);
      // A public way holds no block, so the hut leaves a gap where one crosses its walls, as it
      // does for a block already there (RFC 0046). Every hut built before refused the whole home
      // on a way tile, so none in a log ever met one, and they replay as they were built.
      let blocks = home.blocks.filter((b) => {
        const key = tileKey(b.x, b.y);
        return (
          onPlot(b) &&
          !blockAt(b) &&
          !hearths.has(key) &&
          !others.has(key) &&
          !isWay(state, b.x, b.y)
        );
      });
      // The builder steps onto the hearth tile rather than get walled in. If that tile holds a
      // block, the wall where they stand stays open instead. Upstairs, a wall below is no matter.
      let moveTo: Tile | null = null;
      if (standingFloor(me) === 0 && blocks.some((b) => sameTile(b, me))) {
        if (hearthFree) moveTo = home.hearth;
        else blocks = blocks.filter((b) => !sameTile(b, me));
      }
      if (blocks.length === 0 && !moveTo && !setHearth) {
        return reject("already_home", "Your starter home is already built. Add to it with place.");
      }
      return () => {
        const events: WorldEvent[] = [];
        if (moveTo) {
          me.x = moveTo.x;
          me.y = moveTo.y;
          events.push({ type: "moved", residentId: actor, x: moveTo.x, y: moveTo.y });
        }
        for (const { x, y, block } of blocks) {
          state.blocks[tileKey(x, y)] = block;
          events.push({ type: "block_placed", x, y, block, by: actor });
        }
        if (setHearth) {
          const { x, y } = home.hearth;
          me.hearth = { x, y };
          events.push({ type: "hearth_set", residentId: actor, x, y });
        }
        return events;
      };
    }

    case "build": {
      const built = checkBuild(state, actor, command);
      return "code" in built ? { ok: false, rejection: built } : built;
    }

    case "share_plot":
    case "unshare_plot": {
      const plot = workingPlot(state, me, false);
      if (!plot) {
        return workingPlot(state, me, true)
          ? reject("not_your_plot", "Only a plot's owner can share it.")
          : reject("no_plot", `You need a plot of your own first.${settleHint(state, me)}`);
      }
      const { px, py } = plot;
      const shareListed = plotListedProblem(state, px, py);
      if (shareListed) return { ok: false, rejection: shareListed };
      const target = command.with;
      const coOwners = plot.coOwners ?? [];
      if (command.type === "unshare_plot") {
        if (!coOwners.includes(target)) {
          return reject("not_shared", "That resident doesn't share your plot.");
        }
        // A revoked co-owner's hearth on this plot goes too, so it doesn't pin a tile they no
        // longer have rights to.
        const them = residentById(state, target);
        const hearth = them?.hearth;
        const hearthPlot = hearth ? plotOf(config, hearth.x, hearth.y) : null;
        const hearthHere = hearthPlot?.px === px && hearthPlot.py === py;
        // Their events here are called off with their share (RFC 0010), and a circle hall they
        // set here is cleared (RFC 0033).
        const calledOff = eventsLeavingPlot(state, px, py, target);
        const hall = hallsLeavingPlot(state, px, py, target);
        return () => {
          const rest = coOwners.filter((id) => id !== target);
          if (rest.length > 0) plot.coOwners = rest;
          else delete plot.coOwners;
          if (plot.sharedDay) {
            delete plot.sharedDay[target];
            if (Object.keys(plot.sharedDay).length === 0) delete plot.sharedDay;
          }
          const events: WorldEvent[] = [
            ...(calledOff ? calledOff() : []),
            ...(hall ? hall() : []),
            { type: "plot_unshared", px, py, residentId: target },
          ];
          if (them && hearthHere) {
            them.hearth = null;
            events.push({ type: "hearth_cleared", residentId: target });
          }
          return events;
        };
      }
      if (!residentById(state, target)) {
        return reject("unknown_resident", "Nobody in the world has that id.");
      }
      if (target === actor) return reject("already_shared", "It's already your plot.");
      if (coOwners.includes(target)) {
        return reject("already_shared", "You already share this plot with them.");
      }
      if (coOwners.length >= MAX_CO_OWNERS) {
        return reject(
          "share_limit",
          `A plot can be shared with at most ${MAX_CO_OWNERS} residents.`,
        );
      }
      return () => {
        plot.coOwners = [...coOwners, target];
        // When the share started counts toward the co-owner's Town Hall eligibility, so a new
        // share on an old plot doesn't make a voter on the spot.
        if (state.day !== undefined) plot.sharedDay = { ...plot.sharedDay, [target]: state.day };
        return [{ type: "plot_shared", px, py, residentId: target }];
      };
    }

    case "propose": {
      // A Commons build answers with its plan, as `build` does (decision 0101).
      const proposed = checkPropose(state, actor, command);
      if ("code" in proposed) return { ok: false, rejection: proposed };
      return proposed.plan ? { plan: proposed.plan, commit: proposed.commit } : proposed.commit;
    }
    case "vote":
    case "withdraw":
      return town(checkTown(state, actor, command));

    case "give_coins":
      return town(checkGive(state, actor, command));

    case "set_routines":
      return town(checkSetRoutines(state, actor, command));

    case "plant":
      return town(checkPlant(state, actor, command));
    case "harvest":
      return town(checkHarvest(state, actor, command));
    case "gather":
      return town(checkGather(state, actor, command));
    case "craft": {
      // Knowing the recipe is checked after every other check and before anything is taken
      // (RFC 0024): a craft that could happen but for the recipe says how to learn it.
      const crafted = checkCraft(state, actor, command);
      if (typeof crafted !== "function") return town(crafted);
      return town(recipeUnknown(state, actor, command.recipe) ?? crafted);
    }
    case "give":
      return town(checkGiveItem(state, actor, command));
    case "decline_gift":
      return town(checkDeclineGift(state, actor, command));

    case "make_piece":
      return town(checkMakePiece(state, actor, command));
    case "display":
      return town(checkDisplay(state, actor, command));
    case "take_down":
      return town(checkTakeDown(state, actor, command));
    case "admire":
      return town(checkAdmire(state, actor, command));
    case "set_gallery":
      return town(checkSetGallery(state, actor, command));
    case "name_plot":
      return town(checkNamePlot(state, actor, command));

    case "shop_buy":
      // A recipe card once recipes are open (RFC 0024); before then the shop has none.
      return town(
        state.recipes && isCardSku(command.sku)
          ? checkBuyCard(state, actor, command)
          : checkShopBuy(state, actor, command),
      );
    case "pick_recipe":
      return town(checkPickRecipe(state, actor, command));
    case "teach":
      return town(checkTeach(state, actor, command));
    case "sell_to_town":
      return town(checkSellToTown(state, actor, command));

    case "list_item":
      return town(checkListItem(state, actor, command));
    case "list_plot":
      return town(checkListPlot(state, actor, command));
    case "unlist_plot":
      return town(checkUnlistPlot(state, actor, command));
    case "buy_plot":
      return town(checkBuyPlot(state, actor, command));
    case "unlist_item":
      return town(checkUnlistItem(state, actor, command));
    case "buy_listing":
      return town(checkBuyListing(state, actor, command));

    case "post_bounty":
      return town(checkPostBounty(state, actor, command));
    case "claim_bounty":
      return town(checkClaimBounty(state, actor, command));
    case "drop_bounty":
      return town(checkDropBounty(state, actor, command));
    case "complete_bounty":
      return town(checkCompleteBounty(state, actor, command));
    case "confirm_bounty":
      return town(checkConfirmBounty(state, actor, command));
    case "cancel_bounty":
      return town(checkCancelBounty(state, actor, command));

    case "schedule_event":
      return town(checkScheduleEvent(state, actor, command));
    case "cancel_event":
      return town(checkCancelEvent(state, actor, command));
    case "join_event":
      return town(checkJoinEvent(state, actor, command, rejoining));
    case "adopt_pet":
      return town(checkAdoptPet(state, actor, command));
    case "rename_pet":
      return town(checkRenamePet(state, actor, command));
    case "groom_pet":
      return town(checkGroomPet(state, actor, command));
    case "treat_pet":
      return town(checkTreatPet(state, actor, command));
    case "walk_pet":
      return town(checkWalkPet(state, actor));
    case "open_table":
      return town(checkOpenTable(state, actor, command));
    case "sit":
      return town(checkSit(state, actor, command));
    case "stand":
      return town(checkStand(state, actor, command));
    case "start_game":
      return town(checkStartGame(state, actor, command));
    case "decide":
      return town(checkDecide(state, actor, command));

    case "trick_or_treat":
      return town(checkTrickOrTreat(state, actor, command));

    case "bring_dish":
      return town(checkBringDish(state, actor, command));

    case "open_present":
      return town(checkOpenPresent(state, actor, command));

    case "set_off_firework":
      return town(checkSetOffFirework(state, actor, command));

    case "fish":
      return town(checkFish(state, actor, command));

    case "take_job":
      return town(checkTakeJob(state, actor, command));
    case "drop_job":
      return town(checkDropJob(state, actor));
    case "hand_in":
      return town(checkHandIn(state, actor, command));

    case "found_circle":
      return town(checkFoundCircle(state, actor, command));
    case "invite_to_circle":
      return town(checkInviteToCircle(state, actor, command));
    case "cancel_circle_invite":
      return town(checkCancelCircleInvite(state, actor, command));
    case "join_circle":
      return town(checkJoinCircle(state, actor, command));
    case "decline_circle_invite":
      return town(checkDeclineCircleInvite(state, actor, command));
    case "leave_circle":
      return town(checkLeaveCircle(state, actor));
    case "chip_in_circle":
      return town(checkChipInCircle(state, actor, command));
    case "remove_from_circle":
      return town(checkRemoveFromCircle(state, actor, command));
    case "set_circle_steward":
      return town(checkSetCircleSteward(state, actor, command));
    case "name_circle":
      return town(checkNameCircle(state, actor, command));
    case "set_circle_hall":
      return town(checkSetCircleHall(state, actor, command));
  }
}
