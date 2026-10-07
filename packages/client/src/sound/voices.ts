/**
 * The soundscape's voices (decision 0097), made with code the way decision 0035 has the world
 * drawn with code: noise shaped by filters for the breeze, the rain, the hush, footsteps and
 * knocks, and oscillators for birdsong, crickets, the owl, and chimes. No recordings, nothing to
 * license. A voice that plays once builds its few nodes, schedules them on the audio clock, and
 * lets them go when it ends. Every one varies a little each time, so nothing repeats like a loop.
 */
import type { Chime, Material, Surface } from "./mix";

/** A random number from `a` to `b`. */
export const rand = (a: number, b: number) => a + (b - a) * Math.random();

/** A random wait with mean `mean`, as gaps between events that happen at random come out. */
export const wait = (mean: number) => -mean * Math.log(1 - Math.random() * 0.98);

export function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)] as T;
}

/** Let a voice's nodes go once its last source ends. */
function release(last: AudioScheduledSourceNode, nodes: readonly AudioNode[]) {
  last.addEventListener("ended", () => {
    for (const node of nodes) node.disconnect();
  });
}

function connectAll(from: AudioNode, to: AudioNode | readonly AudioNode[]) {
  for (const node of Array.isArray(to) ? to : [to]) from.connect(node);
}

// ---------- buffers, made once per context ----------

export type NoiseColor = "white" | "pink" | "brown";

/**
 * How long each color's loop is, in seconds. They differ, so beds made of two colors (the breeze,
 * the rain) only come round together every 16 seconds or more, under gusts and drops that never do.
 */
const NOISE_SECONDS: Readonly<Record<NoiseColor, number>> = { white: 2.5, pink: 3.3, brown: 2.9 };

/**
 * Noise, white, pink (Paul Kellet's filter), or brown, at an even loudness (RMS 0.25), with its
 * tail faded into its head so it loops without a seam.
 */
export function noise(ctx: BaseAudioContext, color: NoiseColor): AudioBuffer {
  const seconds = NOISE_SECONDS[color];
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const fade = Math.floor(rate * 0.05);
  const raw = new Float32Array(length + fade);
  let [b0, b1, b2, b3, b4, b5, b6, brown] = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < raw.length; i++) {
    const white = Math.random() * 2 - 1;
    if (color === "white") raw[i] = white;
    else if (color === "pink") {
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
    } else {
      brown = (brown + 0.02 * white) / 1.02;
      raw[i] = brown;
    }
  }
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  let power = 0;
  for (let i = 0; i < length; i++) {
    const k = i < fade ? i / fade : 1;
    const v = (raw[i] as number) * k + (i < fade ? (raw[length + i] as number) * (1 - k) : 0);
    data[i] = v;
    power += v * v;
  }
  const scale = 0.25 / Math.sqrt(power / length || 1);
  for (let i = 0; i < length; i++) data[i] = (data[i] as number) * scale;
  return buffer;
}

/** A soft outdoor reverb, in stereo: decaying noise whose highs fade before its lows. */
export function impulse(ctx: BaseAudioContext, seconds = 1.4): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      low += (0.7 - 0.6 * t) * (Math.random() * 2 - 1 - low);
      data[i] = low * (1 - t) ** 2.5;
    }
  }
  return buffer;
}

/** One cricket's chirp: `pulses` short bursts of a 4.4 kHz tone, about 30 a second. */
export function cricketChirp(ctx: BaseAudioContext, pulses: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const period = 0.031;
  const width = 0.017;
  const tone = 4400;
  const length = Math.ceil(rate * (period * (pulses - 1) + width));
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    const k = t % period;
    const shape = k < width ? Math.sin((Math.PI * k) / width) ** 2 : 0;
    data[i] =
      shape * (0.85 * Math.sin(2 * Math.PI * tone * t) + 0.15 * Math.sin(4 * Math.PI * tone * t));
  }
  return buffer;
}

