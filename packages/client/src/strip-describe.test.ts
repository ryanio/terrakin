import { readdirSync, readFileSync } from "node:fs";
import { transformWithOxc } from "vite";
import { describe, expect, it } from "vitest";
import { stripDescribe } from "./strip-describe";

describe("stripDescribe", () => {
  it("drops descriptions made of string literals, joined or across lines", () => {
    expect(stripDescribe('z.string().describe("A name.").optional()')).toBe(
      "z.string().optional()",
    );
    expect(
      stripDescribe(
        "z.number()\n  .describe(\n    'Coins (a \\'purse\\'). ' +\n      `More.`,\n  )\n",
      ),
    ).toBe("z.number()\n  \n");
    expect(stripDescribe('x.describe("has ) and \\" inside")')).toBe("x");
  });

  it("keeps any call whose argument isn't plain literals", () => {
    for (const code of [
      "x.describe(text)",
      `x.describe(\`At most \${MAX} bytes.\`)`,
      'x.describe("a" + b)',
      "x.describe()",
      'x.describe("unclosed',
    ]) {
      expect(stripDescribe(code)).toBe(code);
    }
  });

  it("leaves every protocol module valid code with its literal descriptions gone", async () => {
    const dir = new URL("../../protocol/src/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    let removed = 0;
    for (const file of files) {
      const code = readFileSync(new URL(file, dir), "utf8");
      const out = stripDescribe(code);
      // Throws on code that doesn't parse.
      await transformWithOxc(out, file);
      removed += code.split(".describe(").length - out.split(".describe(").length;
    }
    expect(removed).toBeGreaterThan(150);
  });
});
