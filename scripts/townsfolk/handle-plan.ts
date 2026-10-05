/**
 * What to do about one townsfolk resident's handle, from what the server says now. Pure, so the
 * tests feed it fixtures; handles.ts and seed.ts do the reading and the writing.
 */

/** What a handle step should do. */
export type HandleStep =
  /** They already have it. Nothing to send. */
  | { kind: "done"; handle: string }
  /** Claim it with `PUT /v1/profile {"handle": ...}`. `from` is the handle they give up, if any. */
  | { kind: "claim"; handle: string; from?: string }
  /** Someone else holds it, or held it recently. Leave it; a person picks another. */
  | { kind: "taken"; handle: string; by: string };

/**
 * `current` is the resident's handle now (from their profile), and `holder` the resident id that
 * `GET /v1/residents/by-handle/<want>` answers with, or null on a 404. A handle someone gave up
 * still resolves to them during the hold, so any other holder means the server would refuse.
 */
export function planHandle(
  residentId: string,
  want: string,
  current: string | undefined,
  holder: string | null,
): HandleStep {
  if (current === want) return { kind: "done", handle: want };
  if (holder !== null && holder !== residentId) return { kind: "taken", handle: want, by: holder };
  return current ? { kind: "claim", handle: want, from: current } : { kind: "claim", handle: want };
}

/** One line for the run's output. Ids and handles only, never a token. */
export function describeStep(step: HandleStep, send: boolean): string {
  switch (step.kind) {
    case "done":
      return `has @${step.handle}`;
    case "taken":
      return `@${step.handle} belongs to ${step.by}; skipped`;
    case "claim": {
      const what = step.from ? `@${step.handle} (giving up @${step.from})` : `@${step.handle}`;
      return send ? `claiming ${what}` : `would claim ${what}`;
    }
  }
}