/** A raindrop on a leaf: a 30 ms tick of softened noise, peaking at 1. Played faster, it's smaller. */
export function dropTick(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.ceil(rate * 0.03);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  let soft = 0;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    soft += 0.35 * (Math.random() * 2 - 1 - soft);
    const v = soft * Math.exp(-i / (rate * 0.004));
    data[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  for (let i = 0; i < length; i++) data[i] = (data[i] as number) / (peak || 1);
  return buffer;
}

/** Play a buffer once into `into`, at `rate` times its speed and `level` times its loudness. */
export function play(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  into: AudioNode,
  when: number,
  rate = 1,
  level = 1,
) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  if (level === 1) {
    src.connect(into);
    src.start(when);
    release(src, [src]);
    return;
  }
  const amp = ctx.createGain();
  amp.gain.value = level;
  src.connect(amp).connect(into);
  src.start(when);
  release(src, [src, amp]);
}

/** A buffer playing round and round into `into`, from a random point, for a bed. */
export function loop(ctx: BaseAudioContext, buffer: AudioBuffer, into: AudioNode) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(into);
  src.start(ctx.currentTime, Math.random() * buffer.duration);
}

// ---------- the parts most voices are made of ----------

/**
 * A struck tone at `freq`, bending to `freq * bend` over its first 40 ms and dying away with time
 * constant `tau`. Returns when it's silent.
 */
function strike(
  ctx: BaseAudioContext,
  into: AudioNode | readonly AudioNode[],
  when: number,
  freq: number,
  level: number,
  tau: number,
  bend = 1,
  type: OscillatorType = "sine",
): { osc: OscillatorNode; end: number } {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  env.gain.value = 0;
  osc.frequency.setValueAtTime(freq, when);
  if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(freq * bend, when + 0.04);
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(level, when + 0.002);
  env.gain.setTargetAtTime(0, when + 0.002, tau);
  osc.connect(env);
  connectAll(env, into);
  const end = when + 0.002 + tau * 7;
  osc.start(when);
  osc.stop(end);
  release(osc, [osc, env]);
  return { osc, end };
}

interface Band {
  type: BiquadFilterType;
  freq: number;
  q: number;
}

/**
 * Filtered noise in `grains` quick bursts spread over `span` seconds, loudest in the middle: one
 * grain is the click of a knock, several are a crunch. Each dies away with time constant `tau`.
 */
function burst(
  ctx: BaseAudioContext,
  into: AudioNode,
  when: number,
  white: AudioBuffer,
  band: Band,
  level: number,
  tau: number,
  grains = 1,
  span = 0,
) {
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const env = ctx.createGain();
  src.buffer = white;
  filter.type = band.type;
  filter.frequency.value = band.freq;
  filter.Q.value = band.q;
  env.gain.value = 0;
  src.connect(filter).connect(env).connect(into);
  let t = when;
  for (let i = 0; i < grains; i++) {
    const shape =
      grains > 1 ? (0.45 + 0.55 * Math.sin((Math.PI * (i + 0.5)) / grains)) * rand(0.6, 1) : 1;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level * shape, t + 0.0015);
    env.gain.setTargetAtTime(0, t + 0.0015, tau);
    if (i < grains - 1) t += (span / grains) * rand(0.6, 1.4);
  }
  const end = t + 0.0015 + tau * 7;
  src.start(when, Math.random() * Math.max(0, white.duration - (end - when) - 0.01));
  src.stop(end);
  release(src, [src, filter, env]);
}

// ---------- birds, crickets, the owl, and rain ----------

type BirdKind = "whistle" | "warble" | "trill" | "chip";

/** One bird nearby: what it sings, how high, where it sits, and how far off (0 near, 1 far). */
export interface Bird {
  kind: BirdKind;
  pitch: number;
  pan: number;
  far: number;
}

const BIRD_PITCH: Readonly<Record<BirdKind, readonly [number, number]>> = {
  whistle: [2900, 3900],
  warble: [2100, 3100],
  trill: [4200, 5600],
  chip: [3000, 4300],
};

export function newBird(): Bird {
  const kind = pick(["whistle", "warble", "trill", "chip"] as const);
  const [low, high] = BIRD_PITCH[kind];
  return { kind, pitch: rand(low, high), pan: rand(-0.85, 0.85), far: Math.random() };
}

