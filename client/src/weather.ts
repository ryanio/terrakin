/**
 * The sky over the world (decision 0073): the weather and the season, read off the server's clock
 * the way day and night are (decision 0011), and how much cloud, rain, snow, and fog to draw, eased
 * so a new spell drifts in rather than popping. Drawing only: nothing here reaches the server or
 * the sim. The map draws it with `drawWeather`; the 3D views (`scene3d/weather.ts`) read the same
 * amounts. With `still` (prefers-reduced-motion) everything holds still where it is.
 */
import { type Season, seasonOf, skyAt, type Weather } from "@terrakin/sim";
import { type Camera, tileToScreen } from "./camera";

/** How much of each to draw, 0 to 1. */
export interface SkyAmounts {
  cloud: number;
  rain: number;
  snow: number;
  fog: number;
}

/** What each weather brings. Rain and snow come under cloud; fog thins the sun a little. */
export const WEATHER_LOOK: Readonly<Record<Weather, Readonly<SkyAmounts>>> = {
  clear: { cloud: 0, rain: 0, snow: 0, fog: 0 },
  cloudy: { cloud: 1, rain: 0, snow: 0, fog: 0 },
  rain: { cloud: 1, rain: 1, snow: 0, fog: 0 },
  fog: { cloud: 0.35, rain: 0, snow: 0, fog: 1 },
  snow: { cloud: 0.6, rain: 0, snow: 1, fog: 0 },
};

/** How long a new spell takes to drift in, in ms. */
export const SKY_FADE_MS = 6000;

/** Rain heavy enough that umbrellas go up. */
export const UMBRELLA_RAIN = 0.5;

const KEYS = ["cloud", "rain", "snow", "fog"] as const;

/**
 * The season and the weather now. With the server's clock (`serverMs`), the weather of its hour
 * and the season of the world's day (`skyAt`, as the server reads it); without one, no weather, and
 * the season of the world's day when it counts days.
 */
export function skyNow(
  serverMs: number | undefined,
  worldDay: number | undefined,
): { season: Season | undefined; weather: Weather } {
  if (serverMs !== undefined) return skyAt(serverMs, worldDay);
  return { season: worldDay === undefined ? undefined : seasonOf(worldDay), weather: "clear" };
}

/** The amounts to draw, eased toward the weather's own over `SKY_FADE_MS`. */
export class Sky {
  readonly amounts: SkyAmounts = { ...WEATHER_LOOK.clear };
  #at: number | undefined;

  /** Move toward `weather`'s look. The first call, and any with `still`, go straight there. */
  update(weather: Weather, now: number, still: boolean): SkyAmounts {
    const want = WEATHER_LOOK[weather];
    const step = this.#at === undefined || still ? 1 : Math.max(0, now - this.#at) / SKY_FADE_MS;
    this.#at = now;
    for (const key of KEYS) {
      const gap = want[key] - this.amounts[key];
      this.amounts[key] =
        Math.abs(gap) <= step ? want[key] : this.amounts[key] + Math.sign(gap) * step;
    }
    return this.amounts;
  }

  /** Raining enough for umbrellas to go up. */
  get raining(): boolean {
    return this.amounts.rain >= UMBRELLA_RAIN;
  }
}

// ---------- drawing it on the map ----------

/** Fixed numbers from 0 to 1 for every drop, flake, cloud, and ripple, so nothing allocates. */
const SEEDS = (() => {
  const out = new Float32Array(1024);
  let s = 0x2545f491;
  for (let i = 0; i < out.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    out[i] = (s >>> 0) / 4294967296;
  }
  return out;
})();
const seed = (i: number, k: number) => SEEDS[(i * 4 + k) & 1023] as number;

let cloudSprite: HTMLCanvasElement | undefined;
let fogSprite: HTMLCanvasElement | undefined;

