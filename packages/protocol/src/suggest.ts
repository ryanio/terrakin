import { MEDIA_ID_PATTERN } from "@terrakin/sim";
import { z } from "zod";
import { EventId } from "./events";
import { BountyId, GiftId, ItemId, ListingId } from "./schemas";

/**
 * "Did you mean" for request bodies: when an action type or a field name is a typo away from a
 * real one, name the real one so a caller can fix the call without rereading the docs. And plain
 * words for what failed to parse (`plainProblem`), with the choices a field takes and the one a
 * near miss meant.
 */

/** Longest name the matcher looks at. Longer input is never matched or echoed back. */
const MAX_NAME_LENGTH = 32;
/** Only identifier-like input is matched and echoed: letters, digits, `_`, and `-`. */
const NAME = /^[A-Za-z0-9_-]+$/;

/**
 * Edits between two strings: insert, delete, or change one character, or swap two neighbors
 * (optimal string alignment), so `mvoe` is one edit from `move`.
 */
export function editDistance(a: string, b: string): number {
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    const row: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) {
        row.push(j);
        continue;
      }
      const prev = rows[i - 1] as number[];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        (prev[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, (rows[i - 2]?.[j - 2] as number) + 1);
      }
      row.push(best);
    }
    rows.push(row);
  }
  return rows[a.length]?.[b.length] ?? Math.max(a.length, b.length);
}

/** Whether `input` is short and plain enough to match and to quote back in a message. */
export function isNameLike(input: unknown): input is string {
  return typeof input === "string" && input.length <= MAX_NAME_LENGTH && NAME.test(input);
}

/**
 * The name in `names` closest to `input`, when it's close enough to be a typo: at most a third of
 * the input's length in edits, never more than 2, and always 1 allowed. Case is ignored. Ties go to
 * the earlier name. Undefined when nothing is close, when `input` is already one of `names`, or
 * when `input` isn't name-like.
 */
