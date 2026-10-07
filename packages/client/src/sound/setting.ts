/**
 * The world's sound setting (decision 0097): off, on, or on and quiet, remembered on this device.
 * It's off until someone turns it on. Storage can be missing or blocked (private windows, blocked
 * site data), so every read and write gives up quietly, and tests pass a storage of their own.
 */

/** The levels the speaker button steps through, in order: each tap goes to the next. */
const SOUND_LEVELS = ["off", "on", "quiet"] as const;
export type SoundLevel = (typeof SOUND_LEVELS)[number];

export const SOUND_KEY = "terrakin.sound";

/** How loud each level plays, as a gain on the whole mix. Quiet is about 8 dB down. */
export const LEVEL_GAIN: Readonly<Record<SoundLevel, number>> = { off: 0, on: 1, quiet: 0.4 };

/** The speaker button's name at each level. Pressed shows whether sound is on at all. */
export const LEVEL_LABEL: Readonly<Record<SoundLevel, string>> = {
  off: "Sound",
  on: "Sound",
  quiet: "Sound, quiet",
};

/** The level after this one: off, on, quiet, and back to off. */
export function nextLevel(level: SoundLevel): SoundLevel {
  return SOUND_LEVELS[(SOUND_LEVELS.indexOf(level) + 1) % SOUND_LEVELS.length] ?? "off";
}

type LevelStore = Pick<Storage, "getItem" | "setItem">;

function local(): LevelStore | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The level this device chose last, or off if it never chose or storage can't be read. */
export function savedLevel(store: LevelStore | undefined = local()): SoundLevel {
  try {
    const saved = store?.getItem(SOUND_KEY);
    return SOUND_LEVELS.find((level) => level === saved) ?? "off";
  } catch {
    return "off";
  }
}

export function saveLevel(level: SoundLevel, store: LevelStore | undefined = local()): void {
  try {
    store?.setItem(SOUND_KEY, level);
  } catch {
    // No storage: the choice lasts until the page closes.
  }
}
