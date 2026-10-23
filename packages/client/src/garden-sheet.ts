/**
 * The sheet a planter, kitchen, or workbench opens in the world (RFC 0005): plant a seed you
 * hold, pick a ready crop, or make something. A workbench also makes furniture (RFC 0016), listed
 * under its own heading: it stacks and takes no label. It only sends actions; the server decides,
 * and its answer shows as a toast in the world. A button your things already show the server
 * would turn down (an unripe crop, missing ingredients, today's making done) is off, with the
 * reason in its row. What you can make leads the list and the rest waits behind "Show more", so
 * a long kitchen doesn't bury today's choice. Labels are your own words, sent as text.
 *
 * A kiln (RFC 0047) is a station too: while it's empty it lists the pots you know with a row of
 * glazes over them, each pot drawn in the glaze picked and what that glaze costs added to its
 * needs, and Fire loads it. While it fires it shows the one pot, what it is only to whoever loaded
 * it, and Take it out once the world's day says it's ready. Taking it out is the pot's own moment:
 * the sheet stays open and shows it as it came out, named in its finish and glaze, with a flourish
 * for a rare finish, and the world's toast leaves it out.
 *
 * Once recipes are learned (RFC 0024), a kitchen or workbench lists only the recipes you know
 * (`inventory.recipes`), with how many more there are to learn and a link to the shop's Recipes
 * shelf. While you have free picks, the picks sheet (`recipe-picks.ts`) comes first. Neighbors
 * standing within reach who don't know a recipe you do get a Teach button each, which opens their
 * teach sheet (`teach-sheet.ts`).
 */
import {
  type Action,
  type FiredPot,
  type InventoryResponse,
  ITEM_CATALOG,
  ITEM_RULES,
} from "@terrakin/protocol";
import {
  type BlockKind,
  CATALOG,
  type Crop,
  FINISH_NAMES,
  GLAZE_COSTS,
  GLAZES,
  type Glaze,
  harvestFits,
  isReady,
  potName,
  RARE_FINISHES,
  type Station,
  TEA,
} from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { listOf, plural } from "@terrakin/ui/format";
import { GLAZE_HEX, itemArt, thingPicture } from "@terrakin/ui/item-art";
import {
  closeOverlay,
  disclosure,
  errorLine,
  itemRow,
  itemRows,
  openOverlay,
  overlayShowing,
  sheet,
  whileBusy,
} from "@terrakin/ui/ui";
import { inventoryApi } from "./api/inventory";
import { actProblem, worldApi } from "./api/world";
import { dotChips } from "./join-form";
import {
  CLAY_WHERE,
  cropOfSeed,
  finishName,
  finishOdds,
  growthLine,
  kilnLine,
  knownAt,
  missingLine,
  moreToLearn,
  needsLine,
  noSeedsHint,
  recipeShelf,
  recipeWords,
  revealLine,
  thingCount,
  thingName,
} from "./things";

export interface TileSheetOptions {
  block: BlockKind;
  x: number;
  y: number;
  /** What grows in the planter, as the world shows it. */
  planting?: { crop: Crop; readyDay: number };
  /** The pot a kiln is firing (RFC 0047), as the world shows it: who loaded it, and when it's ready. */
  firing?: { by: string; readyDay: number };
  /** You, to tell whether you loaded the kiln. */
  me?: string;
  /** Who loaded the kiln, when it's someone else. Their own words: text only. */
  loaderName?: string;
  day: number | undefined;
  /** Whether the tile is on a plot you own or share, as the world shows it. */
  yours: boolean;
  /** Whose plot it is otherwise. Their own words: text only. */
  ownerName?: string;
  /** Send an action. Undefined means it wasn't sent: the world isn't connected. */
  act: (action: Action) => string | undefined;
  /**
   * Once recipes are learned (RFC 0024): residents in the world within reach of you, as the world
   * shows them, nearest first. Their names and notes are their own words.
   */
  neighbors?: { id: string; name: string; kind: "human" | "agent"; note?: string }[];
  /** The world's reach, for the teach sheet. */
  reach?: number;
}

/** Neighbors a station sheet asks about, at most: one profile read each. */
const NEIGHBORS_ASKED = 4;

