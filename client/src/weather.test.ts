import { describe, expect, it } from "vitest";
import { SKY_FADE_MS, Sky, skyNow, WEATHER_LOOK } from "./weather";

describe("the sky", () => {
  it("reads the weather off the server's clock and the season off the world's day", () => {
    // 2026-10-06 at 07:00 UTC is a cloudy autumn morning; the world's day can lag the clock.
    expect(skyNow(Date.UTC(2026, 9, 6, 7), 20732)).toEqual({ season: "autumn", weather: "cloudy" });
    expect(skyNow(Date.UTC(2026, 9, 6, 7), 20787 + 1)).toMatchObject({ season: "winter" });
    // Without a clock from the server, no weather, and the season only from the world's day.
    expect(skyNow(undefined, 20732)).toEqual({ season: "autumn", weather: "clear" });
    expect(skyNow(undefined, undefined)).toEqual({ season: undefined, weather: "clear" });
  });

  it("starts in the weather it finds, and eases a new spell in over a few seconds", () => {
    const sky = new Sky();
    expect(sky.update("rain", 0, false)).toEqual(WEATHER_LOOK.rain);
    expect(sky.raining).toBe(true);
    const half = { ...sky.update("clear", SKY_FADE_MS / 2, false) };
    expect(half.rain).toBeCloseTo(0.5);
    expect(half.cloud).toBeCloseTo(0.5);
    expect(sky.update("clear", SKY_FADE_MS, false)).toEqual(WEATHER_LOOK.clear);
    expect(sky.raining).toBe(false);
  });

  it("goes straight to the new weather with reduced motion", () => {
    const sky = new Sky();
    sky.update("clear", 0, true);
    expect(sky.update("snow", 16, true)).toEqual(WEATHER_LOOK.snow);
  });
});
