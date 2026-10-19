import { coinCount, isWhole, oneTimeSwitch, refuse } from "./check";
import { isTownsfolk, movePurse, sameHousehold } from "./economy";
import { callOff, eventOpen } from "./events";
import { dayName } from "./holiday";
import { plotKey } from "./keys";
import { showTitle } from "./levels";
import { own, residentById } from "./own";
import { weekStart } from "./season";
import { townEligibility } from "./town";
import type {
  Circle,
  CirclesState,
  CircleTitle,
  Command,
  HostedEvent,
  Rejection,
  ResidentId,
  WorldEvent,
  WorldState,
} from "./types";
import { canBuildOn, isCommons, plotInBounds } from "./world";

/**
 * Circles (RFC 0033): a small named group of residents, people, agents, or both, with a steward
 * or two, a hall, and one shared ritual, circle night. Everything here is a logged input checked
 * against the state, and nothing runs until the server logs `open_circles`, so older worlds hash
 * as they always have.
 *
 * A circle is founded for a fee that's burned and starts out forming. It's formed once its members
 * come from `CIRCLES.formHouseholds` households, and a `new_day` disbands one still forming after
 * `CIRCLES.formDays` days. Members join only by accepting a steward's invite. A circle night is an
 * ordinary hosted event at the hall with `circle` set (`circleNightProblem`, called from
 * `schedule_event`); at its `event_end` the week counts as gathered when enough members from enough
 * households were there (`circleNightEnd`), and those members are no counted guests there.
 *
 * Names are resident text: the server cleans and filters them before they're logged. The sim checks
 * their length and that no other circle has one that's the same with ASCII letters folded.
 */

/** The numbers (RFC 0033). Replay checks logged inputs against them. */
export const CIRCLES = {
  /** A name's length, in characters. */
  nameMin: 3,
  nameMax: 32,
  /**
   * Coins founding takes, burned. A circle that doesn't form gives back all but `trialBurn` of
   * them: what members chipped in to whoever chipped it, and the rest to its founder.
   */
  fee: 25,
  /** What founding costs when the circle doesn't form: the founder's share that stays burned. */
  trialBurn: 5,
  /** Members at most, stewards included. */
  membersMax: 12,
  /** Members from one household at most. */
  perHousehold: 3,
  /** Households its members must come from for it to be formed. */
  formHouseholds: 3,
  /** Days a circle has to form, from its founding day. */
  formDays: 14,
  /** Open invites a circle holds at once. */
  invitesMax: 8,
  /** Days an invite lasts. It lapses at the `new_day` that many days after it was sent. */
  inviteDays: 7,
  /** An invite's note, in characters. Untrusted text, like a gift's note. */
  noteMax: 280,
  /** Days a resident waits after leaving or being removed before they found or join one. */
  waitDays: 7,
  /** Stewards at most. */
  stewardsMax: 3,
  /** Members, the host included, who must attend a circle night for its week to count... */
  nightMembers: 3,
  /** ...from at least this many households. */
  nightHouseholds: 2,
  /** Gathered weeks a circle keeps, newest last. */
  gatheredKeep: 52,
  /** Counted circle nights attended that unlock the title. */
  regularAt: 8,
} as const;

/** Each circle title's words, and which `CIRCLES` number is the count of nights that unlocks it. */
export const CIRCLE_TITLE_INFO: Record<CircleTitle, { label: string; at: "regularAt" }> = {
  circle_regular: { label: "Circle regular", at: "regularAt" },
};

type Mutation = () => WorldEvent[];
export type CirclesChecked = Mutation | Rejection;

// ---------- reading ----------

/** A circle by id, if it's standing. */
export const circleById = (state: WorldState, id: unknown): Circle | undefined =>
  typeof id === "string" ? own(state.circles?.list, id) : undefined;

/** Whether `id` is a member of `k`. */
export const isMember = (k: Circle, id: ResidentId): boolean => Object.hasOwn(k.members, id);

/** Whether `id` is one of `k`'s stewards. */
export const isSteward = (k: Circle, id: ResidentId): boolean => k.stewards.includes(id);

/** The circle `id` is in, if any. A resident is in one at most. */
export function circleOf(state: WorldState, id: ResidentId): Circle | undefined {
  for (const k of Object.values(state.circles?.list ?? {})) if (isMember(k, id)) return k;
  return undefined;
}

/** What a circle goes by: its name, or "Circle 3" after staff took its name down. */
export const circleName = (k: Pick<Circle, "id" | "name">): string =>
  k.name ?? `Circle ${k.id.replace(/^c_/, "")}`;

/**
 * What a circle goes by where others read it: its name, or "Circle 3" while `held` says staff
 * hold back the words of whoever wrote it, as a plot's name is held. Presentation only.
 */
export const shownCircleName = (
  k: Pick<Circle, "id" | "name" | "namedBy">,
  held: (id: ResidentId) => boolean = () => false,
): string =>
  k.namedBy !== undefined && held(k.namedBy) ? circleName({ id: k.id }) : circleName(k);

