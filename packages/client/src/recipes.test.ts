import { ITEM_CATALOG, type RecipeCardView } from "@terrakin/protocol";
import {
  BASE_RECIPES,
  CARD_RECIPES,
  HOLIDAY_RECIPES,
  RECIPE_NAMES,
  type RecipeName,
  recipeOf,
} from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { notificationLine } from "./notifications-view";
import { pickGroups } from "./recipe-picks";
import { cardLabel, recipesHint } from "./shop-view";
import {
  canTeachLine,
  knownAt,
  learnedLine,
  moreToLearn,
  newsLine,
  recipeWords,
  taughtLine,
} from "./things";

/**
 * Recipes you learn (RFC 0024) on the web: what a kitchen or workbench lists, how many more there
 * are to learn, the Recipes shelf's buttons, and the picks sheet's order.
 */

/** What a newcomer knows before any pick: the base and the holiday recipes. */
const NEWCOMER: RecipeName[] = [...BASE_RECIPES, ...HOLIDAY_RECIPES];
const names = (rs: readonly { recipe: string }[]) => rs.map((r) => r.recipe);

describe("a station's recipes", () => {
  it("lists only what you know, every fruit's jam under jam", () => {
    const kitchen = names(knownAt(ITEM_CATALOG.recipes, "kitchen", NEWCOMER));
    expect(kitchen).toContain("herb_tea");
    expect(kitchen).toContain("strawberry_jam");
    expect(kitchen).toContain("lemon_jam");
    expect(kitchen).toContain("candy");
    expect(kitchen).not.toContain("lemonade");
    expect(kitchen).not.toContain("chair");
    const bench = names(knownAt(ITEM_CATALOG.recipes, "workbench", [...NEWCOMER, "well"]));
    expect(bench).toEqual(expect.arrayContaining(["chair", "fishing_rod", "bouquet", "well"]));
    expect(bench).not.toContain("barrel");
  });

  it("counts what's left to learn at each station, each card once", () => {
    const at = (station: "kitchen" | "workbench") =>
      CARD_RECIPES.filter((r) =>
        ITEM_CATALOG.recipes.some((c) => c.station === station && recipeOf(c.recipe) === r),
      ).length;
    expect(moreToLearn(ITEM_CATALOG.recipes, "kitchen", NEWCOMER)).toBe(at("kitchen"));
    expect(moreToLearn(ITEM_CATALOG.recipes, "kitchen", NEWCOMER)).toBe(7);
    expect(moreToLearn(ITEM_CATALOG.recipes, "workbench", NEWCOMER)).toBe(9);
    expect(moreToLearn(ITEM_CATALOG.recipes, "kitchen", [...NEWCOMER, "lemonade"])).toBe(6);
  });

  it("changes nothing before recipes open, when everyone knows every recipe", () => {
    for (const station of ["kitchen", "workbench"] as const) {
      expect(knownAt(ITEM_CATALOG.recipes, station, RECIPE_NAMES)).toEqual(
        ITEM_CATALOG.recipes.filter((r) => r.station === station),
      );
      expect(moreToLearn(ITEM_CATALOG.recipes, station, RECIPE_NAMES)).toBe(0);
    }
  });
});

describe("learning one", () => {
  it("says what you learned, in words", () => {
    expect(recipeWords("lemonade")).toBe("Lemonade");
    expect(recipeWords("jam")).toBe("Jam");
    expect(learnedLine("tomato_sauce", "bought")).toBe("You learned tomato sauce.");
    expect(learnedLine("lemonade", "taught")).toBe("A neighbor taught you lemonade.");
  });

  it("toasts your own recipe_learned in the world, and nobody else's", () => {
    const event = {
      type: "recipe_learned",
      residentId: "r_me",
      recipe: "lemonade",
      how: "picked",
    } as const;
    expect(newsLine(event, "r_me")).toBe("You learned lemonade.");
    expect(newsLine(event, "r_someone")).toBeNull();
  });
});

