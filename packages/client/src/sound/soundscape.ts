/**
 * The soundscape (decision 0097): beds of breeze, birdsong, crickets and the odd owl, rain, and a
 * snowy hush that follow the hour and the weather, and small sounds for your own moments. It plays
 * into whatever audio context it's given: the speaker button's, or an offline one rendering it to
 * listen to. `switch.ts` loads it with `import()` the first time sound plays; nothing imports it
 * statically, so the world's chunk and the first page load stay as they were.
 *
 * Sounds that come and go (songs, chirps, hoots, drops, gusts) are scheduled a little ahead of the
 * audio clock by `pump`, which the world calls each frame. The beds drift toward a new hour or
 * weather over a few seconds. Everything here is drawing's sibling: nothing reaches the server.
 */
import type { GestureKind, WorldEvent } from "@terrakin/protocol";
import type { GroundKind, Season } from "@terrakin/sim";
import type { SkyAmounts } from "../weather";
import { type Beds, bedLevels, chimeOf, type Moment, momentOf, RateLimit, surfaceOf } from "./mix";
import {
  type Bird,
  birdSong,
  chime,
  cricketChirp,
  dropTick,
  footstep,
  impulse,
  knock,
  lift,
  loop,
  newBird,
  noise,
  owlCall,
  pick,
  play,
  plink,
  rand,
  wait,
} from "./voices";

/** What the world shows now, for the beds to follow. */
export interface Ambience {
  /** The day's phase from the server's clock (0 dawn, 0.25 noon), or undefined without one. */
  phase: number | undefined;
  season: Season | undefined;
  sky: SkyAmounts;
}

type BedName = Exclude<keyof Beds, "muffle">;

/** Each bed's loudness at full strength: the mix, set by ear and checked with an offline render. */
const BED_GAIN: Readonly<Record<BedName, number>> = {
  breeze: 0.11,
  birds: 0.1,
  crickets: 0.05,
  owl: 0.15,
  rain: 0.13,
  hush: 0.05,
};
/** How much of the birds and the owl reaches the reverb. */
const WET = 0.5;
/** Footsteps sit under everything; other moments a little above the beds. */
const STEP_GAIN = 0.13;
const MOMENT_GAIN = 0.26;
/** A path laid or a seed planted: a footstep's sound, four times as loud. */
const PAT_LEVEL = (4 * STEP_GAIN) / MOMENT_GAIN;

/** Sounds are scheduled this far ahead of the audio clock, in seconds, so a slow frame never gaps. */
const AHEAD = 0.4;
/** The beds drift toward a new hour or weather with this time constant, in seconds. */
const DRIFT = 2.5;
/** The whole mix fades in and out with this time constant, in seconds. */
const FADE = 0.12;
/** The beds follow the world at most this often, in seconds of the audio clock. */
const FOLLOW = 0.2;
/** Open air, and air dulled by snow or fog: the cutoff of the beds' low-pass filter, in Hz. */
const OPEN_AIR = 16_000;
const MUFFLED = 1_300;

/** At most one footstep this often, in seconds. */
export const STEP_GAP = 0.15;
/** At most one chime this often, in seconds, so a burst of gestures doesn't jangle. */
export const CHIME_GAP = 0.9;

const BIRDS = 4;
const CRICKETS = 4;

interface Singer extends Bird {
  /** Mean seconds between songs. */
  every: number;
  next: number;
  /** When it flies off and another bird takes its place. */
  leaves: number;
}

interface Cricket {
  input: GainNode;
  chirp: AudioBuffer;
  rate: number;
  period: number;
  next: number;
  /** When this run of chirps ends and it rests. */
  until: number;
}

function gainNode(ctx: BaseAudioContext, value: number): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

function filterNode(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7) {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = freq;
  node.Q.value = q;
  return node;
}

