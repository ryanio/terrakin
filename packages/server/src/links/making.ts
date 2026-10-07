import { type CropKind, type ErrorCode, REPEAT_WINDOW_MS } from "@terrakin/protocol";
import {
  CROP_INFO,
  canBuildOn,
  castsToday,
  chebyshev,
  countOf,
  FISHING,
  FISHING_ROD,
  FURNITURE_KINDS,
  FURNITURE_RECIPES,
  type FurnitureKind,
  GOOD_KINDS,
  type GoodKind,
  holdsRod,
  ITEM_INFO,
  ITEMS,
  isFurnitureKind,
  isSweetKind,
  isWater,
  knows,
  recipeOf as learnedAs,
  POND,
  pantryDue,
  pantryWould,
  picksLeft,
  plotAtTile,
  RECIPES,
  rejoined,
  type StackKind,
  SWEET_KINDS,
  SWEET_RECIPES,
  type SweetKind,
  tileKey,
  trickOrTreatNights,
  waterBeside,
} from "@terrakin/sim";
import type { Handlers } from "../handlers/shared";
import { gardenOf } from "../items";
import { plural } from "../markdown";
import {
  freeHutTiles,
  homeStep,
  type LinkCtx,
  linkHelp,
  linksFor,
  list,
  PLACEHOLDER,
  placeholderRefusal,
  refuse,
  type Tile,
  turnedDown,
} from "./shared";
import { andList, at, tilesWords } from "./words";

/** A recipe's name: a good, a piece of furniture, or a sweet (RFC 0022). */
type RecipeName = GoodKind | FurnitureKind | SweetKind;

/**
 * The links that work from the hearth like a short routine: the garden, making things, and
 * fishing. Each action after the first takes its own action token (`paidSteps`).
 */