describe("a lesson (phase 3)", () => {
  const names = new Map([
    ["r_ivy", "Ivy"],
    ["r_wren", "Wren"],
  ]);
  const nameOf = (id: string) => names.get(id);
  const lesson = {
    type: "recipe_learned",
    residentId: "r_wren",
    recipe: "lemonade",
    how: "taught",
    from: "r_ivy",
  } as const;

  it("names the teacher to the learner and the learner to the teacher, and nobody else hears", () => {
    expect(newsLine(lesson, "r_wren", nameOf)).toBe("Ivy taught you lemonade.");
    expect(newsLine(lesson, "r_ivy", nameOf)).toBe("You taught Wren lemonade.");
    expect(newsLine(lesson, "r_someone", nameOf)).toBeNull();
    // A name the world doesn't have yet reads as a neighbor.
    expect(newsLine(lesson, "r_wren")).toBe("A neighbor taught you lemonade.");
    expect(taughtLine("well")).toBe("You taught your neighbor well.");
  });

  it("says a recipe page taught you", () => {
    expect(learnedLine("tomato_sauce", "found")).toBe(
      "You found a recipe page for tomato sauce. You know it now.",
    );
  });

  it("says what a neighbor can teach you, in a list", () => {
    expect(canTeachLine("Ivy", [])).toBeNull();
    expect(canTeachLine("Ivy", ["lemonade"])).toBe("Ivy can teach you lemonade.");
    expect(canTeachLine("Ivy", ["lemonade", "tomato_sauce", "well"])).toBe(
      "Ivy can teach you lemonade, tomato sauce, and well.",
    );
  });

  it("says who taught you what in a notification", () => {
    expect(
      notificationLine({
        type: "recipe_taught",
        count: 1,
        recipe: "lemonade",
        actor: { name: "Clem" },
      }),
    ).toEqual({ who: "Clem", what: "taught you lemonade" });
  });
});

describe("the Recipes shelf", () => {
  it("offers Buy, a free pick, or says you know it", () => {
    const card = { price: 30 } as const;
    expect(cardLabel({ ...card, known: true }, 100, 2)).toEqual({
      text: "You know this",
      can: false,
    });
    expect(cardLabel({ ...card, known: false }, 0, 2)).toEqual({
      text: "Free pick",
      can: true,
      send: "pick",
    });
    expect(cardLabel({ ...card, known: false }, 30, 0)).toEqual({
      text: "Buy for 30 coins",
      can: true,
      send: "buy",
    });
    expect(cardLabel({ ...card, known: false }, 25, 0)).toEqual({
      text: "5 coins short",
      can: false,
    });
    // A visitor sees the price and nothing to press.
    expect(cardLabel(card, null, 0)).toEqual({ text: "30 coins", can: false });
  });

  it("mentions free picks only while you have them", () => {
    expect(recipesHint(2)).toContain("You have 2 free picks left");
    expect(recipesHint(0)).not.toContain("free pick");
  });
});

describe("the picks sheet", () => {
  const card = (makes: string, station: "kitchen" | "workbench", known = false) =>
    ({
      sku: `recipe:${makes}`,
      name: `${makes} recipe`,
      price: 20,
      section: "recipes",
      recipe: { station, makes, needs: [] },
      known,
    }) as unknown as RecipeCardView;

  it("puts the tapped station's cards first and leaves out what you know", () => {
    const cards = [
      card("barrel", "workbench"),
      card("lemonade", "kitchen", true),
      card("tomato_sauce", "kitchen"),
    ];
    const groups = pickGroups(cards, "workbench").map((g) => [
      g.station,
      names(g.cards.map((c) => ({ recipe: c.recipe.makes }))),
    ]);
    expect(groups).toEqual([
      ["workbench", ["barrel"]],
      ["kitchen", ["tomato_sauce"]],
    ]);
    expect(pickGroups([card("lemonade", "kitchen", true)], "kitchen")).toEqual([]);
  });
});
