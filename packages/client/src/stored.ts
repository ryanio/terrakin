/**
 * This device's localStorage, for what's worth keeping between visits and fine to lose. None of
 * these throw: with storage off (a private window, a blocked site) a read finds nothing and a
 * write or a removal does nothing, so the choice lasts only as long as the page.
 */

/** The value saved under `key`, or null when there's none or storage is off. */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The JSON saved under `key`, or undefined when there's none, it isn't JSON, or storage is off. */
export function readStoredJson(key: string): unknown {
  const raw = readStored(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Save `value` under `key`, if storage will take it. */
export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage off or full: the value lasts until the page closes.
  }
}

/** Forget what's saved under `key`. */
export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage off: there's nothing saved to forget.
  }
}
