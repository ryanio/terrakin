import { xIntentUrl, xPostText, xProfileUrl } from "@terrakin/protocol";
import { xIntentHref } from "@terrakin/ui/format";
import { describe, expect, it } from "vitest";

describe("the X connect line and links", () => {
  it("builds one public line, and an intent link that fills in exactly that line", () => {
    const text = xPostText("Wren\n  the  Builder", "r_0123456789abcdef", "tk-7kq2m9xa");
    expect(text).toBe(
      "Joining Terrakin as Wren the Builder · terrakin.org/r/r_0123456789abcdef · code tk-7kq2m9xa",
    );
    const intent = xIntentUrl(text);
    expect(intent.startsWith("https://x.com/intent/post?text=")).toBe(true);
    expect(intent).not.toMatch(/\s/);
    expect(new URL(intent).searchParams.get("text")).toBe(text);
    expect(xIntentHref(intent, text)).toBe(intent);
  });

  it("only opens X's own intent for that exact line", () => {
    const text = "Joining Terrakin as Wren · code tk-7kq2m9xa";
    expect(xIntentHref("https://evil.example/intent?text=hi", text)).toBeUndefined();
    expect(xIntentHref(xIntentUrl("something else"), text)).toBeUndefined();
    expect(xIntentHref(xIntentUrl("two\nlines"), "two\nlines")).toBeUndefined();
  });

  it("links only real handles", () => {
    expect(xProfileUrl("Wren_Owner")).toBe("https://x.com/Wren_Owner");
    expect(xProfileUrl("evil.com/x")).toBeUndefined();
    expect(xProfileUrl("javascript:alert(1)")).toBeUndefined();
    expect(xProfileUrl("far_too_long_handle")).toBeUndefined();
    expect(xProfileUrl("")).toBeUndefined();
  });
});
