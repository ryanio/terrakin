import { describe, expect, it } from "vitest";
import { candleLit } from "./decor-hanukkah";

/** Which of the menorah's nine candles burn, left to right, as a string: H is the helper. */
const lit = (night: number) =>
  Array.from({ length: 9 }, (_, i) => (candleLit(i, night) ? (i === 4 ? "H" : "*") : ".")).join("");

describe("the menorah's candles", () => {
  it("light the helper and one more candle each night, from the far right", () => {
    expect(lit(0)).toBe(".........");
    expect(lit(1)).toBe("....H...*");
    expect(lit(2)).toBe("....H..**");
    expect(lit(5)).toBe("...*H****");
    expect(lit(8)).toBe("****H****");
  });
});
