import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorldEvent } from "@terrakin/protocol";
import type { Weather } from "@terrakin/sim";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Beds, bedLevels, momentOf } from "./sound/mix";
import { nextLevel, SOUND_KEY, savedLevel, saveLevel } from "./sound/setting";
import { Soundscape, STEP_GAP } from "./sound/soundscape";
import { SoundSwitch } from "./sound/switch";
import { WEATHER_LOOK } from "./weather";

const NOON = 0.25;
const DUSK = 0.5;
const MIDNIGHT = 0.75;

/** The beds loud enough to hear, by name. */
const audible = (beds: Beds) =>
  Object.entries(beds)
    .filter(([name, level]) => name !== "muffle" && level > 0.05)
    .map(([name]) => name)
    .sort();

describe("the soundscape follows the hour and the weather", () => {
  it.each([
    ["a clear summer noon", NOON, "clear", "summer", ["birds", "breeze"]],
    ["a clear summer midnight", MIDNIGHT, "clear", "summer", ["breeze", "crickets", "owl"]],
    ["a clear winter midnight", MIDNIGHT, "clear", "winter", ["breeze", "owl"]],
    ["a rainy spring noon", NOON, "rain", "spring", ["birds", "breeze", "rain"]],
    ["a rainy summer midnight", MIDNIGHT, "rain", "summer", ["breeze", "crickets", "rain"]],
    ["a snowy winter noon", NOON, "snow", "winter", ["birds", "breeze", "hush"]],
    ["a foggy autumn noon", NOON, "fog", "autumn", ["birds", "breeze", "hush"]],
    ["no server clock yet", undefined, "clear", undefined, ["birds", "breeze"]],
  ] as const)("%s plays %j", (_, phase, weather, season, beds) => {
    expect(audible(bedLevels(phase, WEATHER_LOOK[weather as Weather], season))).toEqual(beds);
  });

  it("quiets the birds and the crickets in the rain, and muffles the air in snow and fog", () => {
    const clear = WEATHER_LOOK.clear;
    expect(bedLevels(NOON, WEATHER_LOOK.rain, "summer").birds).toBeLessThan(
      bedLevels(NOON, clear, "summer").birds / 5,
    );
    expect(bedLevels(MIDNIGHT, WEATHER_LOOK.rain, "summer").crickets).toBeLessThan(
      bedLevels(MIDNIGHT, clear, "summer").crickets / 5,
    );
    expect(bedLevels(NOON, clear, "summer").muffle).toBe(0);
    expect(bedLevels(NOON, WEATHER_LOOK.snow, "winter").muffle).toBe(1);
    expect(bedLevels(NOON, WEATHER_LOOK.fog, "autumn").muffle).toBeGreaterThan(0.5);
  });

  it("crossfades birds and crickets through dusk and dawn, never in a jump", () => {
    const sky = WEATHER_LOOK.clear;
    const dusk = bedLevels(DUSK, sky, "summer");
    expect(dusk.birds).toBeGreaterThan(0);
    expect(dusk.birds).toBeLessThan(1);
    expect(dusk.crickets).toBeGreaterThan(0);
    expect(dusk.crickets).toBeLessThan(1);
    // A thousandth of a day is 12.6 seconds of the world's 210-minute day.
    let before = bedLevels(0, sky, "summer");
    for (let phase = 0.001; phase < 1; phase += 0.001) {
      const now = bedLevels(phase, sky, "summer");
      for (const name of Object.keys(now) as (keyof Beds)[])
        expect(Math.abs(now[name] - before[name])).toBeLessThan(0.02);
      before = now;
    }
  });
});

describe("moments make a sound only when they're yours", () => {
  const me = "r_me";
  const them = "r_them";
  it.each<[string, WorldEvent, unknown]>([
    [
      "a wooden block you place",
      { type: "block_placed", x: 1, y: 1, block: "wood", by: me },
      { kind: "knock", material: "wood" },
    ],
    [
      "a stone wall you place",
      { type: "block_placed", x: 1, y: 1, block: "stone_wall", by: me },
      { kind: "knock", material: "stone" },
    ],
    [
      "a block someone else places",
      { type: "block_placed", x: 1, y: 1, block: "wood", by: them },
      undefined,
    ],
    ["a block you remove", { type: "block_removed", x: 1, y: 1, by: me }, { kind: "lift" }],
    [
      "a cobble path you lay",
      { type: "ground_laid", x: 1, y: 1, ground: "cobble", by: me },
      { kind: "pat", surface: "stone" },
    ],
    [
      "a path someone else lays",
      { type: "ground_laid", x: 1, y: 1, ground: "dirt", by: them },
      undefined,
    ],
    [
      "a branch you gather",
      { type: "gathered", x: 1, y: 1, kind: "wood", by: me },
      { kind: "knock", material: "wood", soft: true },
    ],
    [
      "someone admiring what you made",
      { type: "admired", x: 1, y: 1, item: "g_1", maker: me, by: them, admired: 2 },
      { kind: "chime", chime: "sparkle" },
    ],
    [
      "you admiring what someone made",
      { type: "admired", x: 1, y: 1, item: "g_1", maker: them, by: me, admired: 2 },
      undefined,
    ],
    [
      "a gift of coins",
      { type: "coins", residentId: me, amount: 5, balance: 9, reason: "gift_in", with: them },
      { kind: "chime", chime: "sparkle" },
    ],
    [
      "your daily coins for coming home",
      { type: "coins", residentId: me, amount: 3, balance: 9, reason: "allowance" },
      undefined,
    ],
    ["anyone walking", { type: "moved", residentId: me, x: 2, y: 2 }, undefined],
  ])("%s", (_, event, moment) => {
    expect(momentOf(event, me)).toEqual(moment);
  });
});

