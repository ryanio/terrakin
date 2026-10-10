import { describe, expect, it } from "vitest";
import { sha256Hex, sha256HexSync } from "./bytes";

describe("SHA-256 as hex", () => {
  // Tokens, link keys, codes, and staff keys are stored as these hashes, and every other test
  // hashes and looks up in one process, so a changed hash would still pass there. These values
  // come from `shasum -a 256`, not from the code under test.
  const known: [string, string][] = [
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    // Text outside ASCII is hashed as UTF-8.
    ["k_héllo ✓", "f872100f1962c280cd285faf06645f811bcd641b6cc3ba9432be3f0178344ea8"],
  ];

  it("gives the hex a stored token or key was saved under, in both forms", async () => {
    for (const [text, hex] of known) {
      expect(sha256HexSync(text)).toBe(hex);
      expect(await sha256Hex(text)).toBe(hex);
    }
  });
});