export function nearestName(input: string, names: readonly string[]): string | undefined {
  if (!isNameLike(input) || names.includes(input)) return undefined;
  const limit = Math.min(2, Math.max(1, Math.floor(input.length / 3)));
  const lower = input.toLowerCase();
  let best: string | undefined;
  let bestDistance = limit + 1;
  for (const name of names) {
    const distance = editDistance(lower, name.toLowerCase());
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return best;
}

/** A plain message and the name the caller most likely meant. */
export interface Suggestion {
  message: string;
  didYouMean: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What a misspelled body most likely meant, or undefined. It looks at the action `type` of a
 * discriminated union (like `Action`) and at top-level field names: a field the schema doesn't
 * know that is a typo away from one it does, and that the body doesn't already send.
 */
export function suggestFor(schema: z.ZodType, raw: unknown): Suggestion | undefined {
  if (!isRecord(raw)) return undefined;
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const key = schema._zod.def.discriminator;
    const options = schema.options.filter((o): o is z.ZodObject => o instanceof z.ZodObject);
    const values = options.map((o) => literalOf(o.shape[key]));
    const sent = raw[key];
    const index = values.indexOf(typeof sent === "string" ? sent : undefined);
    const option = options[index];
    if (!option) {
      if (!isNameLike(sent)) return undefined;
      const known = values.filter((v): v is string => v !== undefined);
      const meant = nearestName(sent, known);
      if (!meant) return undefined;
      const noun = key === "type" ? "action" : key;
      return { message: `Unknown ${noun} '${sent}'. Did you mean '${meant}'?`, didYouMean: meant };
    }
    return fieldSuggestion(option, raw, typeof sent === "string" ? sent : undefined);
  }
  if (schema instanceof z.ZodObject) return fieldSuggestion(schema, raw);
  return undefined;
}

function literalOf(schema: unknown): string | undefined {
  if (!(schema instanceof z.ZodLiteral)) return undefined;
  const [value] = schema.values;
  return typeof value === "string" ? value : undefined;
}

function fieldSuggestion(
  schema: z.ZodObject,
  raw: Record<string, unknown>,
  what?: string,
): Suggestion | undefined {
  const fields = Object.keys(schema.shape);
  const missing = fields.filter((f) => !(f in raw));
  for (const key of Object.keys(raw)) {
    if (fields.includes(key)) continue;
    // `dry_run`, `dryRun`, and the like are too far from `dry` for the typo match, but dropping
    // them would do the action for real.
    const dryLike = isNameLike(key) && key.toLowerCase().replace(/[-_]/g, "").startsWith("dry");
    const meant = dryLike && missing.includes("dry") ? "dry" : nearestName(key, missing);
    if (!meant) continue;
    const where = what ? ` for ${what}` : "";
    return {
      message: `Unknown field '${key}'${where}. Did you mean '${meant}'?`,
      didYouMean: meant,
    };
  }
  return undefined;
}

// ---------- plain words for what failed to parse ----------

/** A zod issue: the parts `plainProblem` reads. */
export interface Issue {
  path: readonly PropertyKey[];
  message: string;
  code?: string;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  inclusive?: boolean;
  expected?: string;
  keys?: readonly string[];
}

/** A parse failure in plain words: one sentence per problem, and the value most likely meant. */
export interface PlainProblem {
  lines: string[];
  didYouMean?: string;
}

/** What a field takes when it's a fixed set: names, and forms like an id. */
interface Choices {
  values: string[];
  forms: string[];
}

/** The regex a string schema checks, if it checks one. */
function patternOf(schema: z.ZodType): RegExp | undefined {
  for (const check of schema._zod.def.checks ?? []) {
    const def = check._zod.def as { format?: string; pattern?: unknown };
    if (def.format === "regex" && def.pattern instanceof RegExp) return def.pattern;
  }
  return undefined;
}

/** Ids in words, by the pattern their schema checks. */
const ID_FORMS: readonly (readonly [RegExp | undefined, string])[] = [
  [patternOf(ItemId), "a made thing's id from your things, like `i_12`"],
  [patternOf(GiftId), "a gift's id, like `gift_3`"],
  [patternOf(ListingId), "a listing's id, like `l_4`"],
  [patternOf(BountyId), "a bounty's id, like `b_2`"],
  [patternOf(EventId), "an event's id, like `e_1`"],
  [MEDIA_ID_PATTERN, "an upload's id, `m_` and 16 hex digits"],
];

/** Wrappers that don't change which values a field takes: optional, nullable, defaults, pipes. */
function bare(schema: z.ZodType): z.ZodType {
  let s = schema;
  for (let depth = 0; depth < 16; depth++) {
    if (
      s instanceof z.ZodOptional ||
      s instanceof z.ZodNullable ||
      s instanceof z.ZodDefault ||
      s instanceof z.ZodReadonly
    ) {
      s = s._zod.def.innerType as z.ZodType;
    } else if (s instanceof z.ZodPipe) {
      // A transform's input is what was sent; a pipe into a schema checks that schema next.
      const { in: input, out } = s._zod.def;
      s = (out instanceof z.ZodTransform ? input : out) as z.ZodType;
    } else {
      return s;
    }
  }
  return s;
}

const strings = (values: Iterable<unknown>) =>
  [...values].filter((v): v is string => typeof v === "string");

/** The names and forms a field takes, or undefined when it isn't a fixed set. */
function choicesOf(schema: z.ZodType): Choices | undefined {
  const s = bare(schema);
  if (s instanceof z.ZodEnum) return { values: strings(s.options), forms: [] };
  if (s instanceof z.ZodLiteral) {
    const values = strings(s.values);
    return values.length > 0 ? { values, forms: [] } : undefined;
  }
  if (s instanceof z.ZodString) {
    const pattern = patternOf(s)?.source;
    const form = ID_FORMS.find(([p]) => p?.source === pattern)?.[1];
    return form ? { values: [], forms: [form] } : undefined;
  }
  if (s instanceof z.ZodUnion && !(s instanceof z.ZodDiscriminatedUnion)) {
    const parts = (s.options as z.ZodType[]).map(choicesOf);
    if (parts.some((p) => p === undefined)) return undefined;
    const all = parts as Choices[];
    return {
      values: [...new Set(all.flatMap((p) => p.values))],
      forms: [...new Set(all.flatMap((p) => p.forms))],
    };
  }
  return undefined;
}

/** The literal values a discriminated union's option takes for its discriminator. */
const tagsOf = (option: z.ZodObject, tag: string) => {
  const field = option.shape[tag];
  return field instanceof z.ZodLiteral ? strings(field.values) : [];
};

/**
 * The schema a path names inside `schema`, following the option `raw` picked in a discriminated
 * union, or the choices of the discriminator itself. Undefined where the path leaves what it can
 * follow.
 */
function fieldAt(
  schema: z.ZodType,
  raw: unknown,
  path: readonly PropertyKey[],
): z.ZodType | Choices | undefined {
  let s = bare(schema);
  let value = raw;
  for (const key of path) {
    if (s instanceof z.ZodDiscriminatedUnion) {
      const tag = s._zod.def.discriminator;
      const options = (s.options as z.ZodType[]).filter(
        (o): o is z.ZodObject => o instanceof z.ZodObject,
      );
      if (key === tag) return { values: options.flatMap((o) => tagsOf(o, tag)), forms: [] };
      const sent = isRecord(value) ? value[tag] : undefined;
      const option = options.find((o) => typeof sent === "string" && tagsOf(o, tag).includes(sent));
      if (!option) return undefined;
      s = option;
    }
    if (s instanceof z.ZodObject && typeof key === "string" && Object.hasOwn(s.shape, key)) {
      s = bare(s.shape[key] as z.ZodType);
      value = isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
    } else if (s instanceof z.ZodArray && typeof key === "number") {
      s = bare(s.element as z.ZodType);
      value = Array.isArray(value) ? value[key] : undefined;
    } else {
      return undefined;
    }
  }
  return s;
}

/**
 * What was sent at a path: the value, or whether the last key was left out. A path through
 * something a transform reshapes (a comma-separated list) is neither.
 */
function sentAt(
  raw: unknown,
  path: readonly PropertyKey[],
): { value: unknown } | "missing" | "unknown" {
  let value = raw;
  for (const [i, key] of path.entries()) {
    const last = i === path.length - 1;
    if (Array.isArray(value) && typeof key === "number") {
      if (key >= value.length) return last ? "missing" : "unknown";
      value = value[key];
    } else if (isRecord(value) && typeof key === "string") {
      if (!Object.hasOwn(value, key)) return last ? "missing" : "unknown";
      value = value[key];
    } else {
      return "unknown";
    }
  }
  return value === undefined ? "missing" : { value };
}

/** `blocks[0].block`: a path the way a caller would write it. */
function pathName(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path)
    out += typeof key === "number" ? `[${key}]` : `${out ? "." : ""}${String(key)}`;
  return out;
}

