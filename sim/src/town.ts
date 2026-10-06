import { townMoneyOnPass, townMoneyProblem } from "./bounties";
import type { BuildPlan } from "./build";
import { refuse } from "./check";
import { GROUND_INFO, GROUND_KINDS, isGroundKind } from "./ground";
import { tileKey } from "./keys";
import { own } from "./own";
import type {
  BlockKind,
  Command,
  PlannedBlock,
  PlannedGround,
  Proposal,
  ProposalStatus,
  Rejection,
  ResidentId,
  Tile,
  TownState,
  VoteChoice,
  WorldEvent,
  WorldState,
} from "./types";
import { COMMONS_BLOCKS, PROPOSAL_KINDS, SERVER_COMMANDS, VOTE_CHOICES } from "./types";
import { commonsPlot, inBounds, isShopTile, isTownHallTile, plotOf } from "./world";

/**
 * The Town Hall (RFC 0004): who may take part, proposals, votes, closes, and Commons builds.
 *
 * Time comes in as logged inputs. The server appends `new_day {day}` once per UTC day, and
 * `close_proposal {proposal}` once a proposal's closing day has started. The sim never reads a
 * clock, so a log replays to the same town every time.
 */

export const TOWN_LIMITS = {
  /** Proposal titles, in characters. */
  titleMax: 80,
  /** Proposal texts, in characters. */
  textMax: 1_000,
  /**
   * Changes one `commons_build` may make: blocks placed and taken away and paths laid and lifted,
   * together (decision 0101).
   */
  buildMax: 40,
  /** Proposals open at once. More wait in a queue. */
  openMax: 5,
  /** A proposal closes when the day this many days after it opened starts (midnight UTC). */
  openDays: 2,
  /** One new proposal per resident per this many days. */
  cooldownDays: 7,
  /** You must have acted in the world within this many days to take part. */
  activeWithinDays: 7,
  /** Quorum is at least this many yes plus no votes... */
  quorumMin: 3,
  /** ...or this percent of the electorate, rounded up, whichever is more. */
  quorumPercent: 10,
  /** Default for `WorldConfig.townEligibleAfterDays`. */
  eligibleAfterDays: 3,
} as const;

/** Yes plus no votes a proposal needs, given how many could vote. */
export function quorum(electorate: number): number {
  return Math.max(TOWN_LIMITS.quorumMin, Math.ceil((electorate * TOWN_LIMITS.quorumPercent) / 100));
}

export interface Tally {
  yes: number;
  no: number;
  abstain: number;
}

export function tally(proposal: Proposal): Tally {
  const t: Tally = { yes: 0, no: 0, abstain: 0 };
  for (const choice of Object.values(proposal.votes)) t[choice]++;
  return t;
}

/** Why someone can't take part. Stable strings: the API passes them on. */
export const INELIGIBLE_REASONS = [
  "no_days_yet",
  "townsfolk",
  "not_resident",
  "no_plot",
  "plot_too_new",
  "no_hearth",
  "inactive",
] as const;
export type IneligibleReason = (typeof INELIGIBLE_REASONS)[number];

export type Eligibility =
  | { eligible: true }
  | { eligible: false; reason: IneligibleReason; message: string };

const no = (reason: IneligibleReason, message: string): Eligibility => ({
  eligible: false,
  reason,
  message,
});

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/**
 * Whether a resident may propose and vote right now: they hold a plot (owned or shared) for at
 * least `townEligibleAfterDays` days, have a hearth, acted in the world in the last 7 days, and
 * aren't townsfolk. Plots and shares from before the world counted days count as day 0.
 */
