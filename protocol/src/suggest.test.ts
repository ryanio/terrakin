import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ACTION_TYPES, Action, CreateSessionRequest } from "./schemas";
import { editDistance, nearestName, plainProblem, suggestFor } from "./suggest";

describe("editDistance", () => {
  it("counts inserts, deletes, changes, and a swap of neighbors as one edit each", () => {
    expect(editDistance("move", "move")).toBe(0);
    expect(editDistance("mvoe", "move")).toBe(1);
    expect(editDistance("mov", "move")).toBe(1);
    expect(editDistance("moove", "move")).toBe(1);
    expect(editDistance("mave", "move")).toBe(1);
    expect(editDistance("", "home")).toBe(4);
    expect(editDistance("claim", "place")).toBe(3);
  });
});

describe("nearestName", () => {
  it("suggests a name a typo away", () => {
    expect(nearestName("mvoe", ACTION_TYPES)).toBe("move");
    expect(nearestName("set-hearth", ACTION_TYPES)).toBe("set_hearth");
    expect(nearestName("sethearth", ACTION_TYPES)).toBe("set_hearth");
    expect(nearestName("Settle", ACTION_TYPES)).toBe("settle");
    expect(nearestName("build_starter_hom", ACTION_TYPES)).toBe("build_starter_home");
  });

  it("stays quiet when nothing is close, the name is right, or the input isn't a short name", () => {
    expect(nearestName("fly", ACTION_TYPES)).toBeUndefined();
    expect(nearestName("teleport", ACTION_TYPES)).toBeUndefined();
    expect(nearestName("move", ACTION_TYPES)).toBeUndefined();
    expect(nearestName("mo ve", ACTION_TYPES)).toBeUndefined();
    expect(nearestName(`move${"e".repeat(40)}`, ACTION_TYPES)).toBeUndefined();
    expect(nearestName("<b>move", ACTION_TYPES)).toBeUndefined();
  });

  it("allows one edit for short names and at most two for long ones", () => {
    expect(nearestName("mv", ["move"])).toBeUndefined();
    expect(nearestName("hme", ["home"])).toBe("home");
    expect(nearestName("buld_strter_home", ["build_starter_home"])).toBe("build_starter_home");
    expect(nearestName("bld_strtr_home", ["build_starter_home"])).toBeUndefined();
  });

  it("breaks ties by the order of the names", () => {
    expect(nearestName("cat", ["bat", "hat"])).toBe("bat");
    expect(nearestName("cat", ["hat", "bat"])).toBe("hat");
  });
});

describe("suggestFor", () => {
  it("names the action type that was meant", () => {
    expect(suggestFor(Action, { type: "mvoe", dir: "n" })).toEqual({
      message: "Unknown action 'mvoe'. Did you mean 'move'?",
      didYouMean: "move",
    });
    expect(suggestFor(Action, { type: "jump" })).toBeUndefined();
    expect(suggestFor(Action, { type: 7 })).toBeUndefined();
  });

  it("names the field that was meant, only when the real one is missing", () => {
    expect(suggestFor(Action, { type: "place", x: 1, y: 2, blok: "wood" })).toEqual({
      message: "Unknown field 'blok' for place. Did you mean 'block'?",
      didYouMean: "block",
    });
    expect(suggestFor(Action, { type: "chat", text: "hi", chanel: "world" })?.didYouMean).toBe(
      "channel",
    );
    expect(suggestFor(Action, { type: "move", dir: "n", dyr: true })?.didYouMean).toBe("dry");
    // The spellings agents guess for `dry` are too far for the typo match, and still caught.
    for (const key of ["dry_run", "dryRun", "dryrun", "dry-run", "DRY_RUN"]) {
      expect(suggestFor(Action, { type: "move", dir: "n", [key]: true })).toEqual({
        message: `Unknown field '${key}' for move. Did you mean 'dry'?`,
        didYouMean: "dry",
      });
    }
    expect(
      suggestFor(Action, { type: "move", dir: "n", dry: true, dry_run: true }),
    ).toBeUndefined();
    expect(
      suggestFor(CreateSessionRequest, { name: "Wren", kind: "agent", dryRun: 1 }),
    ).toBeUndefined();
    // `dir` is already there, so `dirr` is junk, not a typo for it.
    expect(suggestFor(Action, { type: "move", dir: "n", dirr: "s" })).toBeUndefined();
    expect(suggestFor(Action, { type: "move", dir: "n", requestId: "a1" })).toBeUndefined();
  });

  it("works on plain object bodies, and ignores anything that isn't an object", () => {
    expect(suggestFor(CreateSessionRequest, { nmae: "Wren", kind: "agent" })).toEqual({
      message: "Unknown field 'nmae'. Did you mean 'name'?",
      didYouMean: "name",
    });
    expect(suggestFor(Action, null)).toBeUndefined();
    expect(suggestFor(Action, ["move"])).toBeUndefined();
    expect(suggestFor(z.string(), { a: 1 })).toBeUndefined();
  });
});

