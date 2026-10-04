import { fnv1a } from "./hash";
import { plotKey, tileKey } from "./keys";
import type {
  ApplyResult,
  Command,
  Direction,
  Input,
  ProfileFields,
  Rejection,
  RejectionCode,
  Resident,
  WorldEvent,
  WorldState,
} from "./types";
import { RESIDENT_COLORS, RESIDENT_SHAPES } from "./types";
import {
  chebyshev,
  inBounds,
  isCommons,
  isSolid,
  plotAtTile,
  plotOf,
  plotsOwnedBy,
  spawnTile,
} from "./world";

export const NAME_MAX_LENGTH = 24;
export const NOTE_MAX_LENGTH = 80;

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
  const mutate = check(state, input.actor, input.command);
  if (typeof mutate !== "function") return mutate;
  let done = false;
  return {
    ok: true,
    commit: () => {
      if (done) throw new Error("Prepared input committed twice");
      done = true;
      const events = mutate();
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

function check(state: WorldState, actor: string, command: Command): Mutation | Prepared {
  const { config } = state;
  const me = state.residents[actor];

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
        state.plots[plotKey(px, py)] = { px, py, ownerId: actor };
        return [{ type: "plot_claimed", px, py, ownerId: actor }];
      };
    }

    case "set_hearth": {
      const { x, y } = command;
      if (!inBounds(config, x, y)) return reject("out_of_bounds", "That's outside the world.");
      if (chebyshev(me, { x, y }) > config.reach) {
        return reject("out_of_reach", `You can only build within ${config.reach} tiles.`);
      }
      if (plotAtTile(state, x, y)?.ownerId !== actor) {
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
      if (plotAtTile(state, x, y)?.ownerId !== actor) {
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
  }
}