export function townEligibility(state: WorldState, id: ResidentId): Eligibility {
  const { day } = state;
  if (day === undefined) {
    return no("no_days_yet", "The Town Hall opens once the world starts counting days.");
  }
  if (state.townsfolk?.includes(id)) {
    return no("townsfolk", "Townsfolk run by the Terrakin team don't propose or vote.");
  }
  const me = state.residents[id];
  if (!me) return no("not_resident", "Join the world first.");
  let since: number | undefined;
  for (const plot of Object.values(state.plots)) {
    let held: number | undefined;
    if (plot.ownerId === id) held = plot.claimedDay ?? 0;
    else if (plot.coOwners?.includes(id)) held = plot.sharedDay?.[id] ?? plot.claimedDay ?? 0;
    if (held !== undefined && (since === undefined || held < since)) since = held;
  }
  if (since === undefined) {
    return no("no_plot", "You need a plot of your own, or one shared with you. Try settle.");
  }
  const after = state.config.townEligibleAfterDays ?? TOWN_LIMITS.eligibleAfterDays;
  const wait = since + after - day;
  if (wait > 0) {
    return no(
      "plot_too_new",
      `Your plot needs to be ${days(after)} old before you can take part. That's ${days(wait)} from now.`,
    );
  }
  if (!me.hearth) return no("no_hearth", "Set a hearth on your plot first.");
  const last = state.lastActiveDay?.[id];
  if (last === undefined || day - last >= TOWN_LIMITS.activeWithinDays) {
    return no(
      "inactive",
      `Do something in the world first (walk, build, anything). The Town Hall is for residents active in the last ${TOWN_LIMITS.activeWithinDays} days.`,
    );
  }
  return { eligible: true };
}

/** Everyone who may take part right now, sorted. A proposal keeps this list from when it opens. */
export function electorate(state: WorldState): ResidentId[] {
  return Object.keys(state.residents)
    .filter((id) => townEligibility(state, id).eligible)
    .sort();
}

/** How many proposals a resident has voted on. */
export function votesCast(state: WorldState, id: ResidentId): number {
  return state.town?.proposals.filter((p) => own(p.votes, id) !== undefined).length ?? 0;
}

export function findProposal(state: WorldState, id: string): Proposal | undefined {
  return state.town?.proposals.find((p) => p.id === id);
}

/**
 * Whether a resident's command counts as acting in the world, for eligibility. Joining and leaving
 * don't: any API call or open socket brings a resident online without them doing anything.
 */
export function isActivity(command: Command): boolean {
  return command.type !== "join" && command.type !== "leave" && !isServerCommand(command);
}

// ---------- checks ----------

type TownMutation = () => WorldEvent[];
export type TownChecked = TownMutation | Rejection;

type ServerCommand = Extract<Command, { type: (typeof SERVER_COMMANDS)[number] }>;
type TownCommand = Extract<
  Command,
  { type: "new_day" | "set_townsfolk" | "close_proposal" | "void_proposal" | "vote" | "withdraw" }
>;

export function isServerCommand(command: Command): command is ServerCommand {
  return (SERVER_COMMANDS as readonly string[]).includes(command.type);
}

/**
 * Proposals that open when slots free up: the oldest queued ones, each with the electorate as it
 * stands now. `closing` is the proposal leaving the open list in the same input, if any.
 */
function nextToOpen(
  state: WorldState,
  closing?: Proposal,
): { p: Proposal; voters: ResidentId[] }[] {
  const town = state.town;
  if (!town) return [];
  const open = town.proposals.filter((p) => p.status === "open" && p !== closing).length;
  const free = TOWN_LIMITS.openMax - open;
  if (free <= 0) return [];
  const voters = electorate(state);
  return town.proposals
    .filter((p) => p.status === "queued" && p !== closing)
    .slice(0, free)
    .map((p) => ({ p, voters }));
}

function open(p: Proposal, day: number, voters: ResidentId[]): WorldEvent {
  p.status = "open";
  p.openedDay = day;
  p.closesDay = day + TOWN_LIMITS.openDays;
  p.electorate = [...voters];
  return {
    type: "proposal_opened",
    proposal: p.id,
    author: p.author,
    kind: p.kind,
    closesDay: p.closesDay,
    electorate: voters.length,
    quorum: quorum(voters.length),
  };
}