/** One song from `bird` at `when`, never quite the same twice. Returns how long it lasts. */
export function birdSong(
  ctx: BaseAudioContext,
  out: AudioNode,
  wet: AudioNode,
  when: number,
  bird: Bird,
): number {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  const pan = ctx.createStereoPanner();
  const send = ctx.createGain();
  env.gain.value = 0;
  pan.pan.value = bird.pan;
  send.gain.value = 0.25 + 0.6 * bird.far;
  osc.connect(env).connect(pan).connect(out);
  pan.connect(send).connect(wet);
  const nodes: AudioNode[] = [osc, env, pan, send];
  const f = osc.frequency;
  const g = env.gain;
  const loud = 0.5 * (1 - 0.6 * bird.far);
  const p = bird.pitch * rand(0.97, 1.03);
  /** A syllable gliding from `from` to `to` Hz over `dur` seconds. Returns when it ends. */
  const note = (t: number, from: number, to: number, dur: number, level = loud) => {
    f.setValueAtTime(from, t);
    f.exponentialRampToValueAtTime(to, t + dur);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(level, t + Math.min(0.018, dur * 0.3));
    g.linearRampToValueAtTime(level * 0.75, t + dur * 0.75);
    g.linearRampToValueAtTime(0, t + dur);
    return t + dur;
  };
  let t = when;
  switch (bird.kind) {
    case "whistle": {
      // Two or three clear notes, each a step lower: "fee-bee".
      let q = p;
      for (let i = Math.random() < 0.3 ? 3 : 2; i > 0; i--) {
        t = note(t, q, q * 0.97, rand(0.16, 0.3)) + rand(0.06, 0.14);
        q *= rand(0.8, 0.88);
      }
      break;
    }
    case "warble": {
      // A run of quick syllables gliding up and down, sometimes with a flutter.
      for (let i = Math.floor(rand(3, 8)); i > 0; i--) {
        t = note(t, p * rand(0.8, 1.3), p * rand(0.8, 1.3), rand(0.06, 0.14)) + rand(0.02, 0.07);
      }
      if (Math.random() < 0.4) {
        const flutter = ctx.createOscillator();
        const depth = ctx.createGain();
        flutter.frequency.value = rand(24, 44);
        depth.gain.value = p * 0.04;
        flutter.connect(depth).connect(f);
        flutter.start(when);
        flutter.stop(t + 0.05);
        nodes.push(flutter, depth);
      }
      break;
    }
    case "trill": {
      // A fast run of one falling chirp.
      const gap = 1 / rand(11, 17);
      for (let i = Math.floor(rand(6, 13)); i > 0; i--) {
        note(t, p * 1.2, p * 0.85, gap * 0.7, loud * 0.8);
        t += gap;
      }
      break;
    }
    case "chip": {
      // One to three short rising chips.
      for (let i = Math.floor(rand(1, 4)); i > 0; i--) {
        t = note(t, p * 0.8, p * 1.3, rand(0.035, 0.06)) + rand(0.15, 0.4);
      }
      break;
    }
  }
  osc.start(when);
  osc.stop(t + 0.05);
  release(osc, nodes);
  return t - when;
}

/** The owl: "hoo, hu-hu, hoooo" or "hoo-hoo", soft, from the trees. Returns how long it lasts. */
export function owlCall(
  ctx: BaseAudioContext,
  out: AudioNode,
  wet: AudioNode,
  when: number,
  pitch: number,
): number {
  const tone = ctx.createBiquadFilter();
  const pan = ctx.createStereoPanner();
  const send = ctx.createGain();
  tone.type = "lowpass";
  tone.frequency.value = 1200;
  pan.pan.value = rand(-0.7, 0.7);
  send.gain.value = 0.9;
  tone.connect(pan).connect(out);
  pan.connect(send).connect(wet);
  const hoots: readonly (readonly [number, number])[] =
    Math.random() < 0.6
      ? [
          [0, 0.5],
          [0.85, 0.16],
          [1.1, 0.16],
          [1.42, 0.65],
        ]
      : [
          [0, 0.42],
          [0.6, 0.48],
        ];
  const nodes: AudioNode[] = [tone, pan, send];
  let last: OscillatorNode | undefined;
  let end = when;
  for (const [at, len] of hoots) {
    const t = when + at;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "triangle";
    env.gain.value = 0;
    osc.connect(env).connect(tone);
    osc.frequency.setValueAtTime(pitch * 0.9, t);
    osc.frequency.linearRampToValueAtTime(pitch, t + len * 0.3);
    osc.frequency.linearRampToValueAtTime(pitch * 0.86, t + len);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5, t + 0.06);
    env.gain.linearRampToValueAtTime(0.4, t + len);
    env.gain.setTargetAtTime(0, t + len, 0.05);
    end = t + len + 0.35;
    osc.start(t);
    osc.stop(end);
    nodes.push(osc, env);
    last = osc;
  }
  if (last) release(last, nodes);
  return end - when;
}