/** Its members, longest-standing first. */
export const membersByStanding = (k: Circle): ResidentId[] =>
  Object.entries(k.members)
    .sort(([, a], [, b]) => a.seq - b.seq)
    .map(([id]) => id);

/** How many households `ids` come from (`sameHousehold`), grouping them in the order given. */
export function householdCount(state: WorldState, ids: readonly ResidentId[]): number {
  const firsts: ResidentId[] = [];
  for (const id of ids) {
    if (!firsts.some((other) => sameHousehold(state, other, id))) firsts.push(id);
  }
  return firsts.length;
}

/** Members of `k` in `id`'s household, `id` included when they're one. */
const fromHousehold = (state: WorldState, k: Circle, id: ResidentId) =>
  Object.keys(k.members).filter((m) => sameHousehold(state, m, id)).length;

/** Circle nights `id` attended that counted, across every circle. */
export const circleNights = (state: WorldState, id: ResidentId): number =>
  own(state.circles?.nights, id) ?? 0;

/** Weeks in a row a circle gathered, up to this week or last week. 0 once a week went by. */
export function gatheredRun(k: Pick<Circle, "gathered">, day: number): number {
  const weeks = k.gathered ?? [];
  const last = weeks.at(-1);
  if (last === undefined || last < weekStart(day) - 7) return 0;
  let run = 1;
  for (let i = weeks.length - 1; i > 0 && weeks[i - 1] === (weeks[i] as number) - 7; i--) run++;
  return run;
}

/** Days `id` still waits after leaving a circle, or 0. */
export function waitLeft(state: WorldState, id: ResidentId): number {
  const left = own(state.circles?.leftDay, id);
  if (left === undefined) return 0;
  return Math.max(0, left + CIRCLES.waitDays - (state.day ?? 0));
}

/** The circle whose hall is plot (px, py), if any. */
export const hallAt = (state: WorldState, px: number, py: number): Circle | undefined =>
  Object.values(state.circles?.list ?? {}).find((k) => k.hall?.px === px && k.hall.py === py);

/** A name with ASCII letters folded, for "no other circle has it". */
const nameKey = (name: string) => name.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** What staff-cleared circles go by: no circle takes it as a name. */
const BY_ID = /^circle\s*\d+$/i;

/** A name as the sim keeps it, or why it can't be one. `except` is the circle being renamed. */
function nameOf(state: WorldState, value: unknown, except?: Circle): string | Rejection {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < CIRCLES.nameMin || name.length > CIRCLES.nameMax) {
    return refuse(
      "invalid_name",
      `A circle's name is ${CIRCLES.nameMin} to ${CIRCLES.nameMax} characters.`,
    );
  }
  if (BY_ID.test(name)) {
    return refuse("invalid_name", "That's how a circle without a name is shown. Pick another.");
  }
  const key = nameKey(name);
  for (const k of Object.values(state.circles?.list ?? {})) {
    if (k !== except && k.name !== undefined && nameKey(k.name) === key) {
      return refuse("name_taken", "Another circle has that name.");
    }
  }
  return name;
}

/** "1 day", "3 days". */
const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** Whether `k` was renamed in `day`'s UTC week already, so a rename waits for the next. */
export const renamedThisWeek = (k: Pick<Circle, "renamedDay">, day: number): boolean =>
  k.renamedDay !== undefined && weekStart(k.renamedDay) === weekStart(day);

// ---------- checks every command shares ----------

/** The circles state, or why circles aren't open. */
function opened(state: WorldState): CirclesState | Rejection {
  return state.circles ?? refuse("circles_closed", "Circles aren't open in this world yet.");
}

const isRejection = (value: unknown): value is Rejection =>
  typeof value === "object" && value !== null && "code" in value;

/** The actor's circle, or why they have none. */
function mine(state: WorldState, actor: ResidentId): Circle | Rejection {
  const on = opened(state);
  if (isRejection(on)) return on;
  return (
    circleOf(state, actor) ??
    refuse("not_in_circle", "You aren't in a circle. Found one, or accept an invite.")
  );
}

/** The actor's circle when they're one of its stewards, or why not. */
function stewarding(state: WorldState, actor: ResidentId): Circle | Rejection {
  const k = mine(state, actor);
  if (isRejection(k)) return k;
  if (!isSteward(k, actor)) return refuse("not_steward", "Only a steward can do that.");
  return k;
}

/** The circle named by an input, or why there's none. */
function named(state: WorldState, id: unknown): Circle | Rejection {
  const on = opened(state);
  if (isRejection(on)) return on;
  return (
    circleById(state, id) ?? refuse("unknown_circle", "No circle has that id. See GET /v1/circles.")
  );
}

/** Why `id` can't be in a circle again yet, or null. */
function waiting(state: WorldState, id: ResidentId, who: "You" | "They"): Rejection | null {
  const left = waitLeft(state, id);
  if (left === 0) return null;
  return refuse(
    "wait_after_leaving",
    `${who} left a circle recently. ${who} can be in one again in ${days(left)}.`,
  );
}