function finish(p: Proposal, status: ProposalStatus, day: number): WorldEvent {
  p.status = status;
  p.closedDay = day;
  return { type: "proposal_closed", proposal: p.id, status, ...tally(p) };
}

const isWhole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/** A `commons_build`'s plan: the four lists `build` takes, at world tiles in the Commons. */
interface CommonsPlan {
  blocks: readonly PlannedBlock[];
  remove: readonly Tile[];
  ground: readonly PlannedGround[];
  lift: readonly Tile[];
}

/** A proposal's plan, with an empty list for each it doesn't carry. */
const planOf = (p: Pick<Proposal, "blocks" | "remove" | "ground" | "lift">): CommonsPlan => ({
  blocks: p.blocks ?? [],
  remove: p.remove ?? [],
  ground: p.ground ?? [],
  lift: p.lift ?? [],
});

/**
 * Check a `commons_build` plan against the Commons as it is now (decision 0101). Returns an error
 * message or null. Every tile is a world tile in the Commons, off the Town Hall, and in each list
 * at most once, so a tile in `remove` and `blocks` swaps its block, and one in `lift` and `ground`
 * its path. A block never goes where someone stands; a path goes under them, as it does anywhere.
 */
function checkPlan(state: WorldState, plan: CommonsPlan): string | null {
  const { config } = state;
  const { blocks, remove, ground, lift } = plan;
  const total = blocks.length + remove.length + ground.length + lift.length;
  if (total < 1) return "A build needs at least one block or path to place, lay, or take away.";
  if (total > TOWN_LIMITS.buildMax) {
    return `A build can make at most ${TOWN_LIMITS.buildMax} changes: blocks placed and taken away and paths laid and lifted, together.`;
  }
  const commons = commonsPlot(config);
  const lists: [string, readonly unknown[]][] = [
    ["blocks", blocks],
    ["remove", remove],
    ["ground", ground],
    ["lift", lift],
  ];
  for (const [name, list] of lists) {
    const seen = new Set<string>();
    for (const t of list) {
      const { x, y } = (typeof t === "object" && t !== null ? t : {}) as Partial<Tile>;
      if (!isWhole(x) || !isWhole(y) || !inBounds(config, x, y)) {
        return "Every tile must be inside the world.";
      }
      const p = plotOf(config, x, y);
      if (p.px !== commons.px || p.py !== commons.py) {
        return `(${x}, ${y}) isn't in the Commons. Builds only go in the Commons.`;
      }
      if (isTownHallTile(config, x, y)) {
        return `(${x}, ${y}) is where the Town Hall stands. Keep it clear.`;
      }
      const key = tileKey(x, y);
      if (seen.has(key)) return `(${x}, ${y}) is in ${name} twice.`;
      seen.add(key);
    }
  }
  const standing = new Set(
    Object.values(state.residents)
      .filter((r) => r.online)
      .map((r) => tileKey(r.x, r.y)),
  );
  const removing = new Set(remove.map((t) => tileKey(t.x, t.y)));
  const lifting = new Set(lift.map((t) => tileKey(t.x, t.y)));
  // Only once the shop is open, so builds from before it replay as they did. Taking away a block or
  // lifting a path that was already there stays allowed, so the town can clear the shop's ground.
  const onShop = (t: Tile) =>
    state.shop && isShopTile(config, t.x, t.y)
      ? `(${t.x}, ${t.y}) is where the town shop stands. Keep it clear.`
      : null;
  for (const b of blocks) {
    const shop = onShop(b);
    if (shop) return shop;
    if (!(COMMONS_BLOCKS as readonly unknown[]).includes(b.block)) {
      return `(${b.x}, ${b.y}) needs a block the town builds with: wood, stone, glass, or leaf, or decor or furniture like a bench, a lamp post, or a well. Stations and planters go on residents' own plots.`;
    }
    const key = tileKey(b.x, b.y);
    if (state.blocks[key] !== undefined && !removing.has(key)) {
      return `(${b.x}, ${b.y}) already has a block. Take it away in the same plan with remove.`;
    }
    if (standing.has(key)) return `Someone is standing on (${b.x}, ${b.y}).`;
  }
  for (const g of ground) {
    const shop = onShop(g);
    if (shop) return shop;
    if (!isGroundKind(g.ground)) {
      return `(${g.x}, ${g.y}) needs a path or floor: ${GROUND_KINDS.join(", ")}.`;
    }
    const there = state.ground?.[tileKey(g.x, g.y)];
    if (there !== undefined && !lifting.has(tileKey(g.x, g.y))) {
      return `(${g.x}, ${g.y}) already has ${GROUND_INFO[there].name.toLowerCase()}. Lift it in the same plan with lift.`;
    }
  }
  for (const t of remove) {
    if (state.blocks[tileKey(t.x, t.y)] === undefined) {
      return `(${t.x}, ${t.y}) has no block to take away.`;
    }
  }
  for (const t of lift) {
    if (state.ground?.[tileKey(t.x, t.y)] === undefined) {
      return `(${t.x}, ${t.y}) has no path or floor to lift.`;
    }
  }
  return null;
}

