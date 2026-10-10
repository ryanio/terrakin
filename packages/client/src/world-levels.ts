/**
 * Levels in the world (RFC 0029), from events the server already sent. Your own `progress` shows
 * "+2 Growing" over your figure for a moment (`#world-gain`; it rises and fades, or under reduced
 * motion just shows and goes). Anyone's `level_reached` puts a sparkle over their figure, which
 * everyone who has them on screen sees, and yours also toasts what you reached and what it
 * unlocked. Nothing here decides anything: the words come from `levels.ts`.
 */
import type { WorldEvent } from "@terrakin/protocol";
import { replay } from "@terrakin/ui/motion";
import { gainLine, myLevelToast } from "./levels";

/** How long the points stay over your figure. The CSS animation runs as long. */
const GAIN_MS = 1800;
/**
 * How long to wait after your `level_reached` before saying so: its `progress`, which says what
 * the level unlocked, is private and arrives just after it.
 */
const SETTLE_MS = 250;

type Gain = Extract<WorldEvent, { type: "progress" }>;
type Reached = Extract<WorldEvent, { type: "level_reached" }>;

export interface WorldLevels {
  /** An event the mirror applied, with its `seq`. `me` is your id once you're in. */
  heard(seq: number, event: WorldEvent, me: string | undefined, now: number): void;
  /** Each frame: where your figure's head is drawn on the page, if it is. */
  paint(spot: { x: number; y: number } | undefined, now: number): void;
  /** You left the world: nothing is left showing or waiting. */
  reset(): void;
}

export function worldLevels(o: {
  /** `#world-gain`, static in index.html. */
  el: HTMLElement;
  /** Say a line as one of the world's own notices. */
  toast: (line: string) => void;
  /** Sparkle over a resident's figure. */
  sparkle: (residentId: string, now: number) => void;
}): WorldLevels {
  let gainAt = Number.NEGATIVE_INFINITY;
  /** Points that came in since the last frame: shown once `paint` has put them over your figure. */
  let fresh = false;
  /** Your latest gains, each with the input it came from. */
  let gains: { seq: number; event: Gain }[] = [];
  /** Your levels reached, by input, until they're said. */
  const reached = new Map<number, Reached[]>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const say = (seq: number, me: string) => {
    const mine = reached.get(seq) ?? [];
    reached.delete(seq);
    const line = myLevelToast(
      [...mine, ...gains.filter((g) => g.seq === seq).map((g) => g.event)],
      me,
    );
    if (line) o.toast(line);
  };

  return {
    heard(seq, event, me, now) {
      if (event.type === "level_reached") {
        o.sparkle(event.residentId, now);
        if (event.residentId !== me) return;
        const list = reached.get(seq) ?? [];
        list.push(event);
        reached.set(seq, list);
        if (list.length > 1) return;
        const timer = setTimeout(() => {
          timers.delete(timer);
          say(seq, me);
        }, SETTLE_MS);
        timers.add(timer);
      } else if (event.type === "progress" && event.residentId === me) {
        gains = [...gains.slice(-7), { seq, event }];
        o.el.textContent = gainLine(event);
        gainAt = now;
        fresh = true;
      }
    },
    paint(spot, now) {
      if (o.el.hidden && !fresh) return;
      if (!spot || now - gainAt > GAIN_MS) {
        o.el.hidden = true;
        fresh = false;
        return;
      }
      o.el.style.setProperty("--gain-x", `${Math.round(spot.x)}px`);
      o.el.style.setProperty("--gain-y", `${Math.round(spot.y)}px`);
      if (!fresh) return;
      // Shown only now, so its first frame is already over your figure.
      fresh = false;
      o.el.hidden = false;
      replay(o.el, "rise");
    },
    reset() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      reached.clear();
      gains = [];
      fresh = false;
      o.el.hidden = true;
    },
  };
}
