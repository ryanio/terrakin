import { describe, expect, it } from "vitest";
import { populationLine } from "./landing";
import { filterBreadcrumb, scrubEvent } from "./telemetry";

describe("error reports carry nothing private", () => {
  it("removes the saved token wherever it appears, and token-like keys", () => {
    const token = "tk_abc123secretvalue";
    const event = {
      message: `socket closed for ${token}`,
      extra: { hello: { type: "hello", token }, authorization: "Bearer xyz" },
      breadcrumbs: [{ message: `{"token":"${token}"}` }],
    };
    const out = scrubEvent(event, token);
    expect(JSON.stringify(out)).not.toContain(token);
    expect(out.extra.hello.token).toBe("[redacted]");
    expect(out.extra.authorization).toBe("[redacted]");
    expect(out.message).toBe("socket closed for [redacted]");
  });

  it("redacts token values in text even when no token is saved", () => {
    const out = scrubEvent({ message: 'bad hello {"token":"zzz999yyy"}' }, null);
    expect(out.message).not.toContain("zzz999yyy");
  });

  it("drops console and input breadcrumbs, which can hold chat text", () => {
    expect(filterBreadcrumb({ category: "console", message: "chat: hi" })).toBeNull();
    expect(filterBreadcrumb({ category: "ui.input", message: "input#chat-input" })).toBeNull();
    expect(filterBreadcrumb({ message: "no category" })).toBeNull();
  });

  it("keeps navigation and request breadcrumbs, without query strings", () => {
    const crumb = filterBreadcrumb({
      category: "fetch",
      data: { url: "/v1/world?x=1", method: "GET" },
    });
    expect(crumb?.data).toEqual({ url: "/v1/world", method: "GET" });
    expect(filterBreadcrumb({ category: "ui.click", message: "button#claim" })).not.toBeNull();
  });
});

describe("landing live line", () => {
  it("counts residents and who is online", () => {
    expect(populationLine(12, 3)).toBe("12 residents, 3 online now");
    expect(populationLine(1, 1)).toBe("1 resident, 1 online now");
    expect(populationLine(5, 0)).toBe("5 residents, quiet right now");
    expect(populationLine(0, 0)).toBe("Nobody here yet. Be the first");
  });
});