function ensureTown(state: WorldState): TownState {
  state.town ??= { nextId: 1, proposals: [], built: {} };
  return state.town;
}

/** Check one Town Hall command. A function to commit it, or why not. */
export function checkTown(state: WorldState, actor: string, command: TownCommand): TownChecked {
  switch (command.type) {
    case "new_day": {
      const { day } = command;
      if (!isWhole(day) || day < 0) return refuse("not_due", "A day is a whole number.");
      if (state.day !== undefined && day <= state.day) {
        return refuse("not_due", "That day has already started.");
      }
      return () => {
        state.day = day;
        return [{ type: "day_started", day }];
      };
    }

    case "set_townsfolk": {
      if (!Array.isArray(command.ids) || command.ids.some((id) => typeof id !== "string")) {
        return refuse("server_only", "Townsfolk are a list of resident ids.");
      }
      const ids = [...new Set(command.ids)].sort();
      return () => {
        if (ids.length > 0) state.townsfolk = ids;
        else delete state.townsfolk;
        return [{ type: "townsfolk_set", ids: [...ids] }];
      };
    }

    case "close_proposal":
    case "void_proposal": {
      const p = findProposal(state, command.proposal);
      if (!p) return refuse("unknown_proposal", "No proposal has that id.");
      const day = state.day ?? 0;
      if (command.type === "void_proposal") {
        if (p.status !== "open" && p.status !== "queued") {
          return refuse("proposal_not_open", "That proposal has already closed.");
        }
        const by = command.by;
        if (typeof by !== "string" || by === "") {
          return refuse("server_only", "Say which maintainer voided it.");
        }
        const opens = p.status === "open" ? nextToOpen(state, p) : [];
        return () => {
          p.voidedBy = by;
          const events = [finish(p, "voided", day)];
          for (const o of opens) events.push(open(o.p, day, o.voters));
          return events;
        };
      }
      if (p.status !== "open") return refuse("proposal_not_open", "That proposal isn't open.");
      if (p.closesDay === undefined || day < p.closesDay) {
        return refuse("not_due", "That proposal isn't due to close yet.");
      }
      const t = tally(p);
      const voters = p.electorate?.length ?? 0;
      const status: ProposalStatus =
        t.yes + t.no < quorum(voters) ? "no_quorum" : t.yes > t.no ? "passed" : "failed";
      const build =
        status === "passed" && p.kind === "commons_build" ? closeBuild(state, planOf(p)) : null;
      const money = status === "passed" ? townMoneyOnPass(state, p, day) : null;
      const opens = nextToOpen(state, p);
      return () => {
        const events: WorldEvent[] = [finish(p, status, day)];
        if (money) events.push(...money());
        if (build) events.push(...commitCommonsBuild(state, p.id, build));
        for (const o of opens) events.push(open(o.p, day, o.voters));
        return events;
      };
    }

    case "vote": {
      const p = findProposal(state, command.proposal);
      if (!p) return refuse("unknown_proposal", "No proposal has that id.");
      if (p.status !== "open") {
        return refuse(
          "proposal_not_open",
          p.status === "queued"
            ? "That proposal is still waiting in the queue. Vote once it opens."
            : "Voting on that proposal has closed.",
        );
      }
      if (!VOTE_CHOICES.includes(command.choice)) {
        return refuse("invalid_proposal", "Vote yes, no, or abstain.");
      }
      if (state.townsfolk?.includes(actor)) {
        return refuse("not_eligible", "Townsfolk run by the Terrakin team don't propose or vote.");
      }
      if (!p.electorate?.includes(actor)) {
        return refuse(
          "not_eligible",
          "Only residents who could take part when this proposal opened can vote on it.",
        );
      }
      const choice: VoteChoice = command.choice;
      if (p.votes[actor] === choice) return refuse("already_voted", `You already voted ${choice}.`);
      return () => {
        p.votes[actor] = choice;
        return [{ type: "vote_cast", proposal: p.id, residentId: actor, choice, ...tally(p) }];
      };
    }

    case "withdraw": {
      const p = findProposal(state, command.proposal);
      if (!p) return refuse("unknown_proposal", "No proposal has that id.");
      if (p.author !== actor) {
        return refuse("not_your_proposal", "Only the resident who proposed it can withdraw it.");
      }
      if (p.status !== "open" && p.status !== "queued") {
        return refuse("proposal_not_open", "That proposal has already closed.");
      }
      const day = state.day ?? 0;
      const opens = p.status === "open" ? nextToOpen(state, p) : [];
      return () => {
        const events = [finish(p, "withdrawn", day)];
        for (const o of opens) events.push(open(o.p, day, o.voters));
        return events;
      };
    }
  }
}