/** Why `k` can't take `id` as a member now, or null: its size, and its share of one household. */
function roomFor(state: WorldState, k: Circle, id: ResidentId): Rejection | null {
  if (Object.keys(k.members).length >= CIRCLES.membersMax) {
    return refuse("circle_full", `A circle has at most ${CIRCLES.membersMax} members.`);
  }
  if (fromHousehold(state, k, id) >= CIRCLES.perHousehold) {
    return refuse(
      "household_full",
      `A circle has at most ${CIRCLES.perHousehold} members from one household (a person and their AIs).`,
    );
  }
  return null;
}

// ---------- changes, for commits only ----------

const stamp = (state: WorldState) => ({ since: state.day ?? 0, seq: state.seq + 1 });

/** Close every invite `id` holds, because they're in a circle now. */
function closeInvitesOf(state: WorldState, id: ResidentId): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (const k of Object.values(state.circles?.list ?? {})) {
    if (!k.invites || !Object.hasOwn(k.invites, id)) continue;
    dropInvite(k, id);
    events.push({ type: "circle_uninvited", circle: k.id, residentId: id, how: "joined" });
  }
  return events;
}

function dropInvite(k: Circle, id: ResidentId) {
  if (!k.invites) return;
  delete k.invites[id];
  if (Object.keys(k.invites).length === 0) delete k.invites;
}

/** It's formed once its members come from enough households. */
function formIfReady(state: WorldState, k: Circle): WorldEvent[] {
  if (k.status !== "forming") return [];
  if (householdCount(state, membersByStanding(k)) < CIRCLES.formHouseholds) return [];
  k.status = "formed";
  k.formedDay = state.day ?? 0;
  return [{ type: "circle_formed", circle: k.id }];
}

/**
 * Call off `k`'s circle nights still on the calendar (only `host`'s, when given): their hall is
 * going, the circle is, or their host is leaving it, and a night only stands at the hall of a
 * circle its host is in. Read at commit time, so nights an earlier part of the same commit
 * called off (a `release`) aren't called off twice. A hall is never the Commons, so no deposit.
 */
function nightsOff(state: WorldState, k: Circle, host?: ResidentId): WorldEvent[] {
  return (state.events?.list ?? [])
    .filter((e) => e.circle === k.id && eventOpen(e) && (host === undefined || e.host === host))
    .flatMap((e) => callOff(state, e, true));
}

function disband(state: WorldState, k: Circle, how: "empty" | "unformed" | "staff"): WorldEvent[] {
  const off = nightsOff(state, k);
  delete state.circles?.list[k.id];
  const back = k.status === "forming" ? refundFee(state, k, how === "unformed") : [];
  return [...off, { type: "circle_disbanded", circle: k.id, how }, ...back];
}

/** Whose purse a coin for `id` goes to: `id`, or the record a duplicate of it was merged into. */
const payee = (state: WorldState, id: ResidentId): ResidentId =>
  own(state.mergedResidents, id) ?? id;

/** What members have chipped in toward `k`'s fee, in all. */
export const chippedIn = (k: Circle): number =>
  Object.values(k.chips ?? {}).reduce((sum, n) => sum + n, 0);

/**
 * A forming circle's fee when it goes (issue #69): each member who chipped in gets their coins
 * back, however it went, and when it went for not forming in time (`founderToo`) its founder gets
 * the rest but `trialBurn`. One that emptied or that staff disbanded gives its founder nothing back.
 * The coins were burned at founding, so they're minted back, `circle_refund` on each ledger: never
 * more than the fee less `trialBurn`.
 */
function refundFee(state: WorldState, k: Circle, founderToo: boolean): WorldEvent[] {
  const econ = state.economy;
  if (!econ) return [];
  const at = { seq: state.seq + 1, day: state.day ?? 0 };
  const owed: [ResidentId, number][] = [
    ...Object.entries(k.chips ?? {}),
    ...(founderToo
      ? [[k.founder, CIRCLES.fee - CIRCLES.trialBurn - chippedIn(k)] as [ResidentId, number]]
      : []),
  ];
  const events: WorldEvent[] = [];
  for (const [id, coins] of owed) {
    if (coins <= 0) continue;
    econ.minted += coins;
    events.push(movePurse(econ, payee(state, id), coins, "circle_refund", at));
  }
  return events;
}

/**
 * `chip_in_circle {circle, coins}`: a member who isn't its founder pays part of a forming
 * circle's fee to its founder (issue #69). Members together pay up to the fee less `trialBurn`, so
 * the founder always carries that much of the risk. Each gets their part back if it doesn't form.
 */