describe("plainProblem", () => {
  /** What `raw` gets when it fails to parse as `schema`. */
  const words = (schema: z.ZodType, raw: unknown) => {
    const parsed = schema.safeParse(raw);
    if (parsed.success) throw new Error(`${JSON.stringify(raw)} parsed`);
    return plainProblem(schema, raw, parsed.error.issues);
  };

  it("says what's wrong in words a reader can act on", () => {
    const schema = z.object({
      name: z.string().min(1).max(24),
      note: z.string().max(80).optional(),
      count: z.number().int().min(1).max(50).optional(),
      tags: z.array(z.string()).max(2).optional(),
      on: z.boolean().optional(),
    });
    const lines = (raw: unknown) => words(schema, raw).lines;
    expect(lines({})).toEqual(["`name` is missing."]);
    expect(lines({ name: "" })).toEqual(["`name` can't be empty."]);
    expect(lines({ name: 7 })).toEqual(["`name` must be text."]);
    expect(lines({ name: "W", note: "x".repeat(81) })).toEqual([
      "`note` is too long. Use at most 80 characters.",
    ]);
    expect(lines({ name: "W", count: 0 })).toEqual(["`count` must be at least 1."]);
    expect(lines({ name: "W", count: 51 })).toEqual(["`count` must be at most 50."]);
    expect(lines({ name: "W", count: 1.5 })).toEqual(["`count` must be a whole number."]);
    expect(lines({ name: "W", tags: ["a", "b", "c"] })).toEqual(["`tags` holds at most 2."]);
    expect(lines({ name: "W", on: "yes" })).toEqual(["`on` must be true or false."]);
    expect(
      words(
        z.string().refine(() => false, "Odd"),
        "x",
      ).lines,
    ).toEqual(["The input: Odd"]);
  });

  it("names the choices of every enum field in every action, and the one a near miss meant", () => {
    let fields = 0;
    for (const option of Action.options) {
      const type = option.shape.type.value;
      for (const { path, values } of enumFields(option)) {
        if (path[0] === "type") continue;
        fields++;
        const where = `${type} ${path.join(".")}`;
        const far = words(Action, placed({ type }, path, "zzzz"));
        expect(far.lines.join(" "), where).toContain(`one of: ${values.join(", ")}.`);
        expect(far.didYouMean, where).toBeUndefined();
        const near = words(Action, placed({ type }, path, `${values[0]}x`));
        expect(near.didYouMean, where).toBe(values[0]);
      }
    }
    expect(fields).toBeGreaterThan(30);
  });

  it("names what a value shares a word with, and ids in words", () => {
    const plant = words(Action, { type: "plant", x: 1, y: 1, seed: "pumpkin_seed" });
    expect(plant).toEqual({
      lines: [
        "`seed` must be one of: lemon, strawberry, tomato, herb, flower, pumpkin, pomegranate. Did you mean 'pumpkin'?",
      ],
      didYouMean: "pumpkin",
    });
    expect(words(Action, { type: "treat_pet", owner: "r_1", item: "herb_tea" }).didYouMean).toBe(
      "herb",
    );
    // Several jams share the word: they're named, and none is picked for you.
    const jam = words(Action, { type: "craft", recipe: "jam", x: 1, y: 1 });
    expect(jam.didYouMean).toBeUndefined();
    expect(jam.lines[0]).toMatch(/Did you mean one of: lemon_jam, strawberry_jam, [a-z_, ]+\?$/);
    expect(words(Action, { type: "display", item: "chair", x: 1, y: 1 }).lines).toEqual([
      "`item` must be a made thing's id from your things, like `i_12`.",
    ]);
    // `give` takes a made thing's id or a kind: both are named, and a typo of a kind is caught.
    const give = words(Action, { type: "give", item: "chiar", to: "r_1" });
    expect(give.lines[0]).toMatch(/^`item` must be a made thing's id .*, or one of: lemon_seed, /);
    expect(give.didYouMean).toBe("chair");
    expect(
      words(Action, { type: "build", px: 0, py: 0, blocks: [{ x: 1, y: 1, block: "woood" }] })
        .lines,
    ).toEqual([expect.stringMatching(/^`blocks\[0\]\.block` must be one of: wood, /)]);
  });

  it("never matches or quotes back what isn't a short name", () => {
    for (const seed of ["<b>pumpkin", "pumpkin seed", `pumpkin_${"x".repeat(40)}`]) {
      const plant = words(Action, { type: "plant", x: 1, y: 1, seed });
      expect(plant.didYouMean).toBeUndefined();
      expect(plant.lines.join(" ")).not.toContain(seed);
    }
  });
});

/** Optional, nullable, and default wrappers off. */
function unwrapped(schema: z.ZodType): z.ZodType {
  let s = schema;
  while (s instanceof z.ZodOptional || s instanceof z.ZodNullable || s instanceof z.ZodDefault) {
    s = s._zod.def.innerType as z.ZodType;
  }
  return s;
}

/** Every field of `schema` that takes a fixed set of names (an enum, or a union with one in it). */
function* enumFields(
  schema: z.ZodType,
  path: (string | number)[] = [],
): Generator<{ path: (string | number)[]; values: string[] }> {
  const s = unwrapped(schema);
  if (s instanceof z.ZodEnum) yield { path, values: s.options.map(String) };
  else if (s instanceof z.ZodObject) {
    for (const [key, field] of Object.entries(s.shape)) yield* enumFields(field, [...path, key]);
  } else if (s instanceof z.ZodArray) yield* enumFields(s.element as z.ZodType, [...path, 0]);
  else if (s instanceof z.ZodDiscriminatedUnion) {
    const tag = s._zod.def.discriminator;
    const tags = (s.options as z.ZodObject[]).flatMap((o) =>
      [...(o.shape[tag] as z.ZodLiteral).values].map(String),
    );
    yield { path: [...path, tag], values: tags };
  } else if (s instanceof z.ZodUnion) {
    const enums = (s.options as z.ZodType[]).filter((o) => o instanceof z.ZodEnum);
    if (enums.length > 0) yield { path, values: enums.flatMap((o) => o.options.map(String)) };
  }
}

/** `base` with `value` at `path`, building the objects and lists on the way. */
function placed(base: Record<string, unknown>, path: (string | number)[], value: unknown) {
  const out: Record<string, unknown> = { ...base };
  let at: Record<string | number, unknown> = out;
  for (const [i, key] of path.entries()) {
    const next = path[i + 1];
    if (next === undefined) {
      at[key] = value;
      break;
    }
    const child = (typeof next === "number" ? [] : {}) as Record<string | number, unknown>;
    at[key] = child;
    at = child;
  }
  return out;
}