/** A drop into a puddle: a quick falling plink. */
export function plink(ctx: BaseAudioContext, into: AudioNode, when: number) {
  strike(ctx, into, when, rand(1700, 3200), rand(0.05, 0.12), 0.012, 0.6);
}

// ---------- your own moments ----------

interface StepLook extends Band {
  level: number;
  tau: number;
  /** A crunch: grains over a span of seconds. */
  grains?: number;
  span?: number;
  /** The hollow under floorboards, in Hz. */
  body?: number;
}

const STEP_LOOK: Readonly<Record<Surface, StepLook>> = {
  grass: { type: "lowpass", freq: 1400, q: 0.5, level: 0.8, tau: 0.015 },
  soft: { type: "lowpass", freq: 1800, q: 0.5, level: 0.7, tau: 0.015 },
  rug: { type: "lowpass", freq: 800, q: 0.5, level: 0.9, tau: 0.015 },
  sand: { type: "bandpass", freq: 2600, q: 0.8, level: 0.5, tau: 0.008, grains: 6, span: 0.08 },
  snow: { type: "bandpass", freq: 1500, q: 0.9, level: 0.8, tau: 0.01, grains: 7, span: 0.11 },
  leaves: { type: "bandpass", freq: 4200, q: 0.7, level: 0.5, tau: 0.007, grains: 8, span: 0.12 },
  stone: { type: "bandpass", freq: 2200, q: 1.6, level: 1, tau: 0.006 },
  wood: { type: "bandpass", freq: 1500, q: 1.2, level: 0.6, tau: 0.006, body: 200 },
};

/** A footstep on `surface`: a soft pat on grass, a crunch in snow, leaves, or sand, a tap on stone. */
export function footstep(
  ctx: BaseAudioContext,
  out: AudioNode,
  when: number,
  surface: Surface,
  white: AudioBuffer,
  level = 1,
) {
  const look = STEP_LOOK[surface];
  const k = rand(0.9, 1.1);
  burst(
    ctx,
    out,
    when,
    white,
    { type: look.type, freq: look.freq * k, q: look.q },
    look.level * level * rand(0.8, 1.1),
    look.tau,
    look.grains,
    look.span,
  );
  if (look.body) strike(ctx, out, when, look.body * k, 0.25 * level, 0.04, 0.8);
}

