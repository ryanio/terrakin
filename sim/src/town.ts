import { townMoneyOnPass, townMoneyProblem } from "./bounties";
import { refuse } from "./check";
import { tileKey } from "./keys";
import { own } from "./own";
import type {
  Command,
  PlannedBlock,
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
import { BUILDING_BLOCKS, PROPOSAL_KINDS, SERVER_COMMANDS, VOTE_CHOICES } from "./types";
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
  /** Blocks one `commons_build` may place or take away, together. */
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
  {
    type:
      | "new_day"
      | "set_townsfolk"
      | "close_proposal"
      | "void_proposal"
      | "propose"
      | "vote"
      | "withdraw";
  }
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

/** Check a `commons_build` plan against the Commons as it is now. Returns an error message or null. */
function checkPlan(state: WorldState, blocks: PlannedBlock[], remove: Tile[]): string | null {
  const { config } = state;
  const total = blocks.length + remove.length;
  if (total < 1) return "A build needs at least one block to place or take away.";
  if (total > TOWN_LIMITS.buildMax) {
    return `A build can place or take away at most ${TOWN_LIMITS.buildMax} blocks.`;
  }
  const commons = commonsPlot(config);
  const standing = new Set(
    Object.values(state.residents)
      .filter((r) => r.online)
      .map((r) => tileKey(r.x, r.y)),
  );
  const seen = new Set<string>();
  for (const t of [...blocks, ...remove]) {
    if (!isWhole(t.x) || !isWhole(t.y) || !inBounds(config, t.x, t.y)) {
      return "Every tile must be inside the world.";
    }
    const p = plotOf(config, t.x, t.y);
    if (p.px !== commons.px || p.py !== commons.py) {
      return `(${t.x}, ${t.y}) isn't in the Commons. Builds only go in the Commons.`;
    }
    if (isTownHallTile(config, t.x, t.y)) {
      return `(${t.x}, ${t.y}) is where the Town Hall stands. Keep it clear.`;
    }
    const key = tileKey(t.x, t.y);
    if (seen.has(key)) return `(${t.x}, ${t.y}) is in the plan twice.`;
    seen.add(key);
  }
  for (const b of blocks) {
    // Only once the shop is open, so builds from before it replay as they did. Taking away a block
    // that was already there stays allowed, so the town can clear the shop's ground.
    if (state.shop && isShopTile(config, b.x, b.y)) {
      return `(${b.x}, ${b.y}) is where the town shop stands. Keep it clear.`;
    }
    if (!(BUILDING_BLOCKS as readonly string[]).includes(b.block)) {
      return `(${b.x}, ${b.y}) needs wood, stone, glass, or leaf. Builds in the Commons use those.`;
    }
    const key = tileKey(b.x, b.y);
    if (state.blocks[key] !== undefined) return `(${b.x}, ${b.y}) already has a block.`;
    if (standing.has(key)) return `Someone is standing on (${b.x}, ${b.y}).`;
  }
  for (const t of remove) {
    if (state.blocks[tileKey(t.x, t.y)] === undefined) {
      return `(${t.x}, ${t.y}) has no block to take away.`;
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
      const build = status === "passed" && p.kind === "commons_build" ? planBuild(state, p) : null;
      const money = status === "passed" ? townMoneyOnPass(state, p, day) : null;
      const opens = nextToOpen(state, p);
      return () => {
        const events: WorldEvent[] = [finish(p, status, day)];
        if (money) events.push(...money());
        if (build) {
          const town = ensureTown(state);
          for (const t of build.removed) {
            const key = tileKey(t.x, t.y);
            delete state.blocks[key];
            delete town.built[key];
            events.push({ type: "block_removed", x: t.x, y: t.y, by: p.id });
          }
          for (const b of build.placed) {
            const key = tileKey(b.x, b.y);
            state.blocks[key] = b.block;
            town.built[key] = p.id;
            events.push({ type: "block_placed", x: b.x, y: b.y, block: b.block, by: p.id });
          }
          events.push({ type: "town_built", proposal: p.id, ...build });
        }
        for (const o of opens) events.push(open(o.p, day, o.voters));
        return events;
      };
    }

    case "propose": {
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
      const blocks = command.blocks ?? [];
      const remove = command.remove ?? [];
      if (!Array.isArray(blocks) || !Array.isArray(remove)) {
        return refuse("invalid_proposal", "Blocks and removals are lists of tiles.");
      }
      if (command.kind !== "commons_build" && blocks.length + remove.length > 0) {
        return refuse("invalid_proposal", `A ${command.kind} has no blocks. Use commons_build.`);
      }
      if (command.kind === "commons_build") {
        const problem = checkPlan(state, blocks, remove);
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
        (state.town?.proposals.filter((p) => p.status === "open").length ?? 0) <
        TOWN_LIMITS.openMax;
      const voters = openNow ? electorate(state) : [];
      const plan =
        command.kind === "commons_build"
          ? {
              ...(blocks.length > 0
                ? { blocks: blocks.map(({ x, y, block }) => ({ x, y, block })) }
                : {}),
              ...(remove.length > 0 ? { remove: remove.map(({ x, y }) => ({ x, y })) } : {}),
            }
          : money
            ? {
                amount: command.amount as number,
                ...(command.kind === "grant" ? { to: command.to as ResidentId } : {}),
              }
            : {};
      return () => {
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
 * What a passed build does to the Commons as it is now: each block goes in unless its tile has a
 * block, a hearth, or an online resident on it by then, and each removal happens if the block is
 * still there. Skipped tiles are listed so the event says what didn't happen.
 */
function planBuild(
  state: WorldState,
  p: Proposal,
): { placed: PlannedBlock[]; removed: Tile[]; skipped: Tile[] } {
  const taken = new Set<string>();
  for (const r of Object.values(state.residents)) {
    if (r.online) taken.add(tileKey(r.x, r.y));
    if (r.hearth) taken.add(tileKey(r.hearth.x, r.hearth.y));
  }
  const placed: PlannedBlock[] = [];
  const removed: Tile[] = [];
  const skipped: Tile[] = [];
  for (const t of p.remove ?? []) {
    if (state.blocks[tileKey(t.x, t.y)] !== undefined) removed.push({ x: t.x, y: t.y });
    else skipped.push({ x: t.x, y: t.y });
  }
  for (const b of p.blocks ?? []) {
    const key = tileKey(b.x, b.y);
    const free = state.blocks[key] === undefined && !taken.has(key);
    const shop = state.shop !== undefined && isShopTile(state.config, b.x, b.y);
    if (free && !shop && !isTownHallTile(state.config, b.x, b.y)) placed.push({ ...b });
    else skipped.push({ x: b.x, y: b.y });
  }
  return { placed, removed, skipped };
}
