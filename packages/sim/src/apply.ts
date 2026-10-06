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
  checkCancelEvent,
  checkEventEnd,
  checkEventStart,
  checkEventTick,
  checkJoinEvent,
  checkScheduleEvent,
  checkScheduleTownEvent,
  checkVoidEvent,
  type EventsChecked,
  eventsLeavingPlot,
  eventsNewDay,
} from "./events";
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
import { checkGather, checkOpenFinds, checkOwnPlotPickups } from "./gather";
import { checkLay, checkLift } from "./ground";
import { checkTrickOrTreat, halloweenNewDay } from "./halloween";
import { canonicalJson, fnv1a } from "./hash";
import {
  checkCraft,
  checkDeclineGift,
  checkGiveItem,
  checkHarvest,
  checkOpenGifts,
  checkOpenItems,
  checkPlant,
  cropAt,
  decorPlaceProblem,
  decorRemoveProblem,
  type ItemsChecked,
  isHeldBlock,
  itemsNewDay,
  moveDecor,
  pantryDue,
  payPantry,
} from "./items";
import { plotKey, tileKey } from "./keys";
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
import { residentById } from "./own";
import {
  checkAdoptPet,
  checkGroomPet,
  checkRenamePet,
  checkTreatPet,
  type PetsChecked,
  petView,
} from "./pets";
import { checkImplicitPresence, checkLeaveIdle, type PresenceChecked } from "./presence";
import { isDirection, PUTTER_MAX_STEPS } from "./putter";
import { checkRoutineStep, checkSetRoutines, type RoutinesChecked } from "./routines";
import {
  checkOpenShop,
  checkSellToTown,
  checkSetShopShare,
  checkShopBuy,
  ownsWear,
  type ShopChecked,
  shopNewDay,
} from "./shop";
import {
  checkKeepTableSpots,
  checkPropose,
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
  WorldEvent,
  WorldState,
} from "./types";
import { BLOCK_KINDS, RESIDENT_COLORS, RESIDENT_SHAPES, TOWN_ACTOR } from "./types";
import { checkVisit } from "./visit";
import { checkSolidBuildings, STEPS_GO, stepFrom, walkSteps, worldGround } from "./walk";
import {
  canBuildOn,
  chebyshev,
  inBounds,
  isCommons,
  isSolid,
  plotAtTile,
  plotCenter,
  plotInBounds,
  plotOf,
  plotsOwnedBy,
  spawnTile,
  starterHome,
  walkHint,
} from "./world";

export const NAME_MAX_LENGTH = 24;
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
 * bought, or a partner's piece (worn or styled) they have no entitlement to (RFC 0007).
 */
