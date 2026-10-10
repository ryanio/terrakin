/**
 * The speaker button and the audio context behind it (decision 0097). Sound is off until someone
 * taps the button, and that tap is the one browsers want before a page makes a sound: the context
 * is made inside it, never before. The choice is remembered on this device; when it was on, the
 * world waits for your first tap or key anywhere and starts again then. The sound code
 * (`soundscape.ts` and what it imports) loads with `import()` the first time sound plays. While
 * the page is hidden, or you've left the world, the mix fades out and the context is suspended;
 * it resumes when you're back.
 */
import type { GestureKind, WorldEvent } from "@terrakin/protocol";
import type { GroundKind } from "@terrakin/sim";
import {
  LEVEL_GAIN,
  LEVEL_LABEL,
  nextLevel,
  type SoundLevel,
  savedLevel,
  saveLevel,
} from "./setting";
import type { Ambience, Soundscape } from "./soundscape";

/** How long the mix fades out before the context is suspended, in ms. */
const FADE_MS = 500;
/** What counts as the tap or key browsers want before audio starts. */
const GESTURES = ["pointerup", "keydown"] as const;

/** Off, waiting for a tap to start, playing, or paused while you're away or the page is hidden. */
export type SoundState = "off" | "waiting" | "playing" | "paused";

/**
 * Where the browser lets a page say so (Safari's audio session), this is ambient sound: it mixes
 * with whatever else is playing instead of stopping it, and keeps to the phone's silent switch.
 */
function ambientSession() {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  try {
    if (session) session.type = "ambient";
  } catch {
    // Not settable here: the browser's own default stands.
  }
}

/** Older iPhones start a context only once something has played inside the tap: one silent sample. */
function unlock(ctx: AudioContext) {
  const src = ctx.createBufferSource();
  src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  src.connect(ctx.destination);
  src.start();
}

export class SoundSwitch {
  private level: SoundLevel = savedLevel();
  private ctx: AudioContext | undefined;
  private engine: Soundscape | undefined;
  private loading = false;
  private inWorld = false;
  private armed = false;
  /** A tap on the speaker already tried to start sound that was waiting: the next one steps on. */
  private tried = false;
  private fading: ReturnType<typeof setTimeout> | undefined;
  private ambient: Ambience | undefined;

  constructor(private readonly button: HTMLButtonElement) {
    button.addEventListener("click", () => this.tap());
    document.addEventListener("visibilitychange", () => this.update(false));
    this.paint();
  }

  get state(): SoundState {
    if (this.level === "off") return "off";
    if (!this.inWorld || document.hidden) return "paused";
    return this.ctx?.state === "running" ? "playing" : "waiting";
  }

  /** Sound is on, you're in the world, and the page is showing. */
  private get wanted(): boolean {
    return this.level !== "off" && this.inWorld && !document.hidden;
  }

  /** You're in the world: sound plays if it's on, once a tap has let it. */
  enter(): void {
    this.inWorld = true;
    this.update(false);
  }

  /** You've left the world: the sound fades out. */
  leave(): void {
    this.inWorld = false;
    this.update(false);
  }

  /** Each frame: the hour and the sky for the beds, and the next few sounds scheduled. */
  frame(ambient: Ambience): void {
    this.ambient = ambient;
    if (!this.engine || this.state !== "playing") return;
    this.engine.ambience(ambient);
    this.engine.pump();
  }

  /** You took a step onto `ground` (a path or flooring), or open ground. */
  step(ground: GroundKind | undefined): void {
    if (this.state === "playing") this.engine?.step(ground);
  }

  /** Someone sent you a gesture. */
  gesture(kind: GestureKind): void {
    if (this.state === "playing") this.engine?.gesture(kind);
  }

  /** A world event reached the mirror: the engine plays the ones that are yours. */
  event(event: WorldEvent, me: string): void {
    if (this.state === "playing") this.engine?.event(event, me);
  }

  /**
   * The speaker button: the next level (off, on, quiet). When sound left on is waiting for a tap,
   * the first tap on the speaker starts it instead; if it still can't start, the next one steps on.
   */
  private tap() {
    if (this.state === "waiting" && !this.tried) this.tried = true;
    else {
      this.level = nextLevel(this.level);
      saveLevel(this.level);
    }
    this.update(true);
  }

  /** Bring the context in line with the level, the page, and the world. `tapped`: inside a tap. */
  private update(tapped: boolean) {
    clearTimeout(this.fading);
    this.fading = undefined;
    if (this.wanted) {
      if (tapped) this.start();
      else this.ctx?.resume().catch(() => undefined);
      this.engine?.volume(LEVEL_GAIN[this.level]);
      if (this.ctx?.state !== "running") this.arm();
    } else {
      this.disarm();
      const ctx = this.ctx;
      if (ctx?.state === "running") {
        this.engine?.volume(0);
        this.fading = setTimeout(() => {
          this.fading = undefined;
          ctx.suspend().catch(() => undefined);
        }, FADE_MS);
      }
    }
    this.paint();
  }

  /** Make the context (inside a tap, as browsers want), start it, and load the sound code. */
  private start() {
    if (!this.ctx) {
      if (typeof AudioContext === "undefined") return;
      ambientSession();
      this.ctx = new AudioContext({ latencyHint: "balanced" });
      this.ctx.addEventListener("statechange", () => this.settled());
    }
    this.ctx.resume().catch(() => undefined);
    unlock(this.ctx);
    void this.load(this.ctx);
  }

  private async load(ctx: AudioContext) {
    if (this.engine || this.loading) return;
    this.loading = true;
    let code: typeof import("./soundscape");
    try {
      code = await import("./soundscape");
    } catch {
      // The sound code didn't download (offline, say): quiet for now, and the next tap tries again.
      return;
    } finally {
      this.loading = false;
    }
    const engine = new code.Soundscape(ctx);
    if (this.ambient) engine.ambience(this.ambient);
    engine.volume(this.wanted ? LEVEL_GAIN[this.level] : 0);
    this.engine = engine;
  }

  /**
   * The context started or stopped. Running: stop waiting for a tap, or, if it came up after the
   * page was hidden or sound turned off, fade it out again. Stopped while wanted (a phone call, say):
   * wait for a tap.
   */
  private settled() {
    if (this.ctx?.state === "running") {
      if (!this.wanted) return this.update(false);
      this.tried = false;
      this.disarm();
    } else if (this.wanted) this.arm();
    this.paint();
  }

  /** The first tap or key anywhere starts sound that's on. The button's own taps go to `tap`. */
  private readonly wake = (e: Event) => {
    if (e.target && this.button.contains(e.target as Node)) return;
    this.update(true);
  };

  private arm() {
    if (this.armed) return;
    this.armed = true;
    for (const type of GESTURES) window.addEventListener(type, this.wake, true);
  }

  private disarm() {
    if (!this.armed) return;
    this.armed = false;
    for (const type of GESTURES) window.removeEventListener(type, this.wake, true);
  }

  private paint() {
    this.button.setAttribute("aria-pressed", String(this.level !== "off"));
    this.button.setAttribute("aria-label", LEVEL_LABEL[this.level]);
    this.button.dataset.level = this.level;
    this.button.dataset.state = this.state;
  }
}