export class Soundscape {
  private readonly master: GainNode;
  private readonly air: BiquadFilterNode;
  private readonly beds: Readonly<Record<BedName, GainNode>>;
  /** The reverb sends of the birds and the owl, which follow their beds. */
  private readonly birdsWet: GainNode;
  private readonly owlWet: GainNode;
  private readonly moments: GainNode;
  private readonly momentsWet: GainNode;
  private readonly steps: GainNode;
  private readonly gust: GainNode;
  private readonly breezeTone: BiquadFilterNode;
  private readonly drops: readonly StereoPannerNode[];
  private readonly white: AudioBuffer;
  private readonly chirps: readonly AudioBuffer[];
  private readonly tick: AudioBuffer;
  private readonly stepLimit = new RateLimit(STEP_GAP);
  private readonly chimeLimit = new RateLimit(CHIME_GAP);
  /** What the beds are heading for, and what they were last set to. */
  private level: Beds | undefined;
  private readonly applied: Record<keyof Beds, number> = {
    breeze: -1,
    birds: -1,
    crickets: -1,
    owl: -1,
    rain: -1,
    hush: -1,
    muffle: -1,
  };
  private followed = Number.NEGATIVE_INFINITY;
  private season: Season | undefined;
  private readonly singers: Singer[] = [];
  private readonly crickets: Cricket[] = [];
  private readonly owlPitch = rand(360, 440);
  private nextGust = 0;
  private nextOwl = 0;
  private nextDrop = 0;
  private nextPlink = 0;

  constructor(private readonly ctx: BaseAudioContext) {
    this.master = gainNode(ctx, 0);
    this.master.connect(ctx.destination);
    // The beds go through one low-pass, which closes in snow and fog.
    this.air = filterNode(ctx, "lowpass", OPEN_AIR);
    this.air.connect(this.master);
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx);
    verb.connect(gainNode(ctx, 0.6)).connect(this.master);
    this.beds = {
      breeze: gainNode(ctx, 0),
      birds: gainNode(ctx, 0),
      crickets: gainNode(ctx, 0),
      owl: gainNode(ctx, 0),
      rain: gainNode(ctx, 0),
      hush: gainNode(ctx, 0),
    };
    for (const bed of Object.values(this.beds)) bed.connect(this.air);
    this.birdsWet = gainNode(ctx, 0);
    this.owlWet = gainNode(ctx, 0);
    this.birdsWet.connect(verb);
    this.owlWet.connect(verb);
    this.moments = gainNode(ctx, MOMENT_GAIN);
    this.moments.connect(this.master);
    this.momentsWet = gainNode(ctx, MOMENT_GAIN * 0.5);
    this.momentsWet.connect(verb);
    this.steps = gainNode(ctx, STEP_GAIN);
    this.steps.connect(this.master);

    this.white = noise(ctx, "white");
    const pink = noise(ctx, "pink");

    // The breeze: pink noise under a low filter that opens as each gust comes through, and a
    // faint rustle of leaves riding the same gusts.
    this.gust = gainNode(ctx, 0.6);
    this.gust.connect(this.beds.breeze);
    this.breezeTone = filterNode(ctx, "lowpass", 520, 0.5);
    this.breezeTone.connect(this.gust);
    loop(ctx, pink, this.breezeTone);
    const rustle = filterNode(ctx, "bandpass", 2800, 0.6);
    rustle.connect(gainNode(ctx, 0.1)).connect(this.gust);
    loop(ctx, this.white, rustle);

    // The rain: a hiss, a patter under it, and drops (`drip`).
    const hiss = filterNode(ctx, "highpass", 1000);
    hiss
      .connect(filterNode(ctx, "lowpass", 7000))
      .connect(gainNode(ctx, 0.5))
      .connect(this.beds.rain);
    loop(ctx, this.white, hiss);
    const patter = filterNode(ctx, "bandpass", 500);
    patter.connect(gainNode(ctx, 0.7)).connect(this.beds.rain);
    loop(ctx, pink, patter);
    this.drops = [-0.7, -0.25, 0.25, 0.7].map((at) => {
      const pan = ctx.createStereoPanner();
      pan.pan.value = at;
      pan.connect(this.beds.rain);
      return pan;
    });
    this.tick = dropTick(ctx);