/** "one of: a, b", "a made thing's id, like `i_12`", or both. */
function choiceWords({ values, forms }: Choices): string {
  const list = values.length > 0 ? `one of: ${values.join(", ")}` : "";
  return [...forms, list].filter(Boolean).join(", or ");
}

/** Most choices a "did you mean one of" names, so a long list never comes back twice. */
const MEANT_MAX = 5;

/**
 * What a value outside `values` most likely meant: a name a typo away (`nearestName`), else the
 * names that share a whole word with it (`pumpkin_seed` and `pumpkin`, `jam` and `lemon_jam`),
 * one or a few. Only name-like input is matched.
 */
function meant(sent: unknown, values: readonly string[]): string[] {
  if (!isNameLike(sent) || values.length === 0) return [];
  const near = nearestName(sent, values);
  if (near) return [near];
  const words = new Set(sent.toLowerCase().split(/[_-]+/).filter(Boolean));
  const hits = values.filter((v) =>
    v
      .toLowerCase()
      .split("_")
      .some((w) => words.has(w)),
  );
  return hits.length <= MEANT_MAX ? hits : [];
}

/** Words for the expected type of a value sent as the wrong type. */
const TYPE_WORDS: Readonly<Record<string, string>> = {
  string: "text",
  number: "a number",
  int: "a whole number",
  boolean: "true or false",
  array: "a list",
  object: "an object",
};

