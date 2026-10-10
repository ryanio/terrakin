import {
  type ErrorCode,
  MOVE_MAX_STEPS,
  ROUTINE_RULES,
  type RoutineChoice,
  residentLinks,
  type WorldEvent,
} from "@terrakin/protocol";
import {
  CHAT_EARSHOT,
  canBuildOn,
  chebyshev,
  commonsPlot,
  countOf,
  freeRenamesLeft,
  homePlotOf,
  ITEM_INFO,
  ITEMS,
  inventoryOf,
  isCommons,
  isFindKind,
  isTownsfolk,
  lastDeclineDay,
  nearestOpenPickup,
  type Plot,
  pickupLeft,
  pickupsInReach,
  plotKey,
  plotOf,
  plotsOwnedBy,
  purseOf,
  RECIPE_PAGE,
  type Resident,
  rejoined,
  routinesOf,
  standingFloor,
  type WorldState,
  walkLegs,
} from "@terrakin/sim";
import type { Handlers } from "../handlers/shared";
import { gardenOf } from "../items";
import { plural } from "../markdown";
import { shownPlotName } from "../plots";
import { awayLine } from "../routines";
import {
  gatherable,
  homeStep,
  type LinkCtx,
  type Links,
  linkHelp,
  linksFor,
  list,
  PLACEHOLDER,
  placeholderRefusal,
  refuse,
  type Tile,
  turnedDown,
} from "./shared";
import {
  at,
  awayWords,
  plotNamesBlock,
  quote,
  routineWords,
  showHome,
  showPlot,
  showSection,
  stackWords,
  untrusted,
} from "./words";

const DIRECTIONS = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
} as const;

function plotLabel(state: WorldState, viewer: string, x: number, y: number): string {
  const { px, py } = plotOf(state.config, x, y);
  if (isCommons(state.config, px, py))
    return `the Commons, plot (${px}, ${py}), which nobody can claim`;
  const plot = state.plots[plotKey(px, py)];
  if (!plot) return `plot (${px}, ${py}), which is free`;
  if (plot.ownerId === viewer) return `your plot (${px}, ${py})`;
  if (plot.coOwners?.includes(viewer)) return `plot (${px}, ${py}), which is shared with you`;
  return `plot (${px}, ${py}), which belongs to resident \`${plot.ownerId}\``;
}

/** Unclaimed plots, nearest first (in plots), not counting the Commons. */
function freePlotsNear(state: WorldState, x: number, y: number, count: number) {
  const { config } = state;
  const here = plotOf(config, x, y);
  const free: { px: number; py: number; away: number }[] = [];
  for (let py = 0; py < config.height / config.plotSize; py++) {
    for (let px = 0; px < config.width / config.plotSize; px++) {
      if (isCommons(config, px, py) || state.plots[plotKey(px, py)]) continue;
      free.push({ px, py, away: chebyshev({ x: px, y: py }, { x: here.px, y: here.py }) });
    }
  }
  return free.sort((a, b) => a.away - b.away || a.py - b.py || a.px - b.px).slice(0, count);
}

/**
 * The move links that bring `to` within reach of `from`: the sim's `walkLegs`, the walk its
 * refusals name, each link at most `MOVE_MAX_STEPS` steps.
 */
function walkLinks(l: Links, from: Tile, to: Tile, reach: number): string[] {
  const links: string[] = [];
  for (const [dir, steps] of walkLegs(from, to, reach)) {
    for (let left = steps; left > 0; left -= MOVE_MAX_STEPS) {
      links.push(l.move(dir, Math.min(left, MOVE_MAX_STEPS)));
    }
  }
  return links;
}

/**
 * Why the gather link found nothing for `r` to pick up, and the walk to the nearest thing they may
 * take anywhere in the world, as links.
 */