    // The hush: brown noise, low and soft.
    const hush = filterNode(ctx, "lowpass", 320);
    hush.connect(this.beds.hush);
    loop(ctx, noise(ctx, "brown"), hush);

    this.chirps = [cricketChirp(ctx, 3), cricketChirp(ctx, 4)];
  }

  /** Fade the whole mix to `gain`: 0 before the context is suspended, the level's gain after. */
  volume(gain: number): void {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(gain, t, FADE);
  }

  /** Follow the hour and the weather. The beds start where they belong, then drift. */
  ambience(a: Ambience): void {
    const t = this.ctx.currentTime;
    const first = this.level === undefined;
    if (!first && t - this.followed < FOLLOW) return;
    this.followed = t;
    this.season = a.season;
    const next = bedLevels(a.phase, a.sky, a.season);
    this.level = next;
    const set = (param: AudioParam, value: number) =>
      first ? param.setValueAtTime(value, t) : param.setTargetAtTime(value, t, DRIFT);
    for (const name of Object.keys(BED_GAIN) as BedName[]) {
      if (Math.abs(next[name] - this.applied[name]) < 0.005) continue;
      this.applied[name] = next[name];
      set(this.beds[name].gain, next[name] * BED_GAIN[name]);
      if (name === "birds") set(this.birdsWet.gain, next.birds * BED_GAIN.birds * WET);
      if (name === "owl") set(this.owlWet.gain, next.owl * BED_GAIN.owl * WET);
    }
    if (Math.abs(next.muffle - this.applied.muffle) >= 0.005) {
      this.applied.muffle = next.muffle;
      set(this.air.frequency, OPEN_AIR * (MUFFLED / OPEN_AIR) ** next.muffle);
    }
  }

  /** Schedule what's due in the next `ahead` seconds of the audio clock. */
  pump(ahead = AHEAD): void {
    const level = this.level;
    if (!level) return;
    const now = this.ctx.currentTime;
    const until = now + ahead;
    this.gusts(now, until);
    this.sing(now, until, level.birds);
    this.chirp(now, until, level.crickets);
    this.hoot(now, until, level.owl);
    this.drip(now, until, level.rain);
  }

  /** Your step lands on `ground` (a path or flooring), or on grass, or snow in winter. */
  step(ground: GroundKind | undefined): void {
    const at = this.ctx.currentTime + 0.01;
    if (!this.stepLimit.take(at)) return;
    footstep(this.ctx, this.steps, at, surfaceOf(ground, this.season), this.white);
  }

  /** Someone sent you a gesture. */
  gesture(kind: GestureKind): void {
    this.moment({ kind: "chime", chime: chimeOf(kind) });
  }

  /** A world event: a sound if it's something you did, or kindness aimed at you. */
  event(event: WorldEvent, me: string): void {
    const moment = momentOf(event, me);
    if (moment) this.moment(moment);
  }

  private moment(m: Moment) {
    const at = this.ctx.currentTime + 0.01;
    switch (m.kind) {
      case "knock":
        return knock(this.ctx, this.moments, at, m.material, this.white, m.soft);
      case "lift":
        return lift(this.ctx, this.moments, at, this.white);
      case "pat":
        return footstep(this.ctx, this.moments, at, m.surface, this.white, PAT_LEVEL);
      case "chime":
        if (this.chimeLimit.take(at)) chime(this.ctx, this.moments, this.momentsWet, at, m.chime);
        return;
    }
  }

  /** The breeze rises and falls: a gust every few seconds, opening its filter as it comes. */
  private gusts(now: number, until: number) {
    if (this.nextGust < now) this.nextGust = now + rand(0.5, 3);
    while (this.nextGust < until) {
      const t = this.nextGust;
      const strength = rand(0.2, 1);
      const rise = rand(1, 3);
      this.gust.gain.setTargetAtTime(0.7 + 0.8 * strength, t, rise / 3);
      this.breezeTone.frequency.setTargetAtTime(500 + 900 * strength, t, rise / 3);
      const fall = t + rise + rand(0.5, 2);
      this.gust.gain.setTargetAtTime(rand(0.45, 0.75), fall, rand(1, 2.5));
      this.breezeTone.frequency.setTargetAtTime(rand(420, 600), fall, 2);
      this.nextGust = fall + rand(2, 7);
    }
  }

  /** A few birds sing around you, each its own song every so often; now and then one flies off. */
  private sing(now: number, until: number, level: number) {
    while (this.singers.length < BIRDS) this.singers.push(this.singer(now));
    for (let i = 0; i < this.singers.length; i++) {
      let s = this.singers[i] as Singer;
      if (now > s.leaves) {
        s = this.singer(now);
        this.singers[i] = s;
      }
      if (s.next < now) s.next = now + rand(0, s.every);
      while (s.next < until) {
        const song =
          level < 0.03 ? 0 : birdSong(this.ctx, this.beds.birds, this.birdsWet, s.next, s);
        s.next += song + wait(s.every / (0.3 + 0.7 * level));
      }
    }
  }

  private singer(now: number): Singer {
    return {
      ...newBird(),
      every: rand(4, 11),
      next: now + rand(0.5, 6),
      leaves: now + rand(60, 180),
    };
  }

  /** Crickets chirp in runs and rest between them; slower on cool autumn nights. */
  private chirp(now: number, until: number, level: number) {
    while (this.crickets.length < CRICKETS) this.crickets.push(this.cricket(now));
    const slow = this.season === "autumn" ? 1.25 : 1;
    for (const c of this.crickets) {
      if (c.next < now) c.next = now + rand(0, c.period);
      while (c.next < until) {
        if (c.next >= c.until) {
          c.next = c.until + rand(1, 6);
          c.until = c.next + rand(5, 20);
          continue;
        }
        if (level >= 0.03) play(this.ctx, c.chirp, c.input, c.next, c.rate);
        c.next += c.period * slow * rand(0.97, 1.03);
      }
    }
  }

  private cricket(now: number): Cricket {
    const input = gainNode(this.ctx, rand(0.35, 1));
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = rand(-0.9, 0.9);
    input.connect(pan).connect(this.beds.crickets);
    return {
      input,
      chirp: pick(this.chirps),
      rate: rand(0.88, 1.12),
      period: rand(0.45, 0.8),
      next: now + rand(0, 1),
      until: now + rand(4, 15),
    };
  }

  /** The owl calls now and then, deep in the night, more rarely at its edges. */
  private hoot(now: number, until: number, level: number) {
    if (level < 0.1) {
      this.nextOwl = Math.max(this.nextOwl, now + rand(15, 50));
      return;
    }
    if (this.nextOwl < now) this.nextOwl = now + rand(5, 30);
    if (this.nextOwl < until) {
      owlCall(this.ctx, this.beds.owl, this.owlWet, this.nextOwl, this.owlPitch * rand(0.97, 1.03));
      this.nextOwl += rand(40, 110) / level;
    }
  }

  /** Drops on leaves, and now and then into a puddle, thicker as the rain gets heavier. */
  private drip(now: number, until: number, level: number) {
    if (level < 0.02) {
      this.nextDrop = until;
      this.nextPlink = until;
      return;
    }
    if (this.nextDrop < now) this.nextDrop = now;
    if (this.nextPlink < now) this.nextPlink = now + wait(1 / (3 * level));
    while (this.nextDrop < until) {
      play(this.ctx, this.tick, pick(this.drops), this.nextDrop, rand(0.5, 1.6), rand(0.06, 0.3));
      this.nextDrop += wait(1 / (30 * level));
    }
    while (this.nextPlink < until) {
      plink(this.ctx, pick(this.drops), this.nextPlink);
      this.nextPlink += wait(1 / (3 * level));
    }
  }
}
