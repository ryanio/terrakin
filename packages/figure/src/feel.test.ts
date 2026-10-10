import { describe, expect, it } from "vitest";
import { clipFor, faceFor } from "./feel.js";

const face =
  (...keys: string[]) =>
  (key: string) =>
    keys.includes(key);

describe("faceFor", () => {
  it.each([
    ["happy", ["happy", "smile", "blink"], { happy: 1, smile: 1 }],
    ["happy", ["smile"], { smile: 1 }],
    ["laugh", ["happy"], { happy: 1 }],
    ["sad", ["sad", "blink"], { sad: 1 }],
    ["sad", ["blink"], { blink: 0.5 }],
    ["sleepy", ["blink"], { blink: 1 }],
    ["surprised", ["happy", "smile"], {}],
    ["neutral", ["happy", "smile", "blink"], {}],
    ["happy", [], {}],
  ] as const)("shows %s on a face with %j as %j", (feeling, keys, shown) => {
    expect(faceFor(feeling, face(...keys))).toEqual(shown);
  });
});

describe("clipFor", () => {
  it.each([
    ["walk", ["idle", "walk"], { clip: "walk" }],
    ["walk", ["idle"], { clip: "idle", made: "bob" }],
    ["hop", ["idle"], { clip: "idle", made: "squash" }],
    ["sit", ["idle"], { clip: "idle" }],
    ["stance_proud", ["idle", "stance_proud"], { clip: "stance_proud" }],
  ] as const)("plays %s on a body with %j as %j", (clip, clips, choice) => {
    expect(clipFor(clip, face(...clips))).toEqual(choice);
  });
});