/** Something set down: a knock in its material, then a softer one as it settles (not when `soft`). */
export function knock(
  ctx: BaseAudioContext,
  out: AudioNode,
  when: number,
  material: Material,
  white: AudioBuffer,
  soft = false,
) {
  const v = soft ? 0.5 : 1;
  const k = rand(0.94, 1.06);
  switch (material) {
    case "wood":
      // A wood block's "tok": a tone that drops as it's struck, a partial above, and a click.
      strike(ctx, out, when, 380 * k, 0.5 * v, 0.04, 0.85);
      strike(ctx, out, when, 1050 * k, 0.16 * v, 0.018, 0.92);
      burst(ctx, out, when, white, { type: "bandpass", freq: 2000 * k, q: 1.2 }, 0.8 * v, 0.005);
      if (!soft) {
        strike(ctx, out, when + 0.075, 420 * k, 0.18, 0.03, 0.88);
        burst(ctx, out, when + 0.075, white, { type: "bandpass", freq: 2100, q: 1.2 }, 0.3, 0.004);
      }
      break;
    case "stone":
      strike(ctx, out, when, 420 * k, 0.4 * v, 0.025, 0.88);
      strike(ctx, out, when, 970 * k, 0.15 * v, 0.012);
      burst(ctx, out, when, white, { type: "bandpass", freq: 3000 * k, q: 1.5 }, 1.1 * v, 0.004);
      if (!soft) {
        burst(
          ctx,
          out,
          when + 0.055,
          white,
          { type: "bandpass", freq: 2400, q: 1 },
          0.45,
          0.004,
          3,
          0.04,
        );
      }
      break;
    case "glass":
      for (const [ratio, level, tau] of [
        [1, 0.14, 0.18],
        [1.68, 0.09, 0.11],
        [2.5, 0.05, 0.07],
      ] as const) {
        strike(ctx, out, when, 1650 * k * ratio, 1.4 * level * v, tau);
      }
      burst(ctx, out, when, white, { type: "highpass", freq: 5000, q: 0.7 }, 0.2 * v, 0.003);
      break;
    case "metal":
      for (const [ratio, level, tau] of [
        [1, 0.12, 0.3],
        [2.67, 0.07, 0.15],
        [4.45, 0.04, 0.08],
      ] as const) {
        strike(ctx, out, when, 880 * k * ratio, 1.4 * level * v, tau);
      }
      burst(ctx, out, when, white, { type: "bandpass", freq: 4000, q: 1 }, 0.3 * v, 0.003);
      break;
    case "leaf":
      burst(
        ctx,
        out,
        when,
        white,
        { type: "bandpass", freq: 3200 * k, q: 0.6 },
        1.5 * v,
        0.012,
        4,
        0.13,
      );
      break;
    case "soft":
      burst(ctx, out, when, white, { type: "lowpass", freq: 700, q: 0.7 }, 1.2 * v, 0.03);
      strike(ctx, out, when, 120 * k, 0.3 * v, 0.05, 0.85);
      break;
  }
}

/** Something taken up: a small rising pop. */
export function lift(ctx: BaseAudioContext, out: AudioNode, when: number, white: AudioBuffer) {
  const k = rand(0.94, 1.06);
  strike(ctx, out, when, 300 * k, 0.35, 0.035, 1.7);
  burst(ctx, out, when, white, { type: "lowpass", freq: 1200, q: 0.7 }, 0.5, 0.006);
}

/** Each chime's notes (MIDI), the gap between them, and its partials: ratio, level, decay. */
const CHIMES: Readonly<
  Record<
    Chime,
    {
      notes: readonly number[];
      gap: number;
      partials: readonly (readonly [number, number, number])[];
    }
  >
> = {
  // A wave hello: E5 up to B5.
  wave: {
    notes: [76, 83],
    gap: 0.12,
    partials: [
      [1, 1, 0.5],
      [2, 0.28, 0.28],
      [3, 0.08, 0.16],
    ],
  },
  // A hug, a kiss, comfort: C5, E5, G5, round and slow.
  warm: {
    notes: [72, 76, 79],
    gap: 0.16,
    partials: [
      [1, 1, 0.75],
      [2, 0.16, 0.4],
    ],
  },
  // A gift, or kindness: G5 up to G6, quick and bell-like.
  sparkle: {
    notes: [79, 84, 88, 91],
    gap: 0.075,
    partials: [
      [1, 1, 0.42],
      [2.76, 0.22, 0.22],
      [5.4, 0.07, 0.11],
    ],
  },
};

/** A chime of a few soft bell notes, each a little quieter than the last. */
export function chime(
  ctx: BaseAudioContext,
  out: AudioNode,
  wet: AudioNode,
  when: number,
  kind: Chime,
) {
  const look = CHIMES[kind];
  const send = ctx.createGain();
  send.gain.value = 0.6;
  send.connect(wet);
  let last: { osc: OscillatorNode; end: number } | undefined;
  look.notes.forEach((midi, i) => {
    const t = when + i * look.gap;
    const freq = 440 * 2 ** ((midi - 69) / 12);
    for (const [ratio, amp, tau] of look.partials) {
      const voice = strike(ctx, [out, send], t, freq * ratio, 0.3 * amp * (1 - i * 0.08), tau);
      if (!last || voice.end > last.end) last = voice;
    }
  });
  if (last) release(last.osc, [send]);
}