/**
 * `propose`: the change that files it, or why not. A `commons_build` also hands back its plan in
 * the shape `build` answers with: what it would build in the Commons if it passed now (the filing
 * checks leave nothing to skip), so a dry proposal previews it and nothing is ever taken from
 * anyone's things (decision 0101).
 */
export function checkPropose(
  state: WorldState,
  actor: string,
  command: Extract<Command, { type: "propose" }>,
): { commit: TownMutation; plan?: BuildPlan } | Rejection {
  const day = state.day;
  const ok = townEligibility(state, actor);
  if (!ok.eligible || day === undefined) {
    return refuse("not_eligible", ok.eligible ? "The Town Hall isn't open yet." : ok.message);
  }
  if (!PROPOSAL_KINDS.includes(command.kind)) {
    return refuse(
      "invalid_proposal",
      "A proposal is an advisory, a commons_build, a grant, or a bounty.",
    );
  }
  const title = typeof command.title === "string" ? command.title.trim() : "";
  const text = typeof command.text === "string" ? command.text.trim() : "";
  if (title.length < 1 || title.length > TOWN_LIMITS.titleMax) {
    return refuse("invalid_proposal", `Titles are 1 to ${TOWN_LIMITS.titleMax} characters.`);
  }
  if (text.length > TOWN_LIMITS.textMax) {
    return refuse("invalid_proposal", `Texts are at most ${TOWN_LIMITS.textMax} characters.`);
  }
  const lists = planOf(command);
  if (!Object.values(lists).every((list) => Array.isArray(list))) {
    return refuse("invalid_proposal", "Blocks, ground, removals, and lifts are lists of tiles.");
  }
  const { blocks, remove, ground, lift } = lists;
  const changes = blocks.length + remove.length + ground.length + lift.length;
  if (command.kind !== "commons_build" && changes > 0) {
    return refuse(
      "invalid_proposal",
      `A ${command.kind} has no blocks or paths. Use commons_build.`,
    );
  }
  if (command.kind === "commons_build") {
    const problem = checkPlan(state, lists);
    if (problem) return refuse("invalid_proposal", problem);
  }
  const money = command.kind === "grant" || command.kind === "bounty";
  if (money) {
    const problem = townMoneyProblem(state, actor, command);
    if (problem) return refuse("invalid_proposal", problem);
  } else if (command.amount !== undefined || command.to !== undefined) {
    return refuse("invalid_proposal", "Only a grant or a bounty pays coins.");
  }
  const mine = state.town?.proposals.filter((p) => p.author === actor) ?? [];
  if (mine.some((p) => p.status === "open" || p.status === "queued")) {
    return refuse(
      "proposal_limit",
      "You already have a proposal open or waiting. Let it close, or withdraw it first.",
    );
  }
  const last = mine.at(-1);
  if (last && day - last.filedDay < TOWN_LIMITS.cooldownDays) {
    const wait = last.filedDay + TOWN_LIMITS.cooldownDays - day;
    return refuse(
      "proposal_limit",
      `One new proposal a week. You can propose again in ${days(wait)}.`,
    );
  }
  const openNow =
    (state.town?.proposals.filter((p) => p.status === "open").length ?? 0) < TOWN_LIMITS.openMax;
  const voters = openNow ? electorate(state) : [];
  // A build keeps only the lists it has, so proposals that lay no paths hash as they always have.
  const plan =
    command.kind === "commons_build"
      ? {
          ...(blocks.length > 0
            ? { blocks: blocks.map(({ x, y, block }) => ({ x, y, block })) }
            : {}),
          ...(remove.length > 0 ? { remove: remove.map(({ x, y }) => ({ x, y })) } : {}),
          ...(ground.length > 0
            ? { ground: ground.map(({ x, y, ground }) => ({ x, y, ground })) }
            : {}),
          ...(lift.length > 0 ? { lift: lift.map(({ x, y }) => ({ x, y })) } : {}),
        }
      : money
        ? {
            amount: command.amount as number,
            ...(command.kind === "grant" ? { to: command.to as ResidentId } : {}),
          }
        : {};
  const commit: TownMutation = () => {
    const town = ensureTown(state);
    const p: Proposal = {
      id: `t_${town.nextId}`,
      author: actor,
      kind: command.kind,
      title,
      text,
      ...plan,
      status: "queued",
      filedDay: day,
      votes: {},
    };
    town.nextId += 1;
    town.proposals.push(p);
    if (openNow) return [open(p, day, voters)];
    return [{ type: "proposal_queued", proposal: p.id, author: actor, kind: p.kind }];
  };
  if (command.kind !== "commons_build") return { commit };
  const now = closeBuild(state, lists);
  const { px, py } = commonsPlot(state.config);
  return {
    commit,
    plan: {
      px,
      py,
      removed: now.removed,
      lifted: now.lifted,
      placed: now.placed,
      laid: now.laid,
      changes: [],
      skipped: [],
    },
  };
}