function unownedWear(state: WorldState, actor: string, fields: ProfileFields): Prepared | null {
  const wear: readonly unknown[] = Array.isArray(fields.wear) ? fields.wear : [];
  const missing = wear.find((w) => isShopWear(w) && !ownsWear(state, actor, w));
  if (missing !== undefined) {
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
  const { actor, command } = input;
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

/** Tiles where an online resident other than `except` is standing, as tile keys. */
function standingTiles(state: WorldState, except: string): Set<string> {
  const tiles = new Set<string>();
  for (const r of Object.values(state.residents)) {
    if (r.online && r.id !== except) tiles.add(tileKey(r.x, r.y));
  }
  return tiles;
}

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
 * The unclaimed plot nearest to plot (px, py), not the Commons: by Chebyshev distance in plots,
 * then north to south, then west to east. Undefined when every plot is taken.
 */
function nearestFreePlot(
  state: WorldState,
  px: number,
  py: number,
): { px: number; py: number } | undefined {
  const { config } = state;
  const across = config.width / config.plotSize;
  const down = config.height / config.plotSize;
  let best: { px: number; py: number; d: number } | undefined;
  for (let y = 0; y < down; y++) {
    for (let x = 0; x < across; x++) {
      if (isCommons(config, x, y) || state.plots[plotKey(x, y)]) continue;
      const d = Math.max(Math.abs(x - px), Math.abs(y - py));
      if (!best || d < best.d) best = { px: x, py: y, d };
    }
  }
  return best && { px: best.px, py: best.py };
}

/** Where to settle or claim next: the free plot nearest to plot (px, py), as a call to make. */
function freePlotHint(state: WorldState, actor: string, px: number, py: number): string {
  const owned = plotsOwnedBy(state, actor).length;
  // Pointing at a free plot would only lead to plot_limit.
  if (owned >= state.config.maxPlotsPerResident) {
    return " You already own as many plots as you can.";
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
  if (me.hearth && !sameTile(me, me.hearth)) return " Try home to jump to your hearth.";
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
  // Returning residents keep their spot. If someone built on it while they were away, they go
  // to their hearth, or to the Commons if they have none.
  const keepSpot = me !== undefined && !isSolid(state, me.x, me.y);
  const spawn = me?.hearth ?? spawnTile(state.config);
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
      case "own_plot_pickups":
        return town(checkOwnPlotPickups(state));
      case "open_finds":
        return town(checkOpenFinds(state));
      case "solid_buildings":
        return town(checkSolidBuildings(state));
      case "keep_table_spots":
        return town(checkKeepTableSpots(state));
      case "open_shop":
        return town(checkOpenShop(state));
      case "set_shop_share":
        return town(checkSetShopShare(state, command));
      case "open_market":
        return town(checkOpenMarket(state));
      case "remove_listing":
        return town(checkRemoveListing(state, command));
      case "remove_display":
        return town(checkRemoveDisplay(state, command));
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
        if (!coins && !items && !shop && !bounties && !events && !games && !knocks) {
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
        ];
      }
      default:
        return town(checkTown(state, actor, command));
    }
  }

  if (command.type === "join") {
    if (me?.online) return reject("already_joined", "You are already in the world.");
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
      // A no-op would still cost a permanent log line and a broadcast.
      if (sameProfile(look, me)) return reject("invalid_profile", "Nothing to change.");
      return () => {
        setProfile(me, look);
        const { color, shape, note } = look;
        return [
          { type: "profile_changed", residentId: actor, color, shape, note, ...lookOf(look) },
        ];
      };
    }

    case "move": {
      if (!isDirection(command.dir)) return reject("out_of_bounds", STEPS_GO);
      const step = stepFrom(worldGround(state), me, command.dir);
      if (!step.ok) return reject(step.code, step.message);
      const { x, y } = step.to;
      return () => {
        me.x = x;
        me.y = y;
        return [{ type: "moved", residentId: actor, x, y }];
      };
    }

    case "putter": {
      const { steps } = command;
      if (!Array.isArray(steps) || steps.length === 0) {
        return reject("nowhere_to_go", `There's nowhere to walk from here.${stuckHint(state, me)}`);
      }
      if (steps.length > PUTTER_MAX_STEPS) {
        return reject("out_of_reach", `A putter walks at most ${PUTTER_MAX_STEPS} tiles.`);
      }
      // Each step is checked like a move, from where the last one left off.
      const walked = walkSteps(worldGround(state), me, steps);
      if (!walked.ok) return reject(walked.code, walked.message);
      const { path } = walked;
      return () =>
        path.map(({ x, y }) => {
          me.x = x;
          me.y = y;
          return { type: "moved", residentId: actor, x, y };
        });
    }

    case "claim": {
      const { px, py } = plotOf(config, me.x, me.y);
      if (isCommons(config, px, py)) {
        return reject("plot_is_commons", "The Commons belongs to everyone.");
      }
      if (state.plots[plotKey(px, py)]) {
        return reject(
          "plot_owned",
          `This plot is already claimed.${freePlotHint(state, actor, px, py)}`,
        );
      }
      if (plotsOwnedBy(state, actor).length >= config.maxPlotsPerResident) {
        return reject("plot_limit", `You can own at most ${config.maxPlotsPerResident} plot(s).`);
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
      // Releasing never demolishes: clear the blocks first. That keeps release a single,
      // honest change instead of a silent teardown (see decision 0018). Paths and floors too
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
              "Lift every path and floor on the plot first. One build with a lift list clears them all.",
            );
          }
        }
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
      // Events on the plot are called off: it's about to be nobody's (RFC 0010).
      const calledOff = eventsLeavingPlot(state, px, py);
      return () => {
        const events: WorldEvent[] = calledOff ? calledOff() : [];
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
      if (chebyshev(me, { x, y }) > config.reach) {
        return reject(
          "out_of_reach",
          `You can only build within ${config.reach} tiles.${walkHint(me, { x, y }, config.reach)}`,
        );
      }
      if (!canBuildOn(plotAtTile(state, x, y), actor)) {
        return reject(
          "not_your_plot",
          `Your hearth has to be on your own plot.${buildHint(state, me)}`,
        );
      }
      if (isSolid(state, x, y)) return reject("tile_occupied", "A block is there.");
      // Like profile, a no-op would still cost a permanent log line and a broadcast.
      if (me.hearth?.x === x && me.hearth.y === y) {
        return reject(
          "already_home",
          sameTile(me, me.hearth)
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
      if (me.x === hearth.x && me.y === hearth.y) {
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
      return () => {
        me.x = hearth.x;
        me.y = hearth.y;
        return [{ type: "moved", residentId: actor, x: hearth.x, y: hearth.y }];
      };
    }

    case "place":
    case "remove":
    case "lay":
    case "lift": {
      const { x, y } = command;
      if (!inBounds(config, x, y)) return reject("out_of_bounds", "That's outside the world.");
      if (chebyshev(me, { x, y }) > config.reach) {
        return reject(
          "out_of_reach",
          `You can only build within ${config.reach} tiles.${walkHint(me, { x, y }, config.reach)}`,
        );
      }
      if (!canBuildOn(plotAtTile(state, x, y), actor)) {
        return reject(
          "not_your_plot",
          `You can only build on your own plot.${buildHint(state, me)}`,
        );
      }
      // Paths and floors (RFC 0016) keep the same where-rules, and their own checks.
      if (command.type === "lay") return town(checkLay(state, actor, command));
      if (command.type === "lift") return town(checkLift(state, actor, command));
      const key = tileKey(x, y);
      if (command.type === "remove") {
        if (state.blocks[key] === undefined) return reject("no_block", "Nothing to remove there.");
        if (cropAt(state, x, y)) {
          return reject("tile_occupied", "Something is growing in that planter. Harvest it first.");
        }
        const shown = displayRemoveProblem(state, x, y);
        if (shown) return { ok: false, rejection: shown };
        const taken = state.blocks[key];
        const full = decorRemoveProblem(state, actor, taken);
        if (full) return { ok: false, rejection: full };
        return () => {
          delete state.blocks[key];
          return [{ type: "block_removed", x, y, by: actor }, ...moveDecor(state, actor, taken, 1)];
        };
      }
      if (state.blocks[key] !== undefined)
        return reject("tile_occupied", "A block is already there.");
      if (me.hearth?.x === x && me.hearth.y === y) {
        return reject("tile_occupied", "That's your hearth. Keep it clear.");
      }
      // A shared plot can hold more than one hearth, and nobody builds on anyone's.
      if (hearthTiles(state).has(key)) {
        return reject("tile_occupied", "That's someone's hearth. Keep it clear.");
      }
      const standingThere = Object.values(state.residents).some(
        (r) => r.online && r.x === x && r.y === y,
      );
      if (standingThere) return reject("tile_occupied", "Someone is standing there.");
      const { block } = command;
      if (!(BLOCK_KINDS as readonly unknown[]).includes(block)) {
        return reject("unknown_item", "That isn't a block you can place.");
      }
      const decor = decorPlaceProblem(state, actor, block);
      if (decor) return { ok: false, rejection: decor };
      return () => {
        state.blocks[key] = block;
        return [
          { type: "block_placed", x, y, block, by: actor },
          ...moveDecor(state, actor, block, -1),
        ];
      };
    }

    case "settle": {
      const { px, py } = command;
      if (!plotInBounds(config, px, py)) {
        return reject("out_of_bounds", "That plot is outside the world.");
      }
      if (isCommons(config, px, py)) {
        return reject("plot_is_commons", "The Commons belongs to everyone.");
      }
      const key = plotKey(px, py);
      if (state.plots[key]) {
        return reject(
          "plot_owned",
          `This plot is already claimed.${freePlotHint(state, actor, px, py)}`,
        );
      }
      if (plotsOwnedBy(state, actor).length > 0) {
        return reject(
          "plot_limit",
          "You already have a plot. Settle is for your first one; walk to another and claim it.",
        );
      }
      const to = landingTile(state, actor, px, py);
      return () => {
        state.plots[key] = { px, py, ownerId: actor, ...stampDay(state) };
        const events: WorldEvent[] = [{ type: "plot_claimed", px, py, ownerId: actor }];
        if (!sameTile(me, to)) {
          me.x = to.x;
          me.y = to.y;
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
      const onPlot = (t: Tile) => {
        const p = plotOf(config, t.x, t.y);
        return inBounds(config, t.x, t.y) && p.px === plot.px && p.py === plot.py;
      };
      if (isHeldBlock(command.walls) || isHeldBlock(command.windows)) {
        return reject(
          "unknown_item",
          "A starter home is built from free blocks. Place decor and furniture yourself with place.",
        );
      }
      const home = starterHome(
        config,
        plot.px,
        plot.py,
        command.walls ?? "wood",
        command.windows ?? "glass",
      );
      const hearthFree = onPlot(home.hearth) && !isSolid(state, home.hearth.x, home.hearth.y);
      const setHearth = hearthFree && !(me.hearth && sameTile(me.hearth, home.hearth));
      // Never build on a block, a hearth, or anyone else standing there. The builder's own hearth
      // is fair game when this moves it to the middle of the hut.
      const others = standingTiles(state, actor);
      const hearths = hearthTiles(state, setHearth ? actor : undefined);
      let blocks = home.blocks.filter((b) => {
        const key = tileKey(b.x, b.y);
        return onPlot(b) && !isSolid(state, b.x, b.y) && !hearths.has(key) && !others.has(key);
      });
      // The builder steps onto the hearth tile rather than get walled in. If that tile holds a
      // block, the wall where they stand stays open instead.
      let moveTo: Tile | null = null;
      if (blocks.some((b) => sameTile(b, me))) {
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
        // Their events here are called off with their share (RFC 0010).
        const calledOff = eventsLeavingPlot(state, px, py, target);
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
    case "craft":
      return town(checkCraft(state, actor, command));
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

    case "shop_buy":
      return town(checkShopBuy(state, actor, command));
    case "sell_to_town":
      return town(checkSellToTown(state, actor, command));

    case "list_item":
      return town(checkListItem(state, actor, command));
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
  }
}
