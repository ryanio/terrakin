/**
 * A body's own offset, 0 to 1, from its id, so a crowd doesn't blink or breathe together. The same
 * id always gives the same offset.
 */
export function idPhase(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** How long a blink takes to close and open, in seconds. */
export const BLINK_SECONDS = 0.16;

/**
 * How far shut the eyes are at `seconds`, 0 open to 1 shut: a quick close and open every few
 * seconds, a little sooner or later for each `phase`.
 */
export function blinkAt(seconds: number, phase: number): number {
  const every = 3.2 + phase * 2.4;
  const t = (((seconds + phase * every) % every) + every) % every;
  return t < BLINK_SECONDS ? 1 - Math.abs((t / BLINK_SECONDS) * 2 - 1) : 0;
}

/** A slow breath at `seconds`, from -1 (out) to 1 (in), offset by `phase`. */
export function breathAt(seconds: number, phase: number): number {
  return Math.sin((seconds / 3.6 + phase) * Math.PI * 2);
}