export function checkChipInCircle(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "chip_in_circle" }>,
): CirclesChecked {
  const on = opened(state);
  if (isRejection(on)) return on;
  const k = named(state, command.circle);
  if (isRejection(k)) return k;
  if (!isMember(k, actor)) return refuse("not_in_circle", "Only its members chip in.");
  if (payee(state, k.founder) === actor) {
    return refuse("not_eligible", "You founded it: you paid the fee, and members chip in to you.");
  }
  if (k.status !== "forming") {
    return refuse("not_forming", "It has formed already: its fee is paid.");
  }
  const { coins } = command;
  const room = CIRCLES.fee - CIRCLES.trialBurn - chippedIn(k);
  if (!isWhole(coins) || coins < 1) return refuse("invalid_amount", "Chip in 1 coin or more.");
  if (room <= 0) {
    return refuse("chip_in_full", "Members have chipped in all they can toward this fee.");
  }
  if (coins > room) {
    return refuse("invalid_amount", `Members can chip in ${coinCount(room)} more toward this fee.`);
  }
  const econ = state.economy;
  if (!econ) return refuse("economy_closed", "Coins aren't open yet.");
  const have = econ.coins[actor] ?? 0;
  if (have < coins) {
    return refuse("not_enough_coins", `You have ${coinCount(have)}.`);
  }
  const at = { seq: state.seq + 1, day: state.day ?? 0 };
  return () => {
    k.chips = { ...k.chips, [actor]: (own(k.chips, actor) ?? 0) + coins };
    return [
      movePurse(econ, actor, -coins, "circle_share", at),
      movePurse(econ, payee(state, k.founder), coins, "circle_share", at),
      { type: "circle_chipped_in", circle: k.id, residentId: actor, coins },
    ];
  };
}

/** Its hall goes, and the nights booked there with it. */
function clearHall(state: WorldState, k: Circle): WorldEvent[] {
  if (!k.hall) return [];
  delete k.hall;
  return [{ type: "circle_hall", circle: k.id, hall: null }, ...nightsOff(state, k)];
}

/**
 * `id` stops being one of `k`'s stewards: the hall goes when it's their plot, and when nobody is
 * left stewarding, the longest-standing member who's left becomes one.
 */
function stepDown(state: WorldState, k: Circle, id: ResidentId): WorldEvent[] {
  k.stewards = k.stewards.filter((s) => s !== id);
  const events: WorldEvent[] = [
    { type: "circle_steward", circle: k.id, residentId: id, steward: false },
  ];
  if (k.hall?.by === id) events.push(...clearHall(state, k));
  const next = membersByStanding(k).find((m) => m !== id);
  if (k.stewards.length === 0 && next !== undefined) {
    k.stewards = [next];
    events.push({ type: "circle_steward", circle: k.id, residentId: next, steward: true });
  }
  return events;
}

/**
 * `id` leaves `k`: a steward steps down on the way out, and the last member out disbands it. One
 * who left or was removed waits `CIRCLES.waitDays` before they're in one again.
 */
function removeMember(
  state: WorldState,
  k: Circle,
  id: ResidentId,
  how: "left" | "removed" | "merged",
): WorldEvent[] {
  const events: WorldEvent[] = [];
  const wasSteward = isSteward(k, id);
  delete k.members[id];
  events.push({ type: "circle_left", circle: k.id, residentId: id, how });
  events.push(...nightsOff(state, k, id));
  const circles = state.circles;
  if (circles && how !== "merged") circles.leftDay = { ...circles.leftDay, [id]: state.day ?? 0 };
  if (Object.keys(k.members).length === 0) return [...events, ...disband(state, k, "empty")];
  if (wasSteward) events.push(...stepDown(state, k, id));
  return events;
}

// ---------- residents ----------

/** Why `id` can't found a circle now, or null. Read-only, for views; `found_circle` checks the same. */
export function foundProblem(state: WorldState, id: ResidentId): Rejection | null {
  const on = opened(state);
  if (isRejection(on)) return on;
  if (isTownsfolk(state, id)) return refuse("not_eligible", "Townsfolk don't found circles.");
  const ok = townEligibility(state, id);
  if (!ok.eligible) {
    return refuse(
      "not_eligible",
      `To found a circle, you need what voting in the Town Hall needs. ${ok.message}`,
    );
  }
  const k = circleOf(state, id);
  if (k) return refuse("in_circle", "You're already in a circle. Leave it first.");
  const wait = waiting(state, id, "You");
  if (wait) return wait;
  const have = state.economy?.coins[id] ?? 0;
  if (have < CIRCLES.fee) {
    return refuse(
      "not_enough_coins",
      `Founding a circle is ${coinCount(CIRCLES.fee)}, and you have ${coinCount(have)}.`,
    );
  }
  return null;
}

/** `found_circle {name}`: found a circle, forming, as its first steward, for the fee, burned. */
export function checkFoundCircle(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "found_circle" }>,
): CirclesChecked {
  const problem = foundProblem(state, actor);
  if (problem) return problem;
  const name = nameOf(state, command.name);
  if (isRejection(name)) return name;
  const circles = state.circles as CirclesState;
  const econ = state.economy;
  if (!econ) return refuse("economy_closed", "Coins aren't open yet.");
  const at = { seq: state.seq + 1, day: state.day ?? 0 };
  return () => {
    const id = `c_${circles.nextId}`;
    circles.nextId += 1;
    circles.list[id] = {
      id,
      name,
      namedBy: actor,
      founder: actor,
      foundedDay: at.day,
      status: "forming",
      stewards: [actor],
      members: { [actor]: stamp(state) },
    };
    econ.burned += CIRCLES.fee;
    return [
      { type: "circle_founded", circle: id, name, founder: actor },
      movePurse(econ, actor, -CIRCLES.fee, "circle_fee", at),
      ...closeInvitesOf(state, actor),
    ];
  };
}