const TITLES: Partial<Record<BlockKind, string>> = {
  planter: "Planter",
  kitchen: "Kitchen",
  workbench: "Workbench",
  kiln: "Kiln",
};
const title = (block: BlockKind) => TITLES[block] ?? "Workbench";

/** A row with a name, a line under it, and one button (none on someone else's planter). */
function row(
  name: string,
  line: string,
  button: HTMLButtonElement | null,
  lead: Element | null = null,
): HTMLLIElement {
  return itemRow({
    className: "workshop-row",
    plain: true,
    name,
    lines: [line],
    trail: button,
    lead,
  });
}

/**
 * A list that shows its first rows and keeps the rest behind "Show 9 more recipes", which opens
 * them in place.
 */
function shelved(noun: string) {
  const shown = itemRows([], { className: "workshop-list" });
  const rest = itemRows([], { className: "workshop-list" });
  rest.hidden = true;
  const toggle = h("button", {
    class: "pill-button small workshop-more",
    attrs: { type: "button", hidden: true },
  });
  let hiddenCount = 0;
  const label = (open: boolean) => {
    toggle.textContent = open ? "Show fewer" : `Show ${hiddenCount} more ${noun}`;
  };
  disclosure(toggle, rest, undefined, label);
  return {
    el: h("div", { class: "stack tight" }, shown, rest, toggle),
    fill(first: readonly Element[], more: readonly Element[]) {
      shown.replaceChildren(...first);
      rest.replaceChildren(...more);
      hiddenCount = more.length;
      toggle.hidden = more.length === 0;
      label(!rest.hidden);
    },
  };
}