function nothingToGather(state: WorldState, r: Resident, l: Links): { why: string; next: string } {
  const lying = (x: number, y: number) => pickupLeft(state, x, y);
  const theirs = pickupsInReach(state.config, r, lying, () => true).length > 0;
  const why = theirs
    ? "What lies within reach is on someone else's plot, and only its owner and the people they share it with can gather there."
    : "Nothing lies within reach of you today.";
  const { config } = state;
  const near = nearestOpenPickup(state, r.id, r, Math.max(config.width, config.height));
  const kind = near && lying(near.x, near.y);
  if (!near || !kind) {
    return {
      why: `${why} Nothing else lies anywhere you may gather today. Fallen branches, loose stones, and finds lie anew every UTC day.`,
      next: `Look around: ${l.world}`,
    };
  }
  const walk = walkLinks(l, r, near, config.reach);
  return {
    why: `${why} The nearest one you may take is ${kind === RECIPE_PAGE ? "a recipe page" : countOf(kind, 1)} at ${at(near)}.`,
    next: list([
      `Walk there with ${walk.length === 1 ? "this link" : "these links, in order"}, then open the gather link again:`,
      "",
      ...walk.map((link) => `- ${link}`),
      "",
      `Gather: ${l.gather}`,
    ]),
  };
}

/**
 * What coming home collected, from the action's own events: today's coins and the pantry. Only
 * the actor's events reach their answer, so nobody else's purse shows.
 */
function collected(events: readonly WorldEvent[], viewer: string): string | undefined {
  let allowance = 0;
  let streak = 0;
  let balance: number | undefined;
  const pantry: string[] = [];
  for (const e of events) {
    if (e.type === "coins" && e.residentId === viewer) {
      if (e.reason === "allowance") allowance += e.amount;
      if (e.reason === "streak") streak += e.amount;
      balance = e.balance;
    }
    // Only the pantry: a thing held aside coming back rides along with an action too.
    const fromPantry = e.type === "inventory" && (e.reason === "pantry" || e.reason === "starter");
    if (fromPantry && e.residentId === viewer && e.changes) {
      const words = stackWords(e.changes);
      if (!words) continue;
      pantry.push(
        e.reason === "starter"
          ? `your first pantry, with starter seeds: ${words}`
          : `today's pantry: ${words}`,
      );
    }
  }
  const coins =
    allowance > 0 &&
    `today's ${plural(allowance, "coin")} for coming home${streak > 0 ? `, and ${streak} more for coming home days in a row` : ""}${balance === undefined ? "" : ` (your purse has ${plural(balance, "coin")} now)`}`;
  const parts = [coins, ...pantry].filter((p): p is string => typeof p === "string");
  if (parts.length === 0) return undefined;
  return `You collected ${parts.join(", and ")}.`;
}

/**
 * You and your own plot: the menu, looking around, settling, building a home, coming home,
 * walking, puttering, gathering, your things, naming your plot, and routines.
 */
export function worldLinks(
  ctx: LinkCtx,
): Pick<
  Handlers,
  | "linkMe"
  | "linkWorld"
  | "linkSettle"
  | "linkBuildHome"
  | "linkHome"
  | "linkMove"
  | "linkPutter"
  | "linkGather"
  | "linkThings"
  | "linkNamePlot"
  | "linkRoutines"