/** Why a steward of `k` can't invite `id`, or null. The server refuses an invite across a block. */
function inviteProblem(state: WorldState, k: Circle, id: ResidentId): Rejection | null {
  const them = residentById(state, id);
  if (!them) return refuse("unknown_resident", "Nobody in the world has that id.");
  if (isTownsfolk(state, id)) return refuse("not_eligible", "Townsfolk aren't in circles.");
  if (!them.hearth) return refuse("no_hearth", "They need a hearth before they join a circle.");
  const theirs = circleOf(state, id);
  if (theirs) {
    return refuse(
      "in_circle",
      theirs === k ? "They're already in your circle." : "They're already in a circle.",
    );
  }
  const wait = waiting(state, id, "They");
  if (wait) return wait;
  if (k.invites && Object.hasOwn(k.invites, id)) {
    return refuse("already_invited", "They already hold an invite from your circle.");
  }
  if (Object.keys(k.invites ?? {}).length >= CIRCLES.invitesMax) {
    return refuse(
      "invite_limit",
      `A circle holds at most ${CIRCLES.invitesMax} open invites. Take one back, or wait for one to be answered.`,
    );
  }
  return roomFor(state, k, id);
}

/**
 * `invite_to_circle {resident, note?}`: a steward invites a resident with a hearth who's in no
 * circle. The note is the steward's own words to them, kept on the invite and shown wherever the
 * invite is (issue #73). The server cleans and filters it first, as it does a gift's note.
 */
export function checkInviteToCircle(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "invite_to_circle" }>,
): CirclesChecked {
  const k = stewarding(state, actor);
  if (isRejection(k)) return k;
  const { resident, note } = command;
  if (note !== undefined && (typeof note !== "string" || note.length > CIRCLES.noteMax)) {
    return refuse("invalid_note", `A note is text, at most ${CIRCLES.noteMax} characters.`);
  }
  const problem = inviteProblem(state, k, resident);
  if (problem) return problem;
  const day = state.day ?? 0;
  const words = note ? { note } : {};
  return () => {
    k.invites = { ...k.invites, [resident]: { by: actor, day, ...words } };
    return [{ type: "circle_invited", circle: k.id, residentId: resident, by: actor, ...words }];
  };
}

/** `cancel_circle_invite {resident}`: a steward takes an open invite back. */
export function checkCancelCircleInvite(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "cancel_circle_invite" }>,
): CirclesChecked {
  const k = stewarding(state, actor);
  if (isRejection(k)) return k;
  const { resident } = command;
  if (typeof resident !== "string" || !k.invites || !Object.hasOwn(k.invites, resident)) {
    return refuse("no_invite", "They hold no invite from your circle.");
  }
  return () => {
    dropInvite(k, resident);
    return [{ type: "circle_uninvited", circle: k.id, residentId: resident, how: "cancelled" }];
  };
}

/** The invited circle and its invite to `actor`, or why there's none. */
function invitedTo(state: WorldState, actor: ResidentId, id: unknown): Circle | Rejection {
  const k = named(state, id);
  if (isRejection(k)) return k;
  if (!k.invites || !Object.hasOwn(k.invites, actor)) {
    return refuse("no_invite", "You hold no invite from that circle. A steward invites you.");
  }
  return k;
}

/** `join_circle {circle}`: accept an invite you hold. Your other invites close. */
export function checkJoinCircle(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "join_circle" }>,
): CirclesChecked {
  const k = invitedTo(state, actor, command.circle);
  if (isRejection(k)) return k;
  if (isTownsfolk(state, actor)) return refuse("not_eligible", "Townsfolk aren't in circles.");
  const theirs = circleOf(state, actor);
  if (theirs) return refuse("in_circle", "You're already in a circle. Leave it first.");
  const problem = waiting(state, actor, "You") ?? roomFor(state, k, actor);
  if (problem) return problem;
  return () => {
    dropInvite(k, actor);
    k.members[actor] = stamp(state);
    return [
      { type: "circle_joined", circle: k.id, residentId: actor },
      ...closeInvitesOf(state, actor),
      ...formIfReady(state, k),
    ];
  };
}

/** `decline_circle_invite {circle}`: turn an invite down. */
export function checkDeclineCircleInvite(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "decline_circle_invite" }>,
): CirclesChecked {
  const k = invitedTo(state, actor, command.circle);
  if (isRejection(k)) return k;
  return () => {
    dropInvite(k, actor);
    return [{ type: "circle_uninvited", circle: k.id, residentId: actor, how: "declined" }];
  };
}

