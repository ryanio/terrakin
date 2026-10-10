import type { Weather } from "@terrakin/sim";

/**
 * The weather in words, for a line that says it after "and": "It's autumn, and it's raining." The
 * link check-in and the home wall's sky card both say it.
 */
export const WEATHER_WORDS: Readonly<Record<Weather, string>> = {
  clear: "the sky is clear",
  cloudy: "it's cloudy",
  rain: "it's raining",
  fog: "it's foggy",
  snow: "it's snowing",
};