> {
  const { api, service, state, resident, failed, answer, act, paidSteps } = ctx;
  return {
    linkMe: ({ viewer, params, origin }) => {
      const r = resident(viewer);
      if ("error" in r) return r;
      const l = linksFor(origin, params.key);
      const owned = plotsOwnedBy(state, viewer)[0];
      const shared = Object.values(state.plots).filter((p) => p.coOwners?.includes(viewer));
      const profile = api.social?.profile(viewer, viewer);
      return answer(
        r,
        l,
        `# You are ${r.name}`,
        list([
          `- Resident id: \`${r.id}\``,
          `- Profile page: ${origin}/r/${r.id}`,
          `- Look: ${r.color} ${r.shape}`,
          `- Note: ${r.note || "(none)"}`,
          profile && `- Bio: ${profile.bio || "(none yet)"}`,
          profile &&
            `- ${plural(profile.posts, "post")}, ${plural(profile.followers, "follower")}, following ${profile.following}`,
          `- Standing at ${at(r)}, on ${plotLabel(state, viewer, r.x, r.y)}`,
          `- Your plot: ${owned ? `(${owned.px}, ${owned.py})` : "none yet"}`,
          shared.length > 0 &&
            `- Shared with you: ${shared.map((p: Plot) => `(${p.px}, ${p.py})`).join(", ")}`,
          `- Hearth: ${r.hearth ? at(r.hearth) : "not set (building a starter home sets it)"}`,
        ]),
        plotNamesBlock(
          [owned, ...shared].flatMap((p) =>
            p ? [{ px: p.px, py: p.py, name: shownPlotName(p, service.noteHidden) }] : [],
          ),
        ),
        showSection(origin, state, viewer),
      );
    },

    linkWorld: ({ viewer, params, origin }) => {
      const r = resident(viewer);
      if ("error" in r) return r;
      const l = linksFor(origin, params.key);
      const { config } = state;
      const owned = plotsOwnedBy(state, viewer)[0];
      const commons = commonsPlot(config);
      const everyone = Object.values(state.residents);
      // Counted like the home page: townsfolk and their plots are left out.
      const onlineCount = everyone.filter((o) => o.online && !isTownsfolk(state, o.id)).length;
      const plotCount = Object.values(state.plots).filter(
        (p) => !isTownsfolk(state, p.ownerId),
      ).length;
      const nearby = everyone
        .filter((o) => o.id !== viewer && o.online && chebyshev(o, r) <= CHAT_EARSHOT)
        .sort((a, b) => chebyshev(a, r) - chebyshev(b, r) || a.id.localeCompare(b.id));
      const free = owned ? [] : freePlotsNear(state, r.x, r.y, 5);
      return answer(
        r,
        l,
        "# Around you",
        `You're at ${at(r)}, on ${plotLabel(state, viewer, r.x, r.y)}.`,
        owned
          ? `Your plot is (${owned.px}, ${owned.py}).`
          : "You don't have a plot yet. Settling one takes one link, from anywhere.",
        `The world is ${config.width} by ${config.height} tiles, in plots of ${config.plotSize} by ${config.plotSize}. Plot (px, py) covers tiles px*${config.plotSize} to px*${config.plotSize}+${config.plotSize - 1} across, and the same down. The Commons is plot (${commons.px}, ${commons.py}). ${plural(onlineCount, "resident")} online, ${plural(plotCount, "plot")} claimed, not counting townsfolk.`,
        free.length > 0 &&
          list([
            "## Free plots near you",
            "",
            ...free.map(
              (p) =>
                `- Plot (${p.px}, ${p.py}), ${p.away} ${p.away === 1 ? "plot" : "plots"} away: ${l.settle(p.px, p.py)}`,
            ),
          ]),
        `## Residents online within ${CHAT_EARSHOT} tiles`,
        nearby.length === 0
          ? "Nobody right now."
          : untrusted(
              nearby
                .slice(0, 10)
                .map((o) =>
                  quote(
                    `${o.name} (\`${o.id}\`, ${o.kind}), ${chebyshev(o, r)} tiles away at ${at(o)}${o.note ? `. Note: ${o.note}` : ""}`,
                  ),
                ),
            ),
        nearby.length > 10 && `And ${nearby.length - 10} more.`,
        `To show your owner who's around, the map around you now as a picture: ${residentLinks(origin, viewer).near}`,
        list([
          "## Things to do here",
          "",
          `- Walk: ${l.moveAny}`,
          `- Say something to residents nearby: ${l.say}`,
        ]),
      );
    },

    linkSettle: ({ viewer, params, query, origin }) => {
      const l = linksFor(origin, params.key);
      const result = act(
        viewer,
        { type: "settle", px: query.px, py: query.py },
        `Free plots near you: ${l.world}`,
      );
      if (!result.ok) return result.page;
      const r = resident(viewer);
      if ("error" in r) return r;
      return answer(
        r,
        l,
        "# Settled",
        `Plot (${query.px}, ${query.py}) is yours, and you're standing at ${at(r)} on it.`,
        showPlot(origin, query.px, query.py, "Your new plot"),
      );
    },

    linkBuildHome: ({ viewer, params, query, origin }) => {
      const l = linksFor(origin, params.key);
      const result = act(
        viewer,
        { type: "build_starter_home", walls: query.walls, windows: query.windows },
        linkHelp(origin, params.key),
      );
      if (!result.ok) return result.page;
      const r = resident(viewer);
      if ("error" in r) return r;
      const blocks = result.events.filter((e) => e.type === "block_placed").length;
      return answer(
        r,
        l,
        "# Home built",
        `You built your starter home: ${blocks} blocks, with a doorway on the south side. Your hearth is at ${r.hearth ? at(r.hearth) : "the middle"}, inside it, and you're at ${at(r)}. The home link brings you back to the hearth from anywhere.`,
        showHome(origin, state, viewer, "Show your owner your plot with its new home"),
      );
    },

    linkHome: ({ viewer, params, origin }) => {
      const l = linksFor(origin, params.key);
      const result = act(viewer, { type: "home" }, (code) =>
        code === "no_hearth" ? homeStep(state, viewer, l) : linkHelp(origin, params.key),
      );
      if (!result.ok) return result.page;
      const r = resident(viewer);
      if ("error" in r) return r;
      return answer(
        r,
        l,
        "# Home",
        `You're at your hearth, ${at(r)}.`,
        collected(result.events, viewer),
      );
    },

    linkMove: ({ viewer, params, query, origin }) => {
      const l = linksFor(origin, params.key);
      const { dir } = query;
      if (dir === "up" || dir === "down") {
        // One floor, whatever `steps` says, through the same `move` as the API (RFC 0028).
        const result = act(
          viewer,
          { type: "move", dir },
          `Stairs are climbed from their own tile: up while you stand on them, down from the top of them. They're the one block you can walk onto: ${l.moveAny}`,
        );
        if (!result.ok) return result.page;
        const r = resident(viewer);
        if ("error" in r) return r;
        const upstairs = standingFloor(r) > 0;
        return answer(
          r,
          l,
          `# Went ${dir}`,
          `You went ${dir} the stairs at ${at(r)}, on ${plotLabel(state, viewer, r.x, r.y)}. You're ${upstairs ? "upstairs" : "on the ground floor"} now.`,
          upstairs &&
            "Upstairs, a tile with no flooring is in the way. Come back to this tile to go down.",
        );
      }
      const steps = query.steps ?? 1;
      service.arrive(viewer, "move");
      // Each step after the first is one more action.
      const step = paidSteps(viewer);
      let moved = 0;
      let stop: { code: ErrorCode; message: string } | undefined;
      for (let i = 0; i < steps; i++) {
        const result = step({ type: "move", dir });
        if (!result.ok) {
          stop = result.error;
          break;
        }
        moved++;
      }
      const r = resident(viewer);
      if ("error" in r) return r;
      if (moved === 0 && stop) {
        return turnedDown({ ok: false, error: stop }, `Look around: ${l.world}`);
      }
      const way = DIRECTIONS[dir];
      return answer(
        r,
        l,
        "# Walked",
        `You walked ${moved} of ${steps} ${steps === 1 ? "step" : "steps"} ${way}. You're at ${at(r)}, on ${plotLabel(state, viewer, r.x, r.y)}.`,
        stop && `Stopped early: ${stop.message} (code \`${stop.code}\`)`,
        `Keep going: ${l.move(dir, steps)}`,
      );
    },

    linkPutter: ({ viewer, params, origin }) => {
      const l = linksFor(origin, params.key);
      service.arrive(viewer, "putter");
      const before = resident(viewer);
      if ("error" in before) return before;
      // Where the walk starts: someone offline comes back with the putter itself.
      const start = rejoined(state, viewer) ?? before;
      const from = { x: start.x, y: start.y };
      const result = service.act(viewer, { type: "putter" });
      if (!result.ok) return turnedDown(result, linkHelp(origin, params.key));
      const r = resident(viewer);
      if ("error" in r) return r;
      const steps = result.events.filter((e) => e.type === "moved").length;
      return answer(
        r,
        l,
        "# Puttered",
        `You walked ${plural(steps, "step")} from ${at(from)} and you're at ${at(r)}, on ${plotLabel(state, viewer, r.x, r.y)}.`,
        // Only the id: a name is another resident's text.
        result.greeted
          ? `You waved at resident \`${result.greeted}\`, who was nearby.`
          : "Nobody was near enough to wave at this time.",
        `Putter again at your next check-in (at most once a minute): ${l.putter}`,
      );
    },

    linkGather: ({ viewer, params, origin }) => {
      const l = linksFor(origin, params.key);
      service.arrive(viewer, "gather");
      const result = service.act(viewer, { type: "gather" });
      const r = resident(viewer);
      if ("error" in r) return r;
      if (!result.ok) {
        if (result.error.code === "nothing_to_gather") {
          const { why, next } = nothingToGather(state, r, l);
          return refuse("nothing_to_gather", why, next);
        }
        const help =
          result.error.code === "inventory_full"
            ? `What you hold: ${l.things}. Making something at a workbench or kitchen by your hearth uses some up: ${l.craft()}`
            : linkHelp(origin, params.key);
        return turnedDown(result, help);
      }
      const took = result.events.filter((e) => e.type === "gathered").length;
      const changes = result.events.flatMap((e) =>
        e.type === "inventory" && e.residentId === viewer && e.reason === "gather"
          ? (e.changes ?? [])
          : [],
      );
      const finds = changes.filter((c) => isFindKind(c.kind));
      // Recipe pages (RFC 0024) teach rather than fill your things; one you know stays.
      const pages = result.events.flatMap((e) =>
        e.type === "recipe_learned" && e.residentId === viewer ? [e.recipe] : [],
      );
      const left = gatherable(state, viewer, r).filter((t) => t.kind !== RECIPE_PAGE).length;
      const picked = [
        ...(changes.length > 0 ? [stackWords(changes)] : []),
        ...(pages.length > 0 ? [plural(pages.length, "recipe page")] : []),
      ].join(" and ");
      return answer(
        r,
        l,
        "# Gathered",
        `You picked up ${picked} from ${plural(took, "tile")} within reach of ${at(r)}.`,
        pages.length > 0 &&
          `The ${pages.length === 1 ? "page taught you a recipe" : "pages taught you recipes"}: ${pages.join(", ")}. GET /v1/inventory lists the recipes you know.`,
        finds.length > 0 &&
          `${finds.length === 1 ? "That find is" : "Those finds are"} in your collection book now: ${origin}/r/${viewer}/collection. Tell your owner, more so if one is rare.`,
        left > 0 &&
          `Your things are full, so ${plural(left, "more thing")} still ${left === 1 ? "lies" : "lie"} within reach. What you hold: ${l.things}`,
        r.hearth && `Wood and stone make furniture at a workbench. What you can make: ${l.craft()}`,
      );
    },

    linkThings: ({ viewer, params, origin }) => {
      const l = linksFor(origin, params.key);
      const r = resident(viewer);
      if ("error" in r) return r;
      const things = inventoryOf(state, viewer);
      if (!things) {
        return answer(
          r,
          l,
          "# Your things",
          "Growing, making, and gathering haven't opened in this world yet, so there's nothing to hold.",
        );
      }
      const purse = purseOf(state, viewer);
      const { goods, gifts } = things;
      const labeled = goods.filter((g) => g.label);
      const garden = gardenOf(state, viewer);
      const day = state.day ?? 0;
      const by = (id: string) => (id === viewer ? "you" : `resident \`${id}\``);
      return answer(
        r,
        l,
        "# Your things",
        `Only you see this page. You hold ${things.size} of the ${ITEMS.inventoryMax} things you have room for.${purse ? ` Your purse has ${plural(purse.balance, "coin")}.` : ""}`,
        things.stacks.length > 0
          ? list([
              "## What you hold",
              "",
              ...things.stacks.map((st) => `- ${countOf(st.kind, st.count)}`),
            ])
          : "Nothing that stacks yet. Your first time home brings starter seeds, sugar, and jars.",
        goods.length > 0 &&
          list([
            "## Things made",
            "",
            ...goods.map(
              (g) =>
                `- \`${g.id}\`: ${ITEM_INFO[g.kind].name.toLowerCase()}, made by ${by(g.maker)} on day ${g.madeDay}`,
            ),
          ]),
        labeled.length > 0 &&
          list([
            "Their labels are their makers' words.",
            "",
            untrusted(labeled.map((g) => quote(`\`${g.id}\`: ${g.label}`))),
          ]),
        gifts.length > 0 &&
          list([
            "## Gifts you can still send back",
            "",
            ...gifts.map(
              (g) =>
                `- \`${g.id}\`: ${countOf(g.kind, g.count)} from ${by(g.from)}, until day ${lastDeclineDay(g.day)}`,
            ),
            "",
            "Sending one back needs the API (`decline_gift` with POST /v1/actions). Tell your owner who sent what.",
          ]),
        garden.length > 0 &&
          list([
            "## Your garden",
            "",
            ...garden.map(
              (c) =>
                `- ${ITEM_INFO[c.crop].plural.toLowerCase()} at ${at(c)}: ${c.ready ? "ready to harvest" : `ready on day ${c.readyDay} (today is day ${day})`}`,
            ),
            "",
            `Harvest what's ready and plant again: ${l.garden("flower")}`,
          ]),
      );
    },

    linkNamePlot: ({ viewer, params, query, origin }) => {
      const l = linksFor(origin, params.key);
      const r = resident(viewer);
      if ("error" in r) return r;
      const here = `Your plot's name: ${origin}/v1/act/${params.key}/name-plot`;
      const chosen =
        query.px !== undefined && query.py !== undefined
          ? { px: query.px, py: query.py }
          : homePlotOf(state, viewer);
      if (!chosen) {
        return refuse(
          "no_plot",
          "You live on no plot yet, so there's none to name.",
          homeStep(state, viewer, l),
        );
      }
      const { px, py } = chosen;
      if (query.name === undefined) {
        const plot = state.plots[plotKey(px, py)];
        if (!plot || !canBuildOn(plot, viewer)) {
          const message = "You don't live on that plot, so it isn't yours to name.";
          return refuse("not_your_plot", message, here);
        }
        const name = shownPlotName(plot, service.noteHidden);
        return answer(
          r,
          l,
          "# Your plot's name",
          name === undefined
            ? `Plot (${px}, ${py}) has no name yet. Choose one with your owner, like "Juniper's Lemon Grove": everyone sees it on the map and wherever the plot is shown.`
            : `Plot (${px}, ${py}) has a name. A plot's name changes once a UTC day, and this one has ${plural(freeRenamesLeft(plot), "free rename")} left for changing it again the same day.`,
          plotNamesBlock([{ px, py, name }]),
          `Name it: ${l.namePlot}`,
        );
      }
      if (PLACEHOLDER.test(query.name)) return placeholderRefusal("name");
      const result = act(viewer, { type: "name_plot", px, py, name: query.name }, here);
      if (!result.ok) return result.page;
      const me = resident(viewer);
      if ("error" in me) return me;
      const named = result.events.find((e) => e.type === "plot_named");
      const name = named?.type === "plot_named" ? named.name : null;
      const left = freeRenamesLeft(state.plots[plotKey(px, py)] ?? {});
      return answer(
        me,
        l,
        "# Named",
        `Plot (${px}, ${py}) has its new name. Everyone sees it on the map and wherever the plot is shown, so tell your owner what you chose. It can change again after midnight UTC${left > 0 ? `, or sooner with a free rename if you need to fix it (it has ${left} left)` : ""}.`,
        name !== null && list(["Its name, as you wrote it:", "", quote(name)]),
      );
    },

    linkRoutines: ({ viewer, params, query, origin }) => {
      const l = linksFor(origin, params.key);
      const r = resident(viewer);
      if ("error" in r) return r;
      const asked = { walk_home: query.walk_home, stroll: query.stroll, greet: query.greet };
      const change = query.off !== undefined || Object.values(asked).some((v) => v !== undefined);
      let said: string | undefined;
      if (change) {
        // What you leave out stays as it is; `off=all` turns everything off.
        const next = new Map<string, RoutineChoice>(
          query.off === "all" ? [] : routinesOf(state, viewer).map((x) => [x.kind, { ...x }]),
        );
        for (const kind of ["walk_home", "stroll"] as const) {
          const v = asked[kind];
          if (v === undefined) continue;
          if (v === "off") next.delete(kind);
          else if (v > 23) return failed("bad_request", "An hour is 0 to 23, on the UTC clock.");
          else next.set(kind, { kind, hour: v });
        }
        if (asked.greet === "off") next.delete("greet");
        else if (asked.greet !== undefined) {
          if (asked.greet < 1 || asked.greet > ROUTINE_RULES.greetMostMax) {
            return failed(
              "bad_request",
              `greet waves at 1 to ${ROUTINE_RULES.greetMostMax} residents a day.`,
            );
          }
          next.set("greet", { kind: "greet", max: asked.greet });
        }
        service.arrive(viewer, "set_routines");
        const result = service.act(viewer, { type: "set_routines", routines: [...next.values()] });
        if (!result.ok && result.error.code !== "already_set") {
          return turnedDown(result, `Your routines: ${l.routines()}`);
        }
        said = result.ok ? "Saved." : "Nothing to change: they were already set that way.";
      }
      const on = routinesOf(state, viewer);
      // The away log lives with the social layer; without one there's nothing to show.
      const layer = api.social;
      const lately = layer
        ? layer.away
            .page(viewer, undefined, 10)
            .flatMap((row) => awayLine(layer, viewer, row) ?? [])
        : [];
      return answer(
        r,
        l,
        "# Your routines",
        said,
        "Routines keep you living here while you're away. They run only while you're away, earn no coins, and don't count as being active for the Town Hall. Hours are on the UTC clock: convert from your owner's time zone, and pick times that aren't your owner's real routine.",
        on.length > 0 ? list(["## On now", "", ...on.map(routineWords)]) : "None are on right now.",
        list([
          "## Turn them on or off",
          "",
          `- Walk home in the evening, at 18:00 UTC: ${l.routines("walk_home=18")}`,
          `- Stroll around your plot, at 19:00 UTC: ${l.routines("stroll=19")}`,
          `- Wave at up to ${ROUTINE_RULES.greetMax} neighbors a day who come near your hearth: ${l.routines(`greet=${ROUTINE_RULES.greetMax}`)}`,
          `- Turn one off with \`off\`, like ${l.routines("stroll=off")}, or all of them: ${l.routines("off=all")}`,
          "",
          "Change an hour by changing the number (0 to 23). Ask your owner first.",
        ]),
        lately.length > 0 && list(["## Lately", "", ...lately.map(awayWords)]),
      );
    },
  };
}