function memory() {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
}

describe("the sound setting", () => {
  it("is off until this device chooses, and remembers the choice", () => {
    const store = memory();
    expect(savedLevel(store)).toBe("off");
    saveLevel("quiet", store);
    expect(savedLevel(store)).toBe("quiet");
    store.setItem(SOUND_KEY, "deafening");
    expect(savedLevel(store)).toBe("off");
  });

  it("steps off, on, quiet, and back to off", () => {
    expect([nextLevel("off"), nextLevel("on"), nextLevel("quiet")]).toEqual(["on", "quiet", "off"]);
  });

  it("gives up quietly when storage is missing or refuses", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(() => saveLevel("on", broken)).not.toThrow();
    expect(savedLevel(broken)).toBe("off");
    expect(savedLevel(undefined)).toBe("off");
  });
});

// ---------- a fake Web Audio, just enough for the switch and the engine ----------

class FakeParam {
  constructor(public value = 0) {}
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number) {
    this.value = v;
  }
  setTargetAtTime(v: number) {
    this.value = v;
  }
  cancelScheduledValues() {}
}

class FakeNode {
  connect<T>(to: T): T {
    return to;
  }
  disconnect() {}
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  type = "sine";
  playbackRate = new FakeParam(1);
  frequency = new FakeParam(440);
  constructor(private readonly ctx: FakeContext) {
    super();
  }
  start() {
    this.ctx.started++;
  }
  stop() {}
  addEventListener() {}
}

/** Counts what it starts; `resume` and `suspend` settle a moment later, like the real thing. */
class FakeContext {
  sampleRate = 3000;
  currentTime = 0;
  state: "suspended" | "running" = "suspended";
  destination = new FakeNode();
  started = 0;
  private readonly changes: (() => void)[] = [];
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam(1) });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), {
      type: "lowpass",
      frequency: new FakeParam(350),
      Q: new FakeParam(1),
    });
  }
  createStereoPanner() {
    return Object.assign(new FakeNode(), { pan: new FakeParam() });
  }
  createConvolver() {
    return Object.assign(new FakeNode(), { buffer: null });
  }
  createOscillator() {
    return new FakeSource(this);
  }
  createBufferSource() {
    return new FakeSource(this);
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      length,
      sampleRate,
      duration: length / sampleRate,
      numberOfChannels: channels,
      getChannelData: (c: number) => data[c],
    };
  }
  addEventListener(_type: "statechange", listener: () => void) {
    this.changes.push(listener);
  }
  resume() {
    return this.become("running");
  }
  suspend() {
    return this.become("suspended");
  }
  private async become(state: "suspended" | "running") {
    await Promise.resolve();
    this.state = state;
    for (const listener of this.changes) listener();
  }
}

/** A page's worth of listeners: `fire` dispatches one event to them. */
function target() {
  const listeners = new Map<string, Set<(e: { target: unknown }) => void>>();
  return {
    addEventListener(type: string, fn: (e: { target: unknown }) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    removeEventListener(type: string, fn: (e: { target: unknown }) => void) {
      listeners.get(type)?.delete(fn);
    },
    fire(type: string, from: unknown = {}) {
      for (const fn of listeners.get(type) ?? []) fn({ target: from });
    },
  };
}

function fakeButton() {
  const events = target();
  const button = {
    attrs: {} as Record<string, string>,
    dataset: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      button.attrs[name] = value;
    },
    addEventListener: events.addEventListener,
    contains: (node: unknown) => node === button,
    click: () => events.fire("click", button),
  };
  return button;
}

/** Let promises settle: the context's state changes and the engine's import. */
const settle = () => new Promise<void>((done) => setImmediate(done));