export function makingLinks(ctx: LinkCtx): Pick<Handlers, "linkGarden" | "linkCraft" | "linkFish"> {
  const { service, state, resident, failed, answer, paidSteps } = ctx;
  return {
    linkGarden: ({ viewer, params, query, origin }) => {
      const l = linksFor(origin, params.key);
      const start = resident(viewer);
      if ("error" in start) return start;
      const hearth = start.hearth;
      // World refusals are 200 pages with an `Error code:` line, like the other links; `once`
      // forgets those, so the same link works once the reason is gone.
      if (!hearth) {
        return refuse(
          "no_hearth",
          "A garden is tended from your hearth, and you don't have one yet.",
          homeStep(state, viewer, l),
        );
      }
      const seed = query.seed;
      const crops = state.items?.crops;
      if (!crops) {
        return refuse(
          "items_closed",
          "Growing isn't open in this world yet.",
          linkHelp(origin, params.key),
        );
      }
      const held = (crop: CropKind) =>
        state.items?.inventories[viewer]?.stacks[CROP_INFO[crop].seed] ?? 0;
      const ready = gardenOf(state, viewer).some(
        (c) => c.ready && crops[tileKey(c.x, c.y)]?.by === viewer,
      );
      // Seeds today's pantry would bring with the walk home count as held.
      const coming = seed ? pantryWould(state, viewer, CROP_INFO[seed].seed) : 0;
      if (seed && held(seed) + coming === 0 && !ready) {
        return refuse(
          "not_enough_items",
          `You have no ${seed} seeds. Each harvest gives one back; the town shop sells more through the API.`,
          `Plant another kind: ${l.garden("herb")}`,
        );
      }
      // Checks done: from here on the visit acts, so it brings you online.
      service.arrive(viewer, "home");
      // Where you'll stand once back: someone offline comes back with the first action.
      const here = rejoined(state, viewer) ?? resident(viewer);
      if ("error" in here) return here;
      // The dispatcher paid for the first action; each one after it is one more.
      const act = paidSteps(viewer);
      // Home first: away from the hearth, or standing on it with today's pantry still to collect.
      if (here.x !== hearth.x || here.y !== hearth.y || pantryDue(state, viewer)) {
        const went = act({ type: "home" });
        if (!went.ok) return turnedDown(went, linkHelp(origin, params.key));
      }
      const reach = state.config.reach;
      const near = (t: Tile) => chebyshev(t, hearth) <= reach;
      const mine = (t: Tile) => canBuildOn(plotAtTile(state, t.x, t.y), viewer);
      const done: string[] = [];
      const harvested: Tile[] = [];
      let stop: { code: ErrorCode; message: string } | undefined;
      // Only what you planted: on a shared plot, a co-owner's crops are theirs to pick.
      for (const crop of gardenOf(state, viewer)) {
        if (!crop.ready || !near(crop) || crops[tileKey(crop.x, crop.y)]?.by !== viewer) continue;
        const picked = act({ type: "harvest", x: crop.x, y: crop.y });
        if (!picked.ok) {
          stop = picked.error;
          break;
        }
        const info = CROP_INFO[crop.crop];
        harvested.push({ x: crop.x, y: crop.y });
        done.push(
          `You harvested ${countOf(crop.crop, info.yield)} at ${at(crop)}, and ${countOf(info.seed, info.seeds)} back.`,
        );
      }
      const planted: Tile[] = [];
      // Planters this visit emptied that stay empty, and why.
      let empty: Tile[] = [];
      let emptyWhy = "";
      const seeds = seed && ITEM_INFO[CROP_INFO[seed].seed].plural.toLowerCase();
      if (seed && !stop) {
        // Replant every planter just harvested. With none, one empty planter within reach, or a
        // new one inside the starter hut.
        const spots = [...harvested];
        if (spots.length === 0 && held(seed) === 0) {
          stop = {
            code: "not_enough_items",
            message: `You have no ${seeds}. Each harvest gives seeds back; the town shop sells more through the API.`,
          };
        }
        if (spots.length === 0 && !stop) {
          const free = (t: Tile) =>
            state.blocks[tileKey(t.x, t.y)] === "planter" && !crops[tileKey(t.x, t.y)];
          for (let dy = -reach; dy <= reach && spots.length === 0; dy++) {
            for (let dx = -reach; dx <= reach && spots.length === 0; dx++) {
              const t = { x: hearth.x + dx, y: hearth.y + dy };
              if (mine(t) && free(t)) spots.push(t);
            }
          }
        }
        if (spots.length === 0 && !stop) {
          for (const t of freeHutTiles(state, viewer, hearth)) {
            const placed = act({ type: "place", x: t.x, y: t.y, block: "planter" });
            if (placed.ok) {
              spots.push(t);
              done.push(`You placed a planter at ${at(t)}.`);
              break;
            }
            if (placed.error.code === "rate_limited") {
              stop = placed.error;
              break;
            }
          }
          if (spots.length === 0 && !stop) {
            stop = {
              code: "no_planter",
              message:
                "There's no empty planter within reach of your hearth, and no free tile inside a starter hut for one. Place a planter with the API, or harvest what's growing first.",
            };
          }
        }
        for (const [i, spot] of spots.entries()) {
          if (held(seed) === 0) {
            empty = spots.slice(i);
            emptyWhy = `you have no more ${seeds}. Each harvest gives seeds back; the town shop sells more through the API`;
            break;
          }
          const sown = act({ type: "plant", x: spot.x, y: spot.y, seed });
          if (!sown.ok) {
            stop = sown.error;
            empty = spots.slice(i).filter((t) => harvested.includes(t));
            emptyWhy = "planting stopped early (below)";
            break;
          }
          planted.push(spot);
        }
      } else if (!seed) {
        empty = harvested;
        emptyWhy = `name a seed to plant again, like ${l.garden("flower")} (or lemon, strawberry, tomato, herb)`;
      }
      const r = resident(viewer);
      if ("error" in r) return r;
      if (done.length === 0 && planted.length === 0 && stop) {
        return stop.code === "rate_limited"
          ? failed("rate_limited", stop.message)
          : turnedDown({ ok: false, error: stop }, `Your menu: ${l.me}`);
      }
      const first = planted[0];
      const growing = first ? crops[tileKey(first.x, first.y)] : undefined;
      const one = planted.length === 1;
      return answer(
        r,
        l,
        "# Garden",
        done.length > 0
          ? done.join(" ")
          : "Nothing you planted within reach of your hearth was ready to harvest.",
        seed &&
          planted.length > 0 &&
          `You planted ${countOf(CROP_INFO[seed].seed, planted.length)} at ${tilesWords(planted)}.${growing ? ` ${one ? "It's" : "They're"} ready on day ${growing.readyDay} (today is day ${state.day ?? 0}; days start at midnight UTC).` : ""}`,
        empty.length > 0 &&
          `The ${empty.length === 1 ? "planter" : "planters"} at ${tilesWords(empty)} ${empty.length === 1 ? "is" : "are"} empty now: ${emptyWhy}.`,
        !seed &&
          empty.length === 0 &&
          `Plant a seed: ${l.garden("flower")} (or lemon, strawberry, tomato, herb).`,
        // The code line marks the page unfinished, so opening the link again carries on.
        stop && `Stopped early: ${stop.message}\n\nError code: \`${stop.code}\`.`,
        "Your check-in says when a crop is ready. Open this link again then to harvest and plant again.",
      );
    },

    linkCraft: ({ viewer, params, query, origin }) => {
      const l = linksFor(origin, params.key);
      const start = resident(viewer);
      if ("error" in start) return start;
      if (query.label !== undefined && PLACEHOLDER.test(query.label)) {
        return placeholderRefusal("label");
      }
      // A label meets the filters first, as on the API, where they run before the world's rules:
      // a dry run's refusal for its words (or a label on furniture) stops here, before anything
      // is placed. Any other refusal is the world's, and the steps below meet it for real.
      if (query.label && query.recipe) {
        const label = query.label;
        const dry = service.act(viewer, {
          type: "craft",
          recipe: query.recipe,
          x: start.x,
          y: start.y,
          label,
          dry: true,
        });
        if (!dry.ok && (dry.error.code === "bad_request" || dry.error.code === "invalid_label")) {
          return refuse(dry.error.code, dry.error.message, `What you can make: ${l.craft()}`);
        }
      }
      const items = state.items;
      if (!items) {
        return refuse(
          "items_closed",
          "Growing, making, and gathering haven't opened in this world yet.",
          linkHelp(origin, params.key),
        );
      }
      const inv = items.inventories[viewer];
      const recipeOf = (kind: RecipeName) =>
        isFurnitureKind(kind)
          ? FURNITURE_RECIPES[kind]
          : isSweetKind(kind)
            ? SWEET_RECIPES[kind]
            : RECIPES[kind];
      // A sweet's recipe makes more than one: candy makes five.
      const makes = (kind: RecipeName) => recipeOf(kind).makes ?? 1;
      // Every recipe takes things that stack (the catalog's tests hold it to that).
      const needs = (kind: RecipeName) =>
        Object.entries(recipeOf(kind).needs) as [StackKind, number][];
      const needWords = (kind: RecipeName) => andList(needs(kind).map(([k, n]) => countOf(k, n)));
      const short = (kind: RecipeName) =>
        needs(kind).flatMap(([k, n]) => {
          const have = inv?.stacks[k] ?? 0;
          return have < n ? [countOf(k, n - have)] : [];
        });
      const recipe = query.recipe;
      if (!recipe) {
        const every: RecipeName[] = [...GOOD_KINDS, ...FURNITURE_KINDS, ...SWEET_KINDS];
        // Once recipes are learned (RFC 0024), only the ones you know; the rest are to learn.
        const all = every.filter((k) => knows(state, viewer, learnedAs(k)));
        const toLearn = new Set(every.filter((k) => !all.includes(k)).map((k) => learnedAs(k)))
          .size;
        const picks = picksLeft(state, viewer);
        const ready = all.filter((k) => short(k).length === 0);
        return answer(
          start,
          l,
          "# Make something",
          `Made at a kitchen or a workbench by your hearth, ${ITEMS.craftPerDay} things a day at most. A good is signed with your name; furniture and sweets (candy, candy canes) stack, and placing furniture needs the API.`,
          ready.length > 0
            ? list([
                "## You can make now",
                "",
                ...ready.map((k) => `- ${ITEM_INFO[k].name}: ${l.craft(k)}`),
              ])
            : "You don't have enough for anything yet: grow what recipes take with the garden link, and gather wood and stone with the API.",
          list([
            toLearn > 0 ? "## Recipes you know" : "## Every recipe",
            "",
            ...all.map(
              (k) =>
                `- \`${k}\`, at a ${recipeOf(k).station}: ${needWords(k)}${makes(k) > 1 ? `, makes ${makes(k)}` : ""}`,
            ),
          ]),
          toLearn > 0 &&
            list([
              "## Recipes to learn",
              "",
              `${plural(toLearn, "more recipe")} to learn, from the Recipes shelf of the town shop (\`GET /v1/shop\`, its \`recipes\`). ${
                picks > 0
                  ? `You have ${plural(picks, "free pick")}: \`pick_recipe\` with any card's recipe, free. `
                  : ""
              }A card is \`shop_buy\` with sku \`recipe:<name>\` and count 1, at the price on the shelf. Both need the API.`,
            ]),
        );
      }
      const hearth = start.hearth;
      if (!hearth) {
        return refuse(
          "no_hearth",
          "Things are made by your hearth, and you don't have one yet.",
          homeStep(state, viewer, l),
        );
      }
      const missing = short(recipe);
      if (missing.length > 0) {
        return refuse(
          "not_enough_items",
          `${ITEM_INFO[recipe].name} takes ${needWords(recipe)}, and you need ${andList(missing)} more.`,
          `Grow what it takes: ${l.garden("flower")}. What you can make now: ${l.craft()}`,
        );
      }
      const { station } = recipeOf(recipe);
      // Checks done: from here on the visit acts, so it brings you online.
      service.arrive(viewer, "craft");
      const here = rejoined(state, viewer) ?? start;
      // The dispatcher paid for the first action; each one after it is one more.
      const act = paidSteps(viewer);
      // Home first, so a station by the hearth is within reach.
      if (here.x !== hearth.x || here.y !== hearth.y) {
        const went = act({ type: "home" });
        if (!went.ok) return turnedDown(went, linkHelp(origin, params.key));
      }
      const reach = state.config.reach;
      const mine = (t: Tile) => canBuildOn(plotAtTile(state, t.x, t.y), viewer);
      let spot: Tile | undefined;
      for (let dy = -reach; dy <= reach && !spot; dy++) {
        for (let dx = -reach; dx <= reach && !spot; dx++) {
          const t = { x: hearth.x + dx, y: hearth.y + dy };
          if (mine(t) && state.blocks[tileKey(t.x, t.y)] === station) spot = t;
        }
      }
      let placed = "";
      if (!spot) {
        for (const t of freeHutTiles(state, viewer, hearth)) {
          const put = act({ type: "place", x: t.x, y: t.y, block: station });
          if (put.ok) {
            spot = t;
            placed = `You placed a ${station} at ${at(t)}. `;
            break;
          }
          if (put.error.code === "rate_limited") return failed("rate_limited", put.error.message);
        }
      }
      if (!spot) {
        return refuse(
          "no_station",
          `${ITEM_INFO[recipe].name} is made at a ${station}, and there's none within reach of your hearth and no free tile inside a starter hut for one. Place one with the API.`,
          `Your menu: ${l.me}`,
        );
      }
      const label = query.label;
      const made = act({
        type: "craft",
        recipe,
        x: spot.x,
        y: spot.y,
        ...(label ? { label } : {}),
      });
      if (!made.ok) {
        if (made.error.code === "rate_limited") return failed("rate_limited", made.error.message);
        return turnedDown(made, `What you can make: ${l.craft()}`);
      }
      const me = resident(viewer);
      if ("error" in me) return me;
      const furniture = isFurnitureKind(recipe);
      return answer(
        me,
        l,
        "# Made",
        `${placed}You made ${furniture ? "a piece of furniture: " : ""}${countOf(recipe, makes(recipe))} at the ${station} at ${at(spot)}. It's in your things: ${l.things}`,
        furniture
          ? "Furniture goes on your plot with the API (`place`, or a `build` plan); a link can't place it."
          : recipe === "candy"
            ? `Candy is for trick-or-treaters on ${trickOrTreatNights()} (UTC): whoever is home hands it out at their door. Giving it or selling it needs the API. Tell your owner what you made.`
            : isSweetKind(recipe)
              ? "Sweets are for giving, at Midwinter or any day. Giving them or selling them needs the API. Tell your owner what you made."
              : "Giving it, selling it, or putting it on display needs the API. Tell your owner what you made.",
      );
    },

    linkFish: ({ viewer, params, origin }) => {
      const l = linksFor(origin, params.key);
      const start = resident(viewer);
      if ("error" in start) return start;
      const items = state.items;
      if (!items) {
        return refuse(
          "items_closed",
          "Growing, making, and gathering haven't opened in this world yet.",
          linkHelp(origin, params.key),
        );
      }
      const rodWords = countOf("wood", RECIPES[FISHING_ROD].needs.wood ?? 0);
      if (!holdsRod(items.inventories[viewer])) {
        return refuse(
          "no_rod",
          `Fishing takes a fishing rod in your things. Make one by your hearth from ${rodWords}: ${l.craft(FISHING_ROD)}`,
          `Your menu: ${l.me}`,
        );
      }
      const water = (x: number, y: number) => isWater(state, x, y);
      const hearth = start.hearth;
      const here = rejoined(state, viewer) ?? start;
      const besideHere = waterBeside(here, water) !== undefined;
      const besideHome = hearth ? waterBeside(hearth, water) !== undefined : false;
      const stone = items.inventories[viewer]?.stacks.stone ?? 0;
      if (!besideHere && !hearth) {
        return refuse(
          "no_water",
          "There's no water right beside you, and you have no hearth to fish from yet.",
          homeStep(state, viewer, l),
        );
      }
      if (!besideHere && !besideHome && stone < POND.stone) {
        return refuse(
          "no_water",
          `There's no water beside you or your hearth. A tile of pond takes ${countOf("stone", POND.stone)}, and you have ${countOf("stone", stone)}: gather stone with the API (\`gather\`), or ask a friend for some.`,
          `Your menu: ${l.me}`,
        );
      }
      // Checks done: from here on the visit acts, so it brings you online.
      service.arrive(viewer, "fish");
      // The dispatcher paid for the first action; each one after it is one more.
      const act = paidSteps(viewer);
      let dug = "";
      if (!besideHere && hearth) {
        const me = rejoined(state, viewer) ?? start;
        if (me.x !== hearth.x || me.y !== hearth.y) {
          const went = act({ type: "home" });
          if (!went.ok) return turnedDown(went, linkHelp(origin, params.key));
        }
        if (!besideHome) {
          // A tile of pond beside the hearth, inside the starter hut, never between it and the door.
          for (const t of freeHutTiles(state, viewer, hearth)) {
            const put = act({ type: "place", x: t.x, y: t.y, block: "pond" });
            if (put.ok) {
              dug = `You dug a tile of pond at ${at(t)}, beside your hearth, with ${countOf("stone", POND.stone)}. `;
              break;
            }
            if (put.error.code === "rate_limited") return failed("rate_limited", put.error.message);
          }
          if (!dug) {
            return refuse(
              "no_water",
              "There's no water beside your hearth, and no free tile inside your starter hut beside it for a pond. Place one with the API.",
              `Your menu: ${l.me}`,
            );
          }
        }
      }
      const cast = act({ type: "fish" });
      if (!cast.ok) {
        if (cast.error.code === "rate_limited") return failed("rate_limited", cast.error.message);
        return turnedDown(cast, `Your menu: ${l.me}`);
      }
      const fished = cast.events.find((e) => e.type === "fished");
      const caught = fished?.type === "fished" ? fished.caught : "nothing";
      const line =
        caught === "nothing"
          ? "Nothing's biting this time."
          : caught === "boot"
            ? "You reeled in an old boot, and threw it back."
            : `You caught ${countOf(caught, 1).replace(/^1 /, /^1 [aeiou]/.test(countOf(caught, 1)) ? "an " : "a ")}! It's in your things and your collection book: ${l.things}`;
      const left = FISHING.castsPerDay - castsToday(state, viewer);
      const me = resident(viewer);
      if ("error" in me) return me;
      return answer(
        me,
        l,
        "# Fishing",
        `${dug}${line}`,
        left > 0
          ? `You have ${plural(left, "cast")} left today. Cast again in a few minutes (the same link does nothing new for ${REPEAT_WINDOW_MS / 60_000} minutes): ${l.fish}`
          : "That was your last cast today. The fish bite again after midnight UTC.",
        "What bites depends on the season, the time of day, and the weather: a rainy night brings up fish a sunny noon never does. Tell your owner when you catch something rare.",
      );
    },
  };
}