/** What a passed build does, or would do now: world tiles. */
interface CommonsBuilt {
  placed: PlannedBlock[];
  removed: Tile[];
  laid: PlannedGround[];
  lifted: Tile[];
  /** Where part of the plan didn't happen, a tile once for each part. */
  skipped: Tile[];
}

/**
 * What a passed build does to the Commons as it is now, in `build`'s order: removals, lifts,
 * blocks, then paths, each as filed. A removal or a lift happens if something is still there. A
 * block goes in unless its tile has a block by then (after the removals), a hearth, or an online
 * resident on it, or is the Town Hall's or the open shop's. A path goes in unless its tile has one
 * by then (after the lifts), or is the hall's or the open shop's; it goes under anyone standing
 * there. Skipped tiles are listed so the event says what didn't happen. Reads only.
 */
function closeBuild(state: WorldState, plan: CommonsPlan): CommonsBuilt {
  const { config } = state;
  const taken = new Set<string>();
  for (const r of Object.values(state.residents)) {
    if (r.online) taken.add(tileKey(r.x, r.y));
    if (r.hearth) taken.add(tileKey(r.hearth.x, r.hearth.y));
  }
  // What the build changed so far, over what the world has.
  const blocksNow = new Map<string, BlockKind | undefined>();
  const groundNow = new Map<string, PlannedGround["ground"] | undefined>();
  const blockAt = (key: string) => (blocksNow.has(key) ? blocksNow.get(key) : state.blocks[key]);
  const groundAt = (key: string) => (groundNow.has(key) ? groundNow.get(key) : state.ground?.[key]);
  const building = (t: Tile) =>
    isTownHallTile(config, t.x, t.y) || (state.shop !== undefined && isShopTile(config, t.x, t.y));
  const built: CommonsBuilt = { placed: [], removed: [], laid: [], lifted: [], skipped: [] };
  const skip = (t: Tile) => built.skipped.push({ x: t.x, y: t.y });
  for (const t of plan.remove) {
    const key = tileKey(t.x, t.y);
    if (blockAt(key) === undefined) skip(t);
    else {
      built.removed.push({ x: t.x, y: t.y });
      blocksNow.set(key, undefined);
    }
  }
  for (const t of plan.lift) {
    const key = tileKey(t.x, t.y);
    if (groundAt(key) === undefined) skip(t);
    else {
      built.lifted.push({ x: t.x, y: t.y });
      groundNow.set(key, undefined);
    }
  }
  for (const b of plan.blocks) {
    const key = tileKey(b.x, b.y);
    if (blockAt(key) !== undefined || taken.has(key) || building(b)) skip(b);
    else {
      built.placed.push({ ...b });
      blocksNow.set(key, b.block);
    }
  }
  for (const g of plan.ground) {
    const key = tileKey(g.x, g.y);
    if (groundAt(key) !== undefined || building(g)) skip(g);
    else {
      built.laid.push({ ...g });
      groundNow.set(key, g.ground);
    }
  }
  return built;
}