/** A soft lumpy cloud's shadow, drawn once: three blobs of shade fading out at the edges. */
function cloudShadow(): HTMLCanvasElement {
  if (cloudSprite) return cloudSprite;
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 96;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  for (const [x, y, r] of [
    [62, 52, 44],
    [102, 46, 40],
    [82, 36, 34],
  ] as const) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(46, 56, 82, 0.55)");
    grad.addColorStop(1, "rgba(46, 56, 82, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
  }
  cloudSprite = c;
  return c;
}

/** A wide soft band of mist, drawn once. */
function fogBand(): HTMLCanvasElement {
  if (fogSprite) return fogSprite;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.translate(128, 32);
  g.scale(4, 1);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 32);
  grad.addColorStop(0, "rgba(246, 243, 236, 0.9)");
  grad.addColorStop(1, "rgba(246, 243, 236, 0)");
  g.fillStyle = grad;
  g.fillRect(-32, -32, 64, 64);
  fogSprite = c;
  return c;
}

/** Cloud shadows repeat every this many tiles, and drift with the wind, in tiles a second. */
const CLOUD_TILE = 26;
const CLOUDS = 5;
const WIND = { x: 0.32, y: 0.07 };
/** Raindrops and snowflakes per square pixel, and at most anywhere. */
const DROPS_PER_PX = 1 / 1700;
const MAX_DROPS = 260;
const RIPPLES = 22;
const RIPPLE_MS = 900;

export interface WeatherFrame {
  cam: Camera;
  sky: SkyAmounts;
  /** The frame's time, in ms. */
  now: number;
  still: boolean;
  /** Whether a tile is open ground, where rain can splash. */
  open(x: number, y: number): boolean;
}

/**
 * Draw the weather over the map, under the night and the name tags: a grey wash and drifting cloud
 * shadows, mist, rain with splashes on the ground, and snow. Each kind is one or two paths, and the
 * shapes are stamped from canvases drawn once, so it stays cheap on a phone.
 */
export function drawWeather(ctx: CanvasRenderingContext2D, f: WeatherFrame) {
  const { sky } = f;
  if (sky.cloud + sky.rain + sky.snow + sky.fog < 0.01) return;
  ctx.save();
  paintWeather(ctx, f);
  ctx.restore();
}