export function openTileSheet(o: TileSheetOptions) {
  const list = itemRows([], { className: "workshop-list" });
  const goods = shelved("recipes");
  const hint = h("p", { class: "sheet-lede workshop-hint", text: "Looking in your things…" });
  const things = h(
    "a",
    { class: "pill-button small workshop-things", attrs: { href: "/inventory" } },
    h("span", { text: "All your things" }),
    icon("arrow"),
  );
  // No closeOverlay here: the router closes the sheet as it goes, and takes over its history
  // entry, so the URL and the page stay in step.
  const label = h("input", {
    class: "field-input",
    attrs: {
      id: "workshop-label",
      maxlength: ITEM_RULES.labelMax,
      placeholder: o.block === "kiln" ? "Sunday tea" : "Sunny jar",
      autocomplete: "off",
    },
  });
  const station: Station | null =
    o.block === "kitchen" || o.block === "workbench" || o.block === "kiln" ? o.block : null;
  // A kiln's glazes (RFC 0047): a chip each, in its color, picked before a pot.
  let glaze: Glaze = "bare";
  let painted: InventoryResponse | null = null;
  const glazes =
    o.block === "kiln"
      ? dotChips(
          GLAZES,
          glaze,
          "Glaze",
          (g) => GLAZE_HEX[g],
          (g) => g,
          (g) => {
            glaze = g;
            if (painted) paint(painted);
          },
        ).row
      : null;
  const glazeField = glazes
    ? h(
        "div",
        { class: "workshop-label" },
        h("span", { class: "field-label", text: "Glaze (each but bare costs one thing)" }),
        glazes,
      )
    : null;
  // What can come out of a kiln (RFC 0047): a pot in the picked glaze in each finish, with its odds,
  // so there's something to hope for before the first one opens.
  const finishList = h("ul", { class: "plain-list kiln-finishes" });
  const finishes =
    o.block === "kiln"
      ? h(
          "div",
          { class: "stack tight" },
          h("span", { class: "field-label", text: "What can come out" }),
          finishList,
          h("p", {
            class: "hint kiln-uses",
            text: `What pots are for: set one down at home, a vase with a flower in it. A teapot and ${CATALOG[TEA].recipe?.needs.herb ?? 2} bunches of herbs at a kitchen make a pot of tea, and you keep the teapot: serve it at your own event, and each counted guest takes home a cup. Clem and Ansel ask for bowls and vases on the town's jobs board. ${CLAY_WHERE}`,
          }),
        )
      : null;
  /** The finishes drawn on a vase in `drawn`: the glaze picked, or the one in the kiln or just out. */
  const paintFinishes = (drawn: Glaze = glaze) =>
    finishList.replaceChildren(
      ...FINISH_NAMES.map((f) =>
        h(
          "li",
          { class: "kiln-finish", attrs: { "data-finish": f } },
          thingPicture({ kind: "vase", glaze: drawn, finish: f }, { size: 40 }),
          h("span", { class: "kiln-finish-name", text: finishName(f) }),
          h("span", { class: "kiln-finish-odds", text: finishOdds(f) }),
        ),
      ),
    );
  // A pot just out of the kiln (RFC 0047), shown in the sheet until Fire another.
  const reveal = h("div", { class: "kiln-reveal", attrs: { hidden: true, "aria-live": "polite" } });
  let revealed: FiredPot | null = null;
  // A planter lists seeds or its crop; a station lists what it makes, a few at a time.
  list.hidden = station !== null;
  goods.el.hidden = station === null;
  const labelField = station
    ? h(
        "div",
        { class: "workshop-label" },
        h("label", {
          class: "field-label",
          attrs: { for: "workshop-label" },
          text: "Label it (optional)",
        }),
        label,
      )
    : null;
  const problem = errorLine("workshop-error");
  // Furniture (RFC 0016): its own list, under the goods, at a workbench only.
  const furnitureList = shelved("pieces");
  const furniture = h(
    "section",
    { class: "stack tight workshop-furniture", attrs: { "aria-labelledby": "workshop-furniture" } },
    h("h3", { class: "section-title", attrs: { id: "workshop-furniture" }, text: "Furniture" }),
    h("p", {
      class: "sheet-lede",
      text: "Made from wood and stone you gather. It stacks in your things; place it from Build, on the Furniture tab.",
    }),
    furnitureList.el,
  );
  furniture.hidden = true;
  // Neighbors within reach you could teach (RFC 0024): a row each, filled once their profiles say.
  const pupils = itemRows([], { className: "workshop-list" });
  const teach = h(
    "section",
    { class: "stack tight workshop-teach", attrs: { "aria-labelledby": "workshop-teach" } },
    h("h3", { class: "section-title", attrs: { id: "workshop-teach" }, text: "Teach a neighbor" }),
    pupils,
  );
  teach.hidden = true;
  // Recipes you don't know yet (RFC 0024): how many, and the way to the shop's Recipes shelf.
  const learnWords = h("span");
  const learn = h(
    "a",
    {
      class: "pill-button small workshop-learn",
      attrs: { href: "/shop#recipes", hidden: true },
    },
    learnWords,
    icon("arrow"),
  );
  const s = sheet(
    {
      id: "workshop-title",
      title: title(o.block),
      className: "workshop-sheet",
      closeOnBackdrop: true,
    },
    hint,
    reveal,
    glazeField,
    labelField,
    list,
    goods.el,
    finishes,
    furniture,
    learn,
    teach,
    problem,
    things,
  );
  const send = (action: Action) => {
    // Not connected: keep the sheet open and say so, rather than drop the tap.
    if (o.act(action) === undefined) {
      problem.textContent = "Not connected yet. Try again in a moment.";
      return;
    }
    closeOverlay(s.dialog);
  };
  /** A button, or an off one when `ok` is false: its row says why. */
  const button = (text: string, action: () => Action, ok = true) =>
    h("button", {
      class: ok ? "btn-primary small" : "pill-button small",
      attrs: { type: "button", disabled: !ok },
      text,
      on: { click: () => send(action()) },
    });

  function paint(data: InventoryResponse) {
    painted = data;
    const inv = data.inventory;
    if (!inv) {
      hint.textContent = "Growing, making, and gathering aren't open in this world yet.";
      return;
    }
    const { rules } = data;
    const held = new Map(inv.stacks.map((st) => [st.kind, st.count]));
    if (o.block === "kiln") {
      paintKiln(inv, rules, held);
      return;
    }
    if (o.block === "planter") {
      // Only the plot's owner, and whoever they share it with, plant and pick here.
      if (!o.yours) {
        hint.textContent = o.ownerName
          ? `This planter is on ${o.ownerName}'s plot. Only they and the people they share it with can plant or pick here.`
          : "This planter isn't on anyone's plot, so nobody can plant here.";
        list.replaceChildren(
          ...(o.planting
            ? [row(thingName(o.planting.crop), growthLine(o.planting.readyDay, inv.day), null)]
            : []),
        );
        return;
      }
      if (o.planting) {
        const ready = growthLine(o.planting.readyDay, inv.day);
        // The sim's own checks, so the sheet never disagrees with what harvest would answer.
        const ripe = isReady(o.planting.readyDay, inv.day);
        const full = !harvestFits(inv.size, o.planting.crop);
        hint.textContent = `${thingName(o.planting.crop)}: ${ready.toLowerCase()}.`;
        list.replaceChildren(
          row(
            thingName(o.planting.crop),
            ripe && full ? "Your bag is full. Make or give something first." : ready,
            button("Harvest", () => ({ type: "harvest", x: o.x, y: o.y }), ripe && !full),
          ),
        );
        return;
      }
      const seeds = inv.stacks.filter((st) => cropOfSeed(st.kind) !== undefined);
      hint.textContent =
        seeds.length > 0
          ? "Pick a seed to plant. It grows a little each day, at midnight UTC."
          : noSeedsHint(inv);
      list.replaceChildren(
        ...seeds.map((st) => {
          const crop = cropOfSeed(st.kind) as Crop;
          const info = ITEM_CATALOG.crops.find((c) => c.crop === crop);
          return row(
            thingName(crop),
            `${thingCount(st.kind, st.count)}. Ready in ${info?.days ?? "a few"} days.`,
            button("Plant", () => ({ type: "plant", x: o.x, y: o.y, seed: crop })),
          );
        }),
      );
      return;
    }
    const at: Station = o.block === "kitchen" ? "kitchen" : "workbench";
    const recipes = knownAt(ITEM_CATALOG.recipes, at, inv.recipes);
    const more = moreToLearn(ITEM_CATALOG.recipes, at, inv.recipes);
    learn.hidden = more === 0;
    learnWords.textContent = `${plural(more, "more recipe", "more recipes")} to learn`;
    const doneToday = inv.craftedToday >= rules.craftPerDay;
    hint.textContent = doneToday
      ? `You've made ${inv.craftedToday} things today, the most for one day. Come back tomorrow.`
      : `What you make here keeps your name. Up to ${rules.craftPerDay} a day.`;
    const recipeRow = (r: (typeof recipes)[number]) => {
      const short = missingLine(r.needs, (kind) => held.get(kind) ?? 0);
      const enough = short === null && !doneToday;
      // A sweet makes more than one: candy makes five (RFC 0022).
      const makes = r.makes ? `, and makes ${r.makes}` : "";
      return row(
        r.name,
        doneToday
          ? `You've made ${inv.craftedToday} today`
          : (short ?? `Uses ${needsLine(r.recipe)}${makes}`),
        button(
          "Make",
          () => {
            // Furniture and sweets stack, so they take no label.
            const text = r.furniture || r.sweet ? "" : label.value.trim();
            return {
              type: "craft",
              recipe: r.recipe,
              x: o.x,
              y: o.y,
              ...(text ? { label: text } : {}),
            };
          },
          enough,
        ),
        itemArt(r.recipe, { size: 32 }),
      );
    };
    const has = (kind: (typeof recipes)[number]["needs"][number]["kind"]) => held.get(kind) ?? 0;
    const made = recipeShelf(
      recipes.filter((r) => !r.furniture),
      has,
    );
    goods.fill(made.shown.map(recipeRow), made.more.map(recipeRow));
    const pieces = recipeShelf(
      recipes.filter((r) => r.furniture),
      has,
    );
    furnitureList.fill(pieces.shown.map(recipeRow), pieces.more.map(recipeRow));
    furniture.hidden = pieces.shown.length === 0;
  }

  /**
   * A kiln (RFC 0047): the pot firing in it with Take it out once it's ready, or, while it's empty,
   * the pots you know in the glaze picked, with Fire.
   */
  function paintKiln(
    inv: NonNullable<InventoryResponse["inventory"]>,
    rules: InventoryResponse["rules"],
    held: Map<string, number>,
  ) {
    const firing = o.firing;
    const busy = firing !== undefined || !o.yours || revealed !== null;
    const inKiln = inv.kilns?.find((k) => k.x === o.x && k.y === o.y)?.pot;
    paintFinishes(revealed?.glaze ?? inKiln?.glaze ?? glaze);
    reveal.hidden = revealed === null;
    if (revealed) {
      if (glazeField) glazeField.hidden = true;
      if (labelField) labelField.hidden = true;
      goods.el.hidden = true;
      list.hidden = true;
      learn.hidden = true;
      hint.textContent = "It's in your things now.";
      return;
    }
    if (glazeField) glazeField.hidden = busy;
    if (labelField) labelField.hidden = busy;
    goods.el.hidden = busy;
    list.hidden = !busy;
    if (firing) {
      const mine = firing.by === o.me;
      const pot = inv.kilns?.find((k) => k.x === o.x && k.y === o.y)?.pot;
      const ready = isReady(firing.readyDay, inv.day);
      const full = mine && inv.size >= rules.inventoryMax;
      const whose = mine ? "" : ` It goes back to ${o.loaderName ?? "whoever loaded it"}.`;
      hint.textContent = ready
        ? "The pot is ready. Its finish is rolled as the kiln opens, so nobody knows it until then."
        : mine
          ? "Your pot is firing. Nobody else sees what's in it."
          : "The kiln is firing. Nobody sees what's in it until it opens.";
      list.replaceChildren(
        row(
          // The pot by the name it comes out with, less the finish it hasn't got yet (RFC 0047).
          pot ? potName(pot) : "A pot",
          full
            ? "Your bag is full. Give or sell something first."
            : `${kilnLine(firing.readyDay, inv.day)}.${whose}`,
          o.yours ? takeOutButton(ready && !full) : null,
          pot ? thingPicture({ kind: pot.kind, glaze: pot.glaze }, { size: 32 }) : null,
        ),
      );
      return;
    }
    if (!o.yours) {
      hint.textContent = o.ownerName
        ? `This kiln is on ${o.ownerName}'s plot. Only they and the people they share it with can fire a pot here.`
        : "This kiln isn't on anyone's plot, so nobody can fire a pot here.";
      list.replaceChildren();
      return;
    }
    const pots = knownAt(ITEM_CATALOG.recipes, "kiln", inv.recipes);
    const more = moreToLearn(ITEM_CATALOG.recipes, "kiln", inv.recipes);
    learn.hidden = more === 0;
    learnWords.textContent = `${plural(more, "more pot", "more pots")} to learn`;
    const doneToday = inv.craftedToday >= rules.craftPerDay;
    hint.textContent = doneToday
      ? `You've made ${inv.craftedToday} things today, the most for one day. Come back tomorrow.`
      : "Pick a glaze and a pot. It fires overnight, and comes out tomorrow with a finish nobody can know until then.";
    const cost = GLAZE_COSTS[glaze];
    const potRow = (r: (typeof pots)[number]) => {
      const needs = cost ? [...r.needs, { kind: cost, count: 1 }] : r.needs;
      const short = missingLine(needs, (kind) => held.get(kind) ?? 0);
      const uses = needs.map((n) => thingCount(n.kind, n.count)).join(", ");
      return row(
        r.name,
        doneToday ? `You've made ${inv.craftedToday} today` : (short ?? `Uses ${uses}`),
        button(
          "Fire",
          () => {
            const text = label.value.trim();
            return {
              type: "craft",
              recipe: r.recipe,
              x: o.x,
              y: o.y,
              ...(glaze === "bare" ? {} : { glaze }),
              ...(text ? { label: text } : {}),
            };
          },
          short === null && !doneToday,
        ),
        thingPicture({ kind: r.recipe, glaze }, { size: 32 }),
      );
    };
    goods.fill(pots.map(potRow), []);
  }

  /**
   * Take it out (RFC 0047): sent over REST so its answer comes back here, where the pot it names
   * (`fired`) is shown as it came out. A refusal says why under the list.
   */
  function takeOutButton(ok: boolean): HTMLButtonElement {
    const b = h("button", {
      class: ok ? "btn-primary small" : "pill-button small",
      attrs: { type: "button", disabled: !ok },
      text: "Take it out",
    });
    b.addEventListener("click", async () => {
      problem.textContent = "";
      const r = await whileBusy(b, () => worldApi.act({ type: "harvest", x: o.x, y: o.y }));
      const why = actProblem(r);
      if (why) {
        problem.textContent = why;
        return;
      }
      delete o.firing;
      const fired = r.ok && r.data.ok ? r.data.fired : undefined;
      if (fired) showReveal(fired);
      void load(false);
    });
    return b;
  }

  /** The pot as it came out: its picture, its name, its finish's odds, and Fire another. */
  function showReveal(pot: FiredPot) {
    revealed = pot;
    const again = h("button", {
      class: "btn-primary",
      attrs: { type: "button" },
      text: "Fire another",
      on: {
        click: () => {
          revealed = null;
          if (painted) paint(painted);
        },
      },
    });
    reveal.dataset.finish = pot.finish;
    reveal.toggleAttribute("data-rare", RARE_FINISHES.includes(pot.finish));
    reveal.replaceChildren(
      h(
        "div",
        { class: "kiln-reveal-stage", attrs: { "aria-hidden": "true" } },
        h("div", { class: "kiln-reveal-mouth" }),
        h(
          "div",
          { class: "kiln-reveal-pot" },
          thingPicture({ kind: pot.kind, glaze: pot.glaze, finish: pot.finish }, { size: 112 }),
        ),
        h("div", { class: "kiln-reveal-door is-left" }),
        h("div", { class: "kiln-reveal-door is-right" }),
      ),
      h("p", { class: "eyebrow kiln-reveal-eyebrow", text: "Out of the kiln" }),
      h("h3", { class: "kiln-reveal-name", text: pot.name }),
      h("p", { class: "kiln-reveal-line", text: revealLine(pot.finish) }),
      again,
    );
    reveal.hidden = false;
  }

  /**
   * Read your things and fill the sheet. On opening, a resident with free picks at a kitchen or
   * workbench (RFC 0024) is asked to pick first, if the sheet is still open; picking the last one,
   * or Not now, brings this sheet back, read afresh.
   */
  async function load(askPicks: boolean) {
    const r = await inventoryApi.inventory();
    if (!r.ok) {
      hint.textContent = r.message;
      return;
    }
    const picks = r.data.inventory?.recipePicks ?? 0;
    if (askPicks && station && station !== "kiln" && picks > 0 && overlayShowing(s.dialog)) {
      const { openRecipePicks } = await import("./recipe-picks");
      const asked = await openRecipePicks({
        station,
        picks,
        over: s.dialog,
        done: () => {
          hint.textContent = "Looking in your things…";
          openOverlay(s.dialog);
          void load(false);
        },
      });
      if (asked) return;
    }
    paint(r.data);
    if (station && !neighborsAsked) {
      neighborsAsked = true;
      void askNeighbors();
    }
  }

  /** Whether this sheet has read its neighbors' profiles: once while it's open, not every paint. */
  let neighborsAsked = false;

  /** Who within reach doesn't know a recipe you do, read from their profiles. */
  async function askNeighbors() {
    const near = (o.neighbors ?? []).slice(0, NEIGHBORS_ASKED);
    if (near.length === 0) return;
    const { lessonsWith, openTeachSheet } = await import("./teach-sheet");
    const asked = await Promise.all(near.map(async (n) => ({ n, l: await lessonsWith(n.id) })));
    const rows = asked.flatMap(({ n, l }) => {
      if (!l || l.canLearn.length === 0) return [];
      const button = h("button", {
        class: "btn-primary small",
        attrs: { type: "button", "aria-label": `Teach ${n.name}` },
        text: "Teach",
        on: {
          click: () => {
            void openTeachSheet({ who: n, near: true, reach: o.reach ?? 0, lessons: l });
          },
        },
      });
      return [
        itemRow({
          className: "workshop-row",
          plain: true,
          attrs: { "data-pupil": n.id },
          name: n.kind === "agent" ? `${n.name} ⚙` : n.name,
          lines: [`Doesn't know ${listOf(l.canLearn.map((r) => recipeWords(r).toLowerCase()))}`],
          trail: button,
        }),
      ];
    });
    pupils.replaceChildren(...rows);
    teach.hidden = rows.length === 0;
  }

  openOverlay(s.dialog);
  void load(true);
}