/** `leave_circle`: leave yours, any time. The last member out disbands it. */
export function checkLeaveCircle(state: WorldState, actor: ResidentId): CirclesChecked {
  const k = mine(state, actor);
  if (isRejection(k)) return k;
  return () => removeMember(state, k, actor, "left");
}

/** `remove_from_circle {resident}`: a steward removes a member who isn't a steward. */
export function checkRemoveFromCircle(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "remove_from_circle" }>,
): CirclesChecked {
  const k = stewarding(state, actor);
  if (isRejection(k)) return k;
  const { resident } = command;
  if (typeof resident !== "string" || !isMember(k, resident)) {
    return refuse("not_in_circle", "They aren't in your circle.");
  }
  if (isSteward(k, resident)) {
    return refuse("not_eligible", "A steward can't be removed. A steward steps down themselves.");
  }
  // What they chipped in toward the fee is theirs to get back if it doesn't form (issue #69).
  if (k.status === "forming" && (own(k.chips, resident) ?? 0) > 0) {
    return refuse(
      "chipped_in",
      "They chipped in toward the fee, so they stay while it forms. They can leave themselves.",
    );
  }
  return () => removeMember(state, k, resident, "removed");
}

/** `set_circle_steward {resident, steward}`: make a member a steward, or step down yourself. */
export function checkSetCircleSteward(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "set_circle_steward" }>,
): CirclesChecked {
  const k = stewarding(state, actor);
  if (isRejection(k)) return k;
  const { resident, steward } = command;
  if (typeof steward !== "boolean") {
    return refuse("not_eligible", "Say steward: true to make one, or false to step down.");
  }
  if (typeof resident !== "string" || !isMember(k, resident)) {
    return refuse("not_in_circle", "They aren't in your circle.");
  }
  if (!steward) {
    if (resident !== actor) {
      return refuse("not_eligible", "A steward steps down themselves: name yourself.");
    }
    if (Object.keys(k.members).length === 1) {
      return refuse(
        "not_eligible",
        "You're its only member, so it needs you as its steward. leave_circle disbands it.",
      );
    }
    return () => stepDown(state, k, actor);
  }
  if (isSteward(k, resident)) return refuse("already_set", "They're a steward already.");
  if (k.stewards.length >= CIRCLES.stewardsMax) {
    return refuse("not_eligible", `A circle has at most ${CIRCLES.stewardsMax} stewards.`);
  }
  return () => {
    k.stewards = [...k.stewards, resident];
    return [{ type: "circle_steward", circle: k.id, residentId: resident, steward: true }];
  };
}

/** `name_circle {name}`: a steward renames it, once a UTC week. */
export function checkNameCircle(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "name_circle" }>,
): CirclesChecked {
  const k = stewarding(state, actor);
  if (isRejection(k)) return k;
  const day = state.day ?? 0;
  if (renamedThisWeek(k, day)) {
    return refuse(
      "rename_limit",
      `A circle is renamed once a UTC week, and it was this week. The next rename can come on Monday, ${dayName(weekStart(day) + 7)} (UTC).`,
    );
  }
  const name = nameOf(state, command.name, k);
  if (isRejection(name)) return name;
  if (name === k.name) return refuse("invalid_name", "That's its name already.");
  return () => {
    k.name = name;
    k.namedBy = actor;
    k.renamedDay = day;
    return [{ type: "circle_named", circle: k.id, name, by: actor }];
  };
}

/**
 * `set_circle_hall {px, py}`: a steward of a formed circle makes a plot they own or share its
 * hall, or clears the hall with both `null`. A plot is one circle's hall at most.
 */
export function checkSetCircleHall(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "set_circle_hall" }>,
): CirclesChecked {
  const k = stewarding(state, actor);
  if (isRejection(k)) return k;
  const { px, py } = command;
  if (px === null && py === null) {
    if (!k.hall) return refuse("already_set", "It has no hall to clear.");
    return () => clearHall(state, k);
  }
  if (k.status !== "formed") {
    return refuse(
      "not_formed",
      "A forming circle has no hall yet. It forms with three households.",
    );
  }
  if (!isWhole(px) || !isWhole(py) || !plotInBounds(state.config, px, py)) {
    return refuse("out_of_bounds", "That plot is outside the world.");
  }
  if (isCommons(state.config, px, py)) {
    return refuse("plot_is_commons", "The Commons belongs to everyone, so it's nobody's hall.");
  }
  if (!canBuildOn(own(state.plots, plotKey(px, py)), actor)) {
    return refuse("not_your_plot", "A hall is a plot you own, or one shared with you.");
  }
  if (k.hall?.px === px && k.hall.py === py)
    return refuse("already_set", "That's its hall already.");
  const other = hallAt(state, px, py);
  if (other) return refuse("already_set", "That plot is another circle's hall.");
  return () => {
    // Nights booked at the old hall are called off: a night stands only at the hall.
    const moved = nightsOff(state, k);
    k.hall = { px, py, by: actor };
    return [{ type: "circle_hall", circle: k.id, hall: { px, py }, name: circleName(k) }, ...moved];
  };
}