function paintWeather(ctx: CanvasRenderingContext2D, f: WeatherFrame) {
  const { cam, sky } = f;
  const { width, height, scale } = cam;
  const t = f.still ? 0 : f.now / 1000;

  // Overcast: everything a little greyer and cooler, more so in rain.
  const grey = Math.min(1, sky.cloud * 0.7 + sky.rain * 0.3);
  if (grey > 0.01) {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = `rgb(${Math.round(255 - 32 * grey)}, ${Math.round(255 - 27 * grey)}, ${Math.round(255 - 14 * grey)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
  }

  // Cloud shadows sliding over the ground, anchored to the world so they pass under you.
  if (sky.cloud > 0.01) {
    const art = cloudShadow();
    const w = scale * 9;
    const h = scale * 5.4;
    const left = cam.cx - width / scale / 2;
    const top = cam.cy - height / scale / 2;
    ctx.globalAlpha = Math.min(1, sky.cloud) * 0.5;
    for (let i = 0; i < CLOUDS; i++) {
      const ox = seed(i, 0) * CLOUD_TILE + WIND.x * t;
      const oy = seed(i, 1) * CLOUD_TILE + WIND.y * t;
      // Every copy of this cloud, one a tile period apart, that could reach the screen.
      const kx0 = Math.floor((left - 9 - ox) / CLOUD_TILE);
      const ky0 = Math.floor((top - 5.4 - oy) / CLOUD_TILE);
      for (let kx = kx0; ox + kx * CLOUD_TILE < left + width / scale; kx++) {
        for (let ky = ky0; oy + ky * CLOUD_TILE < top + height / scale; ky++) {
          const at = tileToScreen(cam, ox + kx * CLOUD_TILE, oy + ky * CLOUD_TILE);
          ctx.drawImage(art, at.sx, at.sy, w, h);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // Mist: a pale veil, and soft bands of it drifting across.
  if (sky.fog > 0.01) {
    ctx.fillStyle = `rgba(242, 238, 230, ${(0.24 * sky.fog).toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
    const band = fogBand();
    ctx.globalAlpha = 0.42 * sky.fog;
    const bw = width * 1.5;
    for (let i = 0; i < 4; i++) {
      const drift = (seed(i, 2) * bw + t * (10 + seed(i, 3) * 8)) % (width + bw);
      ctx.drawImage(band, drift - bw * 0.75, height * (0.08 + i * 0.25), bw, height * 0.22);
    }
    ctx.globalAlpha = 1;
  }

  const drops = Math.min(MAX_DROPS, Math.round(width * height * DROPS_PER_PX));

  if (sky.rain > 0.01) {
    // Splashes where drops land, each a ring on open ground that widens and fades.
    const tiles = { x: cam.cx - width / scale / 2, y: cam.cy - height / scale / 2 };
    const ms = f.still ? RIPPLE_MS / 2 : f.now;
    ctx.lineWidth = Math.max(1, scale / 30);
    for (let i = 0; i < Math.round(RIPPLES * sky.rain); i++) {
      const shifted = ms + seed(i, 0) * RIPPLE_MS;
      const round = Math.floor(shifted / RIPPLE_MS);
      const k = (shifted % RIPPLE_MS) / RIPPLE_MS;
      const x = Math.floor(tiles.x + seed(i + round, 1) * (width / scale + 1));
      const y = Math.floor(tiles.y + seed(i + round * 3, 2) * (height / scale + 1));
      if (!f.open(x, y)) continue;
      const at = tileToScreen(cam, x + seed(i, 3) - 0.5, y + seed(i + 7, 3) - 0.5);
      const r = scale * (0.06 + 0.2 * k);
      ctx.strokeStyle = `rgba(232, 240, 250, ${(0.55 * (1 - k)).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(at.sx, at.sy, r, r * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Streaks falling with a little wind from the west.
    const n = Math.round(drops * sky.rain);
    const len = Math.max(9, scale * 0.42);
    const slant = 0.24;
    const span = height + len;
    const streaks = new Path2D();
    for (let i = 0; i < n; i++) {
      const speed = 640 + seed(i, 2) * 280;
      const y = ((seed(i, 1) * span + t * speed) % span) - len;
      const x = ((seed(i, 0) * (width + 80) + y * slant) % (width + 80)) - 40;
      streaks.moveTo(x - len * slant, y - len);
      streaks.lineTo(x, y);
    }
    // A soft dark edge and a pale core, so the rain shows on light ground and dark alike.
    ctx.lineCap = "round";
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = "rgba(64, 84, 120, 0.22)";
    ctx.stroke(streaks);
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = "rgba(236, 243, 252, 0.75)";
    ctx.stroke(streaks);
  }

  if (sky.snow > 0.01) {
    // Flakes drifting down, swaying as they fall.
    const n = Math.round(drops * 0.8 * sky.snow);
    const flakes = new Path2D();
    for (let i = 0; i < n; i++) {
      const size = 1.3 + seed(i, 3) * 1.9;
      const speed = 28 + seed(i, 2) * 40;
      const y = ((seed(i, 1) * (height + 12) + t * speed) % (height + 12)) - 6;
      const sway = Math.sin(t * 1.1 + seed(i, 3) * 6.28) * 12;
      const x = (((seed(i, 0) * (width + 40) + sway) % (width + 40)) + width + 40) % (width + 40);
      flakes.moveTo(x - 20 + size, y);
      flakes.arc(x - 20, y, size, 0, Math.PI * 2);
    }
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.fill(flakes);
  }
}
