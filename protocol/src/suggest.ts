import { z } from "zod";

/**
 * "Did you mean" for request bodies: when an action type or a field name is a typo away from a
 * real one, name the real one so a caller can fix the call without rereading the docs.
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
    const meant = nearestName(key, missing);
    if (!meant) continue;
    const where = what ? ` for ${what}` : "";
    return {
      message: `Unknown field '${key}'${where}. Did you mean '${meant}'?`,
      didYouMean: meant,
    };
  }
  return undefined;
}