/**
 * Make a passed build's changes, credited to the proposal: the events single actions make, then
 * `town_built`. The town's blocks and paths come from nobody's things and go back to nobody, and
 * `town.built` marks the blocks it put up. `laid` and `lifted` are on `town_built` only when there
 * are some, so a build that lays no paths sends the event it always did.
 */
function commitCommonsBuild(
  state: WorldState,
  proposal: string,
  build: CommonsBuilt,
): WorldEvent[] {
  const town = ensureTown(state);
  const events: WorldEvent[] = [];
  for (const t of build.removed) {
    const key = tileKey(t.x, t.y);
    delete state.blocks[key];
    delete town.built[key];
    events.push({ type: "block_removed", x: t.x, y: t.y, by: proposal });
  }
  for (const t of build.lifted) {
    delete state.ground?.[tileKey(t.x, t.y)];
    events.push({ type: "ground_lifted", x: t.x, y: t.y, by: proposal });
  }
  for (const b of build.placed) {
    const key = tileKey(b.x, b.y);
    state.blocks[key] = b.block;
    town.built[key] = proposal;
    events.push({ type: "block_placed", x: b.x, y: b.y, block: b.block, by: proposal });
  }
  if (build.laid.length > 0) {
    state.ground ??= {};
    for (const g of build.laid) {
      state.ground[tileKey(g.x, g.y)] = g.ground;
      events.push({ type: "ground_laid", x: g.x, y: g.y, ground: g.ground, by: proposal });
    }
  }
  const { placed, removed, skipped, laid, lifted } = build;
  events.push({
    type: "town_built",
    proposal,
    placed,
    removed,
    skipped,
    ...(laid.length > 0 ? { laid } : {}),
    ...(lifted.length > 0 ? { lifted } : {}),
  });
  return events;
}
