import { fnv1a } from "./hash";
import { plotKey, tileKey } from "./keys";
import { checkTown, isActivity, isServerCommand, type TownChecked } from "./town";
import type {
  ApplyResult,
  Command,
  Direction,
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
import { RESIDENT_COLORS, RESIDENT_SHAPES, TOWN_ACTOR } from "./types";
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
} from "./world";

export const NAME_MAX_LENGTH = 24;
export const NOTE_MAX_LENGTH = 80;
/** How many residents an owner can share one plot with. */
export const MAX_CO_OWNERS = 3;

const STEP: Record<Direction, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

/**
 * A validated input, ready to commit. `commit()` mutates the state it was prepared against,
 * bumps `seq`, and returns the events. Call it at most once, and only if the state hasn't changed
 * since `prepare()`.
 */
export type Prepared =
  | { ok: true; commit: () => { seq: number; events: WorldEvent[] } }
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

/** Validate profile fields and merge them over `base`. Returns a rejection or the merged look. */
function mergeProfile(
  base: Pick<Resident, "color" | "shape" | "note">,
  fields: ProfileFields,
): Pick<Resident, "color" | "shape" | "note"> | Prepared {
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
  return { color: fields.color ?? base.color, shape: fields.shape ?? base.shape, note };
}

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
  const mutate = check(state, actor, command);
  if (typeof mutate !== "function") return mutate;
  let done = false;
  return {
    ok: true,
    commit: () => {
      if (done) throw new Error("Prepared input committed twice");
      done = true;
      const events = mutate();
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

/** A Town Hall check's answer in this file's shape. */
function town(checked: TownChecked): Mutation | Prepared {
  return typeof checked === "function" ? checked : { ok: false, rejection: checked };
}

/** `{ claimedDay }` once the world counts days, else nothing, so older worlds hash as before. */
const stampDay = (state: WorldState) => (state.day === undefined ? {} : { claimedDay: state.day });

function check(state: WorldState, actor: string, command: Command): Mutation | Prepared {
  const { config } = state;
  const me = state.residents[actor];

  // Day changes, the townsfolk list, closes, and voids come from the server itself.
  if (isServerCommand(command)) {
    if (actor !== TOWN_ACTOR) return reject("server_only", "Only the server can do that.");
    return town(checkTown(state, actor, command));
  }

  if (command.type === "join") {
    if (me?.online) return reject("already_joined", "You are already in the world.");
    const name = command.name.trim();
    if (name.length < 1 || name.length > NAME_MAX_LENGTH) {
      return reject("invalid_name", `Names must be 1 to ${NAME_MAX_LENGTH} characters.`);
    }
    // Returning residents keep their spot. If someone built on it while they were away, they go
    // to their hearth, or to the Commons if they have none.
    const keepSpot = me !== undefined && !isSolid(state, me.x, me.y);
    const spawn = me?.hearth ?? spawnTile(config);
    const look = mergeProfile(me ?? { ...defaultLook(actor), note: "" }, command);
    if ("ok" in look) return look;
    const resident: Resident = {
      id: actor,
      name,
      kind: command.kind,
      ...look,
      x: keepSpot ? me.x : spawn.x,
      y: keepSpot ? me.y : spawn.y,
      online: true,
      hearth: me?.hearth ?? null,
    };
    return () => {
      state.residents[actor] = resident;
      return [{ type: "joined", resident: { ...resident } }];
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
      const look = mergeProfile(me, command);
      if ("ok" in look) return look;
      // A no-op would still cost a permanent log line and a broadcast.
      if (look.color === me.color && look.shape === me.shape && look.note === me.note) {
        return reject("invalid_profile", "Nothing to change.");
      }
      return () => {
        Object.assign(me, look);
        return [{ type: "profile_changed", residentId: actor, ...look }];
      };
    }

    case "move": {
      const [dx, dy] = STEP[command.dir];
      const x = me.x + dx;
      const y = me.y + dy;
      if (!inBounds(config, x, y)) return reject("out_of_bounds", "That's the edge of the world.");
      if (isSolid(state, x, y)) return reject("blocked", "A block is in the way.");
      return () => {
        me.x = x;
        me.y = y;
        return [{ type: "moved", residentId: actor, x, y }];
      };
    }

    case "claim": {
      const { px, py } = plotOf(config, me.x, me.y);
      if (isCommons(config, px, py)) {
        return reject("plot_is_commons", "The Commons belongs to everyone.");
      }
      if (state.plots[plotKey(px, py)])
        return reject("plot_owned", "This plot is already claimed.");
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
      // honest change instead of a silent teardown (see decision 0018).
      const { plotSize } = config;
      for (let y = py * plotSize; y < (py + 1) * plotSize; y++) {
        for (let x = px * plotSize; x < (px + 1) * plotSize; x++) {
          if (state.blocks[tileKey(x, y)] !== undefined) {
            return reject("plot_has_blocks", "Remove every block on the plot first.");
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
      return () => {
        const events: WorldEvent[] = [];
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
        return reject("out_of_reach", `You can only build within ${config.reach} tiles.`);
      }
      if (!canBuildOn(plotAtTile(state, x, y), actor)) {
        return reject("not_your_plot", "Your hearth has to be on your own plot.");
      }
      if (isSolid(state, x, y)) return reject("tile_occupied", "A block is there.");
      // Like profile, a no-op would still cost a permanent log line and a broadcast.
      if (me.hearth?.x === x && me.hearth.y === y) {
        return reject("already_home", "That's already your hearth.");
      }
      return () => {
        me.hearth = { x, y };
        return [{ type: "hearth_set", residentId: actor, x, y }];
      };
    }

    case "home": {
      const hearth = me.hearth;
      if (!hearth) return reject("no_hearth", "Set a hearth on your plot first.");
      if (me.x === hearth.x && me.y === hearth.y)
        return reject("already_home", "You're already home.");
      return () => {
        me.x = hearth.x;
        me.y = hearth.y;
        return [{ type: "moved", residentId: actor, x: hearth.x, y: hearth.y }];
      };
    }

    case "place":
    case "remove": {
      const { x, y } = command;
      if (!inBounds(config, x, y)) return reject("out_of_bounds", "That's outside the world.");
      if (chebyshev(me, { x, y }) > config.reach) {
        return reject("out_of_reach", `You can only build within ${config.reach} tiles.`);
      }
      if (!canBuildOn(plotAtTile(state, x, y), actor)) {
        return reject("not_your_plot", "You can only build on your own plot.");
      }
      const key = tileKey(x, y);
      if (command.type === "remove") {
        if (state.blocks[key] === undefined) return reject("no_block", "Nothing to remove there.");
        return () => {
          delete state.blocks[key];
          return [{ type: "block_removed", x, y, by: actor }];
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
      return () => {
        state.blocks[key] = block;
        return [{ type: "block_placed", x, y, block, by: actor }];
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
      if (state.plots[key]) return reject("plot_owned", "This plot is already claimed.");
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

    case "build_starter_home": {
      const plot = workingPlot(state, me, true);
      if (!plot) return reject("no_plot", "You need a plot first. Try settle.");
      const onPlot = (t: Tile) => {
        const p = plotOf(config, t.x, t.y);
        return inBounds(config, t.x, t.y) && p.px === plot.px && p.py === plot.py;
      };
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
        return reject("already_home", "Your starter home is already built.");
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

    case "share_plot":
    case "unshare_plot": {
      const plot = workingPlot(state, me, false);
      if (!plot) {
        return workingPlot(state, me, true)
          ? reject("not_your_plot", "Only a plot's owner can share it.")
          : reject("no_plot", "You need a plot of your own first. Try settle.");
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
        const them = state.residents[target];
        const hearth = them?.hearth;
        const hearthPlot = hearth ? plotOf(config, hearth.x, hearth.y) : null;
        const hearthHere = hearthPlot?.px === px && hearthPlot.py === py;
        return () => {
          const rest = coOwners.filter((id) => id !== target);
          if (rest.length > 0) plot.coOwners = rest;
          else delete plot.coOwners;
          if (plot.sharedDay) {
            delete plot.sharedDay[target];
            if (Object.keys(plot.sharedDay).length === 0) delete plot.sharedDay;
          }
          const events: WorldEvent[] = [{ type: "plot_unshared", px, py, residentId: target }];
          if (them && hearthHere) {
            them.hearth = null;
            events.push({ type: "hearth_cleared", residentId: target });
          }
          return events;
        };
      }
      if (!state.residents[target]) {
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

    case "propose":
    case "vote":
    case "withdraw":
      return town(checkTown(state, actor, command));
  }
}
