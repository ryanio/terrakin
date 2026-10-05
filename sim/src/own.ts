import type { Resident, WorldState } from "./types";

/**
 * What `record` holds under `key` as its own property, or undefined. Every lookup keyed by an id
 * from an input or a request goes through this (or `residentById`), so an id like `__proto__`,
 * `constructor`, or `toString` finds nothing instead of something every object inherits. Inputs
 * are logged, so an id that got through would do its damage again on every replay.
 */
export function own<T>(
  record: Readonly<Partial<Record<string, T>>> | undefined,
  key: unknown,
): T | undefined {
  return record !== undefined && typeof key === "string" && Object.hasOwn(record, key)
    ? record[key]
    : undefined;
}

/** The resident with this id, if there is one. */
export const residentById = (state: WorldState, id: unknown): Resident | undefined =>
  own(state.residents, id);

/**
 * Whether `key` can be a record's own key when written as `record[key] = value`: a string that
 * names nothing every object inherits (`__proto__` would set the record's prototype instead).
 */
export const isOwnableKey = (key: unknown): key is string =>
  typeof key === "string" && !(key in Object.prototype);