describe("the speaker button", () => {
  let contexts: FakeContext[];
  let page: ReturnType<typeof target> & { hidden: boolean };
  let win: ReturnType<typeof target>;

  beforeEach(() => {
    contexts = [];
    page = Object.assign(target(), { hidden: false });
    win = target();
    vi.stubGlobal("document", page);
    vi.stubGlobal("window", win);
    vi.stubGlobal("localStorage", memory());
    vi.stubGlobal(
      "AudioContext",
      class extends FakeContext {
        constructor() {
          super();
          contexts.push(this);
        }
      },
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("makes no audio context before it's tapped, then plays, pauses while hidden, and fades out", async () => {
    const button = fakeButton();
    const sound = new SoundSwitch(button as unknown as HTMLButtonElement);
    sound.enter();
    // Off: a tap anywhere else makes nothing.
    win.fire("pointerup");
    expect(contexts).toEqual([]);
    expect(button.attrs["aria-pressed"]).toBe("false");

    button.click();
    expect(contexts).toHaveLength(1);
    await settle();
    expect(sound.state).toBe("playing");
    expect(button.attrs["aria-pressed"]).toBe("true");
    expect(localStorage.getItem(SOUND_KEY)).toBe("on");

    // Hidden: it fades, then the context is suspended. Back: it resumes.
    page.hidden = true;
    page.fire("visibilitychange");
    expect(sound.state).toBe("paused");
    vi.advanceTimersByTime(1000);
    await settle();
    expect(contexts[0]?.state).toBe("suspended");
    page.hidden = false;
    page.fire("visibilitychange");
    await settle();
    expect(contexts[0]?.state).toBe("running");

    // Quiet, then off: faded out and suspended, and still the one context.
    button.click();
    expect(button.attrs["aria-label"]).toBe("Sound, quiet");
    button.click();
    expect(button.attrs["aria-pressed"]).toBe("false");
    vi.advanceTimersByTime(1000);
    await settle();
    expect(contexts[0]?.state).toBe("suspended");
    expect(contexts).toHaveLength(1);
  });

  it("waits for the first tap anywhere when this device left sound on", async () => {
    localStorage.setItem(SOUND_KEY, "on");
    const button = fakeButton();
    const sound = new SoundSwitch(button as unknown as HTMLButtonElement);
    sound.enter();
    expect(sound.state).toBe("waiting");
    expect(button.dataset.state).toBe("waiting");
    expect(contexts).toEqual([]);

    win.fire("pointerup");
    expect(contexts).toHaveLength(1);
    await settle();
    expect(sound.state).toBe("playing");

    // Leaving the world fades it out.
    sound.leave();
    vi.advanceTimersByTime(1000);
    await settle();
    expect(contexts[0]?.state).toBe("suspended");
  });

  it("still steps to off in a browser where sound can't start", () => {
    vi.stubGlobal("AudioContext", undefined);
    localStorage.setItem(SOUND_KEY, "on");
    const button = fakeButton();
    new SoundSwitch(button as unknown as HTMLButtonElement).enter();
    // The first tap tries to start it; the next ones step on, to quiet and then off.
    button.click();
    expect(button.attrs["aria-pressed"]).toBe("true");
    button.click();
    button.click();
    expect(button.attrs["aria-pressed"]).toBe("false");
  });

  it("fades out a context that comes up after the page was hidden", async () => {
    const button = fakeButton();
    new SoundSwitch(button as unknown as HTMLButtonElement).enter();
    button.click();
    // Hidden before the context has finished starting.
    page.hidden = true;
    page.fire("visibilitychange");
    await settle();
    vi.advanceTimersByTime(1000);
    await settle();
    expect(contexts[0]?.state).toBe("suspended");
  });
});

describe("footsteps", () => {
  it("sound on every step at a walk, and at most every STEP_GAP seconds faster than that", () => {
    const ctx = new FakeContext();
    const sound = new Soundscape(ctx as unknown as BaseAudioContext);
    const steps = (every: number) => {
      const before = ctx.started;
      for (let i = 0; i < 10; i++) {
        ctx.currentTime += every;
        sound.step(undefined);
      }
      return ctx.started - before;
    };
    // A footstep on grass starts one sound. Steps closer than STEP_GAP: every other one.
    expect(steps(0.2)).toBe(10);
    expect(steps(STEP_GAP * 0.6)).toBe(5);
  });
});

describe("the sound code stays out of the first page load", () => {
  const src = import.meta.dirname;
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? files(join(dir, e.name))
        : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")
          ? [join(dir, e.name)]
          : [],
    );
  const lazy = new Set(["sound/soundscape.ts", "sound/voices.ts", "sound/mix.ts"]);

  it("reaches the engine, its voices, and its mix only through import() or type imports", () => {
    for (const f of files(src)) {
      const rel = f.slice(src.length + 1);
      if (lazy.has(rel)) continue;
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/^import (type )?[^;]*?from "(\.[^"]+)";/gms)) {
        const target = join(rel, "..", m[2] ?? "");
        if (lazy.has(`${target}.ts`)) expect(m[1], `${rel} imports ${m[2]}`).toBe("type ");
      }
    }
  });
});
