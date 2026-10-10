import type { Result } from "@terrakin/ui/http";
import { describe, expect, it } from "vitest";
import { both, type Problem, pageData, withOptional } from "./page-data";

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const offline: Result<never> = {
  ok: false,
  status: 0,
  code: "offline",
  message: "Can't reach Terrakin right now.",
};
const notThere: Result<never> = {
  ok: false,
  status: 404,
  code: "not_found",
  message: "No such table.",
};

/** Let the loader see an answer the test just gave. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A page whose answers the test hands out one at a time, in the order they were asked for. */
function page() {
  const asked: ((r: Result<string>) => void)[] = [];
  const drawn: string[] = [];
  const problems: Problem[] = [];
  let retry: (() => Promise<void>) | undefined;
  const data = pageData<string>({
    ask: () => new Promise((resolve) => asked.push(resolve)),
    paint: (d) => drawn.push(d),
    fail: (problem, again) => {
      problems.push(problem);
      retry = again;
    },
  });
  return {
    data,
    drawn,
    problems,
    /** How many asks are out and unanswered. */
    out: () => asked.length,
    retry: () => retry?.(),
    async answer(r: Result<string>) {
      asked.shift()?.(r);
      await settle();
    },
  };
}

describe("a page's data", () => {
  it("draws nothing on a page that was left before its answer came", async () => {
    const p = page();
    p.data.leave();
    await p.answer(ok("jobs"));
    expect(p.data.gone()).toBe(true);
    expect(p.drawn).toEqual([]);
    expect(p.problems).toEqual([]);
  });

  it("says why a first load failed, and draws the page once Try again works", async () => {
    const p = page();
    await p.answer(offline);
    expect(p.problems).toEqual([{ message: "Can't reach Terrakin right now.", missing: false }]);
    void p.retry();
    await p.answer(ok("jobs"));
    expect(p.drawn).toEqual(["jobs"]);
  });

  it("keeps what's drawn when a refresh fails, unless the thing is gone", async () => {
    const p = page();
    await p.answer(ok("round 1"));
    void p.data.refresh();
    await p.answer(offline);
    expect(p.problems).toEqual([]);
    void p.data.refresh();
    await p.answer(notThere);
    expect(p.problems).toEqual([{ message: "No such table.", missing: true }]);
  });

  it("asks one at a time: a refresh made mid-ask goes right after it and waits for its own answer", async () => {
    const p = page();
    let ready = false;
    let refreshed = false;
    void p.data.ready.then(() => {
      ready = true;
    });
    void p.data.refresh().then(() => {
      refreshed = true;
    });
    expect(p.out()).toBe(1);
    await p.answer(ok("before the buy"));
    expect(p.drawn).toEqual(["before the buy"]);
    // The page is ready with its first answer, whatever is still to come.
    expect(ready).toBe(true);
    expect(p.out()).toBe(1);
    expect(refreshed).toBe(false);
    await p.answer(ok("after the buy"));
    expect(p.drawn).toEqual(["before the buy", "after the buy"]);
    expect(refreshed).toBe(true);
  });

  it("asks nothing more once the page was left", async () => {
    const p = page();
    await p.answer(ok("jobs"));
    p.data.leave();
    await p.data.refresh();
    expect(p.out()).toBe(0);
  });
});

describe("answers a page needs together", () => {
  it("both gives the first failure, so a missing resident reads as missing", async () => {
    expect(await both(Promise.resolve(ok(1)), Promise.resolve(ok("a")))).toEqual(ok([1, "a"]));
    expect(await both(Promise.resolve(notThere), Promise.resolve(offline))).toBe(notThere);
    expect(await both(Promise.resolve(ok(1)), Promise.resolve(offline))).toBe(offline);
  });

  it("withOptional shows the page without the extra when it fails or wasn't asked for", async () => {
    expect(await withOptional(Promise.resolve(ok(1)), Promise.resolve(offline))).toEqual(
      ok([1, null]),
    );
    expect(await withOptional(Promise.resolve(ok(1)), null)).toEqual(ok([1, null]));
    expect(await withOptional(Promise.resolve(offline), Promise.resolve(ok("a")))).toBe(offline);
  });
});
