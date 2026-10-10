import { describe, expect, it } from "vitest";
import { glbJson } from "./glb.js";

/** A version 2 `.glb` holding `json` and, after it, a binary chunk. */
function glb(json: string, change: (view: DataView) => void = () => {}): Uint8Array {
  const text = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, " "));
  const bytes = new Uint8Array(20 + text.length + 8 + 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, text.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(text, 20);
  view.setUint32(20 + text.length, 4, true);
  view.setUint32(24 + text.length, 0x004e4942, true);
  change(view);
  return bytes;
}

describe("glbJson", () => {
  it("reads the JSON of a .glb, wherever its bytes sit in their buffer", () => {
    const file = glb('{"asset":{"version":"2.0"}}');
    expect(glbJson(file)).toEqual({ asset: { version: "2.0" } });
    const shifted = new Uint8Array(file.length + 3);
    shifted.set(file, 3);
    expect(glbJson(shifted.subarray(3))).toEqual({ asset: { version: "2.0" } });
  });

  it.each<[string, Uint8Array, string]>([
    ["is cut short", glb("{}").subarray(0, 12), "too short"],
    ["starts with other bytes", glb("{}", (v) => v.setUint32(0, 0x474e5089, true)), "wrong magic"],
    ["is version 1", glb("{}", (v) => v.setUint32(4, 1, true)), "not version 2"],
    ["is shorter than its header says", glb("{}").subarray(0, 30), "doesn't match its header"],
    ["leads with its binary chunk", glb("{}", (v) => v.setUint32(16, 0x004e4942, true)), "no JSON"],
    [
      "says its JSON is longer than it is",
      glb("{}", (v) => v.setUint32(12, 400, true)),
      "past its end",
    ],
  ])("refuses a file that %s", (_what, bytes, why) => {
    expect(() => glbJson(bytes)).toThrow(why);
  });

  it("refuses more JSON than the caller allows before parsing any", () => {
    expect(() => glbJson(glb(`{"pad":"${"x".repeat(64)}"}`), 32)).toThrow("too much JSON");
  });
});