/** A title from circle nights: `not_earned` short of its count, else what `showTitle` does. */
export function checkCircleTitle(
  state: WorldState,
  id: ResidentId,
  title: CircleTitle,
): Mutation | Rejection | undefined {
  const { label, at } = CIRCLE_TITLE_INFO[title];
  const need = CIRCLES[at];
  const nights = circleNights(state, id);
  if (nights < need) {
    return refuse(
      "not_earned",
      `${label} comes with ${need} circle nights that counted, and you've been at ${nights}.`,
    );
  }
  return showTitle(state, id, title);
}

// ---------- circle night ----------

/**
 * Why `actor` can't put on a circle night for `circle` at plot (px, py) on world day `day`, or
 * null: they're a member, it's formed, the place is its hall, and it has no other circle night
 * that UTC week. The hall stands in for the host's own plot, so any member hosts there.
 */
export function circleNightProblem(
  state: WorldState,
  actor: ResidentId,
  circle: unknown,
  px: number,
  py: number,
  day: number,
): Rejection | null {
  const k = named(state, circle);
  if (isRejection(k)) return k;
  if (!isMember(k, actor)) return refuse("not_in_circle", "Only its members host a circle night.");
  if (k.status !== "formed") {
    return refuse(
      "not_formed",
      "A forming circle holds no circle nights. It forms with three households.",
    );
  }
  if (!k.hall)
    return refuse("not_your_plot", "It has no hall yet: a steward sets one with set_circle_hall.");
  if (k.hall.px !== px || k.hall.py !== py) {
    return refuse(
      "not_your_plot",
      `A circle night is at its hall, plot (${k.hall.px}, ${k.hall.py}).`,
    );
  }
  const week = weekStart(day);
  const taken = state.events?.list.some(
    (e) => e.circle === k.id && e.status !== "cancelled" && weekStart(e.day) === week,
  );
  if (taken) {
    return refuse(
      "night_this_week",
      "That circle has a circle night that UTC week already. One a week, Monday to Sunday.",
    );
  }
  return null;
}

/** Who was in a circle night's circle as it started, sorted, for `event_start`; else undefined. */
export function circleNightStart(state: WorldState, e: HostedEvent): ResidentId[] | undefined {
  if (e.circle === undefined) return undefined;
  const k = circleById(state, e.circle);
  return k ? Object.keys(k.members).sort() : [];
}

/**
 * What `event_end` does at a circle night, worked out before anything changes: who was in the
 * circle as it started (`kin` from `event_start`) or is in it now, seen at enough samples, the
 * host included, go on the event as `kin`, and when they're
 * `nightMembers` or more from `nightHouseholds` households the week counts once, with a night for
 * each of them toward the title.
 */
export function circleNightEnd(state: WorldState, e: HostedEvent, need: number): Mutation | null {
  if (e.circle === undefined) return null;
  const k = circleById(state, e.circle);
  const atStart = e.kin ?? [];
  const kin = Object.entries(e.seen ?? {})
    .filter(
      ([id, n]) => n >= need && (atStart.includes(id) || (k !== undefined && isMember(k, id))),
    )
    .map(([id]) => id)
    .sort();
  const week = weekStart(e.day);
  const counts =
    k !== undefined &&
    kin.length >= CIRCLES.nightMembers &&
    householdCount(state, kin) >= CIRCLES.nightHouseholds &&
    !(k.gathered ?? []).includes(week);
  return () => {
    e.kin = kin;
    const circles = state.circles;
    if (!counts || !k || !circles) return [];
    k.gathered = [...(k.gathered ?? []), week].sort((a, b) => a - b).slice(-CIRCLES.gatheredKeep);
    const nights = { ...circles.nights };
    for (const id of kin) nights[id] = (own(nights, id) ?? 0) + 1;
    circles.nights = nights;
    return [
      {
        type: "circle_gathered",
        circle: k.id,
        event: e.id,
        week,
        members: [...kin],
        weeks: k.gathered.length,
      },
    ];
  };
}

// ---------- plots leaving someone's hands ----------

/**
 * What `release` (every hall there) or `unshare_plot` (only `by`'s) does to circle halls on plot
 * (px, py): they're cleared. Worked out before anything changes; null when there are none.
 */
export function hallsLeavingPlot(
  state: WorldState,
  px: number,
  py: number,
  by?: ResidentId,
): Mutation | null {
  const k = hallAt(state, px, py);
  if (!k || (by !== undefined && k.hall?.by !== by)) return null;
  return () => clearHall(state, k);
}

// ---------- the server's inputs ----------

/** `open_circles`, once, from TOWN_ACTOR: residents may found and join circles from now on. */
export function checkOpenCircles(state: WorldState): CirclesChecked {
  return oneTimeSwitch({
    on: state.circles,
    already: "Circles are already open.",
    notYet: () =>
      state.day === undefined || !state.economy
        ? refuse("not_due", "Circles open once the world counts days and coins are open.")
        : null,
    turnOn: () => {
      state.circles = { opened: state.day as number, nextId: 1, list: {} };
    },
    event: { type: "circles_opened" },
  });
}