/** Why a value is too small or too big, by what it is: a string, a number, or a list. */
function sizeWords(issue: Issue, name: string): string | undefined {
  const exclusive = issue.inclusive === false;
  if (issue.code === "too_small" && issue.minimum !== undefined) {
    const n = Number(issue.minimum);
    if (issue.origin === "string") {
      return n <= 1
        ? `${name} can't be empty.`
        : `${name} is too short. Use at least ${n} characters.`;
    }
    if (issue.origin === "array" || issue.origin === "set") {
      return `${name} needs at least ${n === 1 ? "one" : n}.`;
    }
    return `${name} must be ${exclusive ? "more than" : "at least"} ${n}.`;
  }
  if (issue.code === "too_big" && issue.maximum !== undefined) {
    const n = Number(issue.maximum);
    if (issue.origin === "string") return `${name} is too long. Use at most ${n} characters.`;
    if (issue.origin === "array" || issue.origin === "set") return `${name} holds at most ${n}.`;
    return `${name} must be ${exclusive ? "less than" : "at most"} ${n}.`;
  }
  return undefined;
}

/** One problem in plain words, and the value it most likely meant. */
function issueWords(
  schema: z.ZodType,
  raw: unknown,
  issue: Issue,
): { line: string; meant: string[] } {
  const field = pathName(issue.path);
  const name = field ? `\`${field}\`` : "The input";
  const found = fieldAt(schema, raw, issue.path);
  const choices = found === undefined || "values" in found ? found : choicesOf(found);
  const sent = sentAt(raw, issue.path);
  if (sent === "missing") {
    return {
      line: choices ? `${name} is missing. Use ${choiceWords(choices)}.` : `${name} is missing.`,
      meant: [],
    };
  }
  const wrong = ["invalid_value", "invalid_union", "invalid_format", "invalid_type"];
  if (choices && issue.code !== undefined && wrong.includes(issue.code)) {
    const guesses = typeof sent === "object" ? meant(sent.value, choices.values) : [];
    const guess =
      guesses.length === 1
        ? ` Did you mean '${guesses[0]}'?`
        : guesses.length > 1
          ? ` Did you mean one of: ${guesses.join(", ")}?`
          : "";
    return { line: `${name} must be ${choiceWords(choices)}.${guess}`, meant: guesses };
  }
  const size = sizeWords(issue, name);
  if (size) return { line: size, meant: [] };
  if (issue.code === "invalid_type" && issue.expected && TYPE_WORDS[issue.expected]) {
    return { line: `${name} must be ${TYPE_WORDS[issue.expected]}.`, meant: [] };
  }
  if (issue.code === "unrecognized_keys" && issue.keys) {
    const keys = issue.keys.filter(isNameLike);
    const fields = found instanceof z.ZodObject ? Object.keys(found.shape) : [];
    const guess = keys.length === 1 ? nearestName(keys[0] as string, fields) : undefined;
    const which = keys.length > 0 ? `: ${keys.map((k) => `\`${k}\``).join(", ")}` : "";
    return {
      line: `${name} has fields it doesn't take${which}.${guess ? ` Did you mean '${guess}'?` : ""}`,
      meant: guess ? [guess] : [],
    };
  }
  return { line: `${name}: ${issue.message}`, meant: [] };
}

/**
 * Why `raw` failed to parse as `schema`, in plain words: a sentence per problem. A field with a
 * fixed set of choices (an enum, a literal, an id, or a union of them, like `give`'s `item`) names
 * them, and the first value a typo or a shared word away from one names it as `didYouMean`
 * (`pumpkin_seed` meant `pumpkin`). Only name-like input is matched or quoted back.
 */
export function plainProblem(
  schema: z.ZodType,
  raw: unknown,
  issues: readonly Issue[],
): PlainProblem {
  const lines: string[] = [];
  let didYouMean: string | undefined;
  for (const issue of issues) {
    const { line, meant: guesses } = issueWords(schema, raw, issue);
    if (!lines.includes(line)) lines.push(line);
    if (didYouMean === undefined && guesses.length === 1) didYouMean = guesses[0];
  }
  return didYouMean === undefined ? { lines } : { lines, didYouMean };
}