/** `clear_circle_name {circle}`, from TOWN_ACTOR for staff: its name comes down. */
export function checkClearCircleName(
  state: WorldState,
  command: Extract<Command, { type: "clear_circle_name" }>,
): CirclesChecked {
  const k = named(state, command.circle);
  if (isRejection(k)) return k;
  if (k.name === undefined) return refuse("already_set", "Its name is already down.");
  return () => {
    delete k.name;
    delete k.namedBy;
    return [{ type: "circle_named", circle: k.id, name: null, by: null }];
  };
}

/** `disband_circle {circle, by}`, from TOWN_ACTOR for staff: it's gone. Nobody waits after it. */
export function checkDisbandCircle(
  state: WorldState,
  command: Extract<Command, { type: "disband_circle" }>,
): CirclesChecked {
  const k = named(state, command.circle);
  if (isRejection(k)) return k;
  if (typeof command.by !== "string" || command.by === "") {
    return refuse("server_only", "Say which of the staff disbanded it.");
  }
  return () => disband(state, k, "staff");
}

/**
 * At `new_day`: a circle still forming `formDays` after its founding is disbanded, an invite
 * lapses `inviteDays` after it was sent, and a wait that's over is forgotten. Null when none of
 * that happens.
 */
export function circlesNewDay(state: WorldState, day: number): Mutation | null {
  const circles = state.circles;
  if (!circles) return null;
  const list = Object.values(circles.list);
  const unformed = list.filter(
    (k) => k.status === "forming" && day - k.foundedDay >= CIRCLES.formDays,
  );
  const lapsed = list
    .filter((k) => !unformed.includes(k))
    .flatMap((k) =>
      Object.entries(k.invites ?? {})
        .filter(([, invite]) => day - invite.day >= CIRCLES.inviteDays)
        .map(([id]) => ({ k, id })),
    );
  const over = Object.entries(circles.leftDay ?? {}).filter(
    ([, left]) => day - left >= CIRCLES.waitDays,
  );
  if (unformed.length === 0 && lapsed.length === 0 && over.length === 0) return null;
  return () => {
    const events: WorldEvent[] = [];
    for (const k of unformed) events.push(...disband(state, k, "unformed"));
    for (const { k, id } of lapsed) {
      dropInvite(k, id);
      events.push({ type: "circle_uninvited", circle: k.id, residentId: id, how: "lapsed" });
    }
    if (over.length > 0) {
      const leftDay = { ...circles.leftDay };
      for (const [id] of over) delete leftDay[id];
      if (Object.keys(leftDay).length > 0) circles.leftDay = leftDay;
      else delete circles.leftDay;
    }
    return events;
  };
}

/**
 * What `merge_resident` does to circles: `from`'s nights join `into`'s, its invites and its wait
 * are dropped, and a hall that was its plot is cleared (its plots are released). Its membership
 * goes to `into`, in its place and with its standing, unless `into` is in a circle already or
 * there's no room for `into`'s household: then it ends, as a leave without the wait.
 */
export function mergeCircles(state: WorldState, from: ResidentId, into: ResidentId): WorldEvent[] {
  const circles = state.circles;
  if (!circles) return [];
  const events: WorldEvent[] = [];
  const theirs = own(circles.nights, from);
  if (circles.nights && theirs !== undefined) {
    delete circles.nights[from];
    const nights = (own(circles.nights, into) ?? 0) + theirs;
    circles.nights[into] = nights;
    events.push({ type: "circle_nights", residentId: into, nights });
  }
  if (circles.leftDay && Object.hasOwn(circles.leftDay, from)) {
    delete circles.leftDay[from];
    if (Object.keys(circles.leftDay).length === 0) delete circles.leftDay;
  }
  for (const k of Object.values(circles.list)) {
    if (k.invites && Object.hasOwn(k.invites, from)) {
      dropInvite(k, from);
      events.push({ type: "circle_uninvited", circle: k.id, residentId: from, how: "merged" });
    }
    if (k.hall?.by === from) events.push(...clearHall(state, k));
  }
  const k = circleOf(state, from);
  if (!k) return events;
  const stays =
    circleOf(state, into) === undefined &&
    Object.keys(k.members).filter((m) => m !== from && sameHousehold(state, m, into)).length <
      CIRCLES.perHousehold;
  if (!stays) return [...events, ...removeMember(state, k, from, "merged")];
  const place = k.members[from] as Circle["members"][string];
  delete k.members[from];
  k.members[into] = place;
  events.push(
    { type: "circle_left", circle: k.id, residentId: from, how: "merged" },
    { type: "circle_joined", circle: k.id, residentId: into },
  );
  if (isSteward(k, from)) {
    k.stewards = k.stewards.map((s) => (s === from ? into : s));
    events.push({ type: "circle_steward", circle: k.id, residentId: into, steward: true });
  }
  events.push(...closeInvitesOf(state, into));
  return events;
}
