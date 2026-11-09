import type { Result } from "@terrakin/ui/http";
import { makeRequest, Nothing, OFFLINE } from "@terrakin/ui/http";
import { visiblePoll } from "@terrakin/ui/poll";
import { tipPlace } from "@terrakin/ui/tooltip-bubble";
import { confirmTwice, toastMs, whileBusyAll } from "@terrakin/ui/ui";
import { afterEach, describe, expect, it, vi } from "vitest";

/** A button with a label and click listeners, and nothing else. */
function fakeButton(label: string) {
  const listeners: (() => void)[] = [];
  const b = {
    textContent: label,
    addEventListener: (_type: string, f: () => void) => listeners.push(f),
    click: () => {
      for (const f of listeners) f();
    },
  };
  return { b, button: b as unknown as HTMLButtonElement };
}

describe("confirm twice", () => {
  it("asks on the first tap, acts on the second, and puts the label back", () => {
    const { b, button } = fakeButton("Block Wren");
    const act = vi.fn();
    confirmTwice(button, "Tap again to block", act);
    b.click();
    expect(b.textContent).toBe("Tap again to block");
    expect(act).not.toHaveBeenCalled();
    b.click();
    expect(act).toHaveBeenCalledOnce();
    expect(b.textContent).toBe("Block Wren");
    // And it asks again next time.
    b.click();
    expect(act).toHaveBeenCalledOnce();
  });

  it("acts on the first tap when there's nothing to ask, and disarm puts the label back", () => {
    const { b, button } = fakeButton("Unblock Wren");
    const act = vi.fn();
    const disarm = confirmTwice(button, "Tap again", act, () => false);
    b.click();
    expect(act).toHaveBeenCalledOnce();
    expect(b.textContent).toBe("Unblock Wren");

    const other = fakeButton("Suspend");
    const off = confirmTwice(other.button, "Tap again to suspend them", vi.fn());
    other.b.click();
    off();
    expect(other.b.textContent).toBe("Suspend");
    disarm();
    expect(b.textContent).toBe("Unblock Wren");
  });
});

describe("toasts", () => {
  it("stay up longer for longer words, and longer still with a link to reach", () => {
    expect(toastMs("Link copied")).toBe(4000);
    const long =
      "Thanks. A maintainer will look soon. If someone is in danger right now, call local emergency services.";
    expect(toastMs(long)).toBeGreaterThan(6000);
    expect(toastMs("Posted.", true)).toBeGreaterThanOrEqual(8000);
  });
});

describe("tooltips", () => {
  const phone = { width: 375, height: 812 };
  const bubble = { width: 200, height: 40 };

  it("sit over the label, and under it when the top of the screen is in the way", () => {
    const mid = { left: 150, right: 230, top: 300, bottom: 320 };
    expect(tipPlace(mid, bubble, phone)).toEqual({ left: 90, top: 252, below: false, arrow: 100 });
    const atTop = { ...mid, top: 20, bottom: 40 };
    expect(tipPlace(atTop, bubble, phone)).toMatchObject({ top: 48, below: true });
  });

  it("stay on a phone's screen by a pill at its edge, still pointing at the pill", () => {
    const right = tipPlace({ left: 330, right: 370, top: 300, bottom: 320 }, bubble, phone);
    expect(right.left).toBe(375 - 8 - 200);
    expect(right.arrow).toBe(350 - right.left);
    const left = tipPlace({ left: 0, right: 10, top: 300, bottom: 320 }, bubble, phone);
    expect(left.left).toBe(8);
    expect(left.arrow).toBe(12);
  });
});

describe("request errors", () => {
  it("tells someone whose key is unknown what to do, not the server's words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "unauthorized", message: "Missing or unknown bearer token." } },
          { status: 401 },
        ),
      ),
    );
    const request = makeRequest({ headers: () => ({}), unauthorized: "Restore your key." });
    const r = await request("GET", "/v1/purse", { safeParse: () => ({ success: true }) } as never);
    expect(r).toMatchObject({ ok: false, status: 401, message: "Restore your key." });
    vi.unstubAllGlobals();
  });

  const passes = { safeParse: (data: unknown) => ({ success: true as const, data }) };
  const fails = { safeParse: () => ({ success: false as const, error: "no" }) };
  it.each([
    {
      what: "a fetch that throws is offline",
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
      schema: passes,
      want: { ok: false, status: 0, code: "offline", message: OFFLINE },
      badResponse: false,
    },
    {
      what: "a 200 the schema refuses is a bad response, told to the app",
      fetch: async () => Response.json({ coins: "lots" }),
      schema: fails,
      want: { ok: false, status: 200, code: "bad_response" },
      badResponse: true,
    },
    {
      what: "a schema dump from the server reads as plain words",
      fetch: async () =>
        Response.json(
          { error: { code: "bad_request", message: '[{"path":["name"]}]' } },
          { status: 400 },
        ),
      schema: passes,
      want: { ok: false, code: "bad_request", message: "Something went wrong. Try again." },
      badResponse: false,
    },
    {
      what: "an object dump does too",
      fetch: async () =>
        Response.json(
          { error: { code: "bad_request", message: ' {"name":"bad"}' } },
          { status: 400 },
        ),
      schema: passes,
      want: { ok: false, message: "Something went wrong. Try again." },
      badResponse: false,
    },
    {
      what: "a plain message comes through",
      fetch: async () =>
        Response.json({ error: { code: "already_owned", message: "Taken." } }, { status: 409 }),
      schema: passes,
      want: { ok: false, status: 409, code: "already_owned", message: "Taken." },
      badResponse: false,
    },
    {
      what: "an empty 204 parses",
      fetch: async () => new Response(null, { status: 204 }),
      schema: Nothing,
      want: { ok: true, data: null },
      badResponse: false,
    },
  ])("$what", async ({ fetch, schema, want, badResponse }) => {
    vi.stubGlobal("fetch", vi.fn(fetch));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onBadResponse = vi.fn();
    const request = makeRequest({ headers: () => ({}), onBadResponse });
    expect(await request("GET", "/v1/purse", schema as never)).toMatchObject(want);
    expect(onBadResponse).toHaveBeenCalledTimes(badResponse ? 1 : 0);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("says the body is JSON only when it sends one", async () => {
    const fetch = vi.fn(async (_path: string, _init: RequestInit) => new Response(null));
    vi.stubGlobal("fetch", fetch);
    const request = makeRequest({ headers: () => ({ authorization: "Bearer t" }) });
    await request("GET", "/v1/purse", Nothing);
    await request("POST", "/v1/act", Nothing, { type: "leave" });
    const [get, post] = fetch.mock.calls.map(([, init]) => init);
    expect(get?.headers).toEqual({ authorization: "Bearer t" });
    expect(get?.body).toBeUndefined();
    expect(post?.headers).toEqual({
      authorization: "Bearer t",
      "content-type": "application/json",
    });
    expect(post?.body).toBe('{"type":"leave"}');
    vi.unstubAllGlobals();
  });
});

describe("a visible poll", () => {
  /** A visible page whose visibility listeners the test can call, and asks it settles by hand. */
  function page() {
    vi.useFakeTimers();
    const doc = { visibilityState: "visible", listeners: [] as (() => void)[] };
    vi.stubGlobal("document", {
      get visibilityState() {
        return doc.visibilityState;
      },
      addEventListener: (_: string, f: () => void) => doc.listeners.push(f),
    });
    let open = 0;
    let most = 0;
    const settle: (() => void)[] = [];
    const ask = vi.fn(() => {
      open += 1;
      most = Math.max(most, open);
      return new Promise<void>((resolve) => {
        settle.push(() => {
          open -= 1;
          resolve();
        });
      });
    });
    /** Settles the oldest ask and lets its `finally` run. */
    const finish = async () => {
      settle.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    };
    return { doc, ask, finish, most: () => most };
  }
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("skips an unforced ask inside the gap, but not a forced one", async () => {
    const { ask, finish } = page();
    const poll = visiblePoll(ask, { everyMs: 60_000, minGapMs: 1000 });
    poll.refresh();
    await finish();
    vi.advanceTimersByTime(500);
    poll.refresh();
    expect(ask).toHaveBeenCalledTimes(1);
    poll.refresh(true);
    expect(ask).toHaveBeenCalledTimes(2);
    await finish();
    vi.advanceTimersByTime(1000);
    poll.refresh();
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it("asks nothing, forced or not, while it isn't ready", () => {
    const { ask } = page();
    const poll = visiblePoll(ask, { everyMs: 1000, minGapMs: 0, ready: () => false });
    poll.refresh();
    poll.refresh(true);
    poll.start();
    vi.advanceTimersByTime(5000);
    expect(ask).not.toHaveBeenCalled();
  });

  it("runs forced asks made during one exactly once after it, never two at once", async () => {
    const { ask, finish, most } = page();
    const poll = visiblePoll(ask, { everyMs: 60_000, minGapMs: 0 });
    poll.refresh(true);
    poll.refresh(true);
    poll.refresh(true);
    poll.refresh();
    expect(ask).toHaveBeenCalledTimes(1);
    await finish();
    expect(ask).toHaveBeenCalledTimes(2);
    await finish();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(most()).toBe(1);
  });

  it("asks on the timer only while the page is visible and `when` says so", async () => {
    const { doc, ask, finish } = page();
    let when = false;
    const poll = visiblePoll(ask, { everyMs: 1000, minGapMs: 0, when: () => when });
    poll.start();
    vi.advanceTimersByTime(1000);
    expect(ask).not.toHaveBeenCalled();
    when = true;
    doc.visibilityState = "hidden";
    vi.advanceTimersByTime(1000);
    expect(ask).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    vi.advanceTimersByTime(1000);
    expect(ask).toHaveBeenCalledTimes(1);
    await finish();
    // Coming back to the tab asks too, though `when` only gates the timer.
    when = false;
    for (const f of doc.listeners) f();
    expect(ask).toHaveBeenCalledTimes(2);
  });
});

describe("a busy button group", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Buttons and a status line with only what the helper touches, and a page with no focus. */
  function group() {
    vi.stubGlobal("document", { activeElement: null, body: {} });
    const buttons = [0, 1].map(
      () =>
        ({ disabled: false, isConnected: true, focus: vi.fn() }) as unknown as HTMLButtonElement,
    );
    const status = { textContent: "" } as HTMLElement;
    return { buttons, status };
  }

  it("turns every button off and says Saving while it works, and keeps them off when it worked", async () => {
    const { buttons, status } = group();
    let finish: (r: Result<null>) => void = () => {};
    const running = whileBusyAll(buttons, buttons[0] as HTMLButtonElement, status, () => {
      return new Promise<Result<null>>((resolve) => {
        finish = resolve;
      });
    });
    expect(buttons.map((b) => b.disabled)).toEqual([true, true]);
    expect(status.textContent).toBe("Saving…");
    finish({ ok: true, data: null });
    expect((await running).ok).toBe(true);
    expect(buttons.map((b) => b.disabled)).toEqual([true, true]);
    expect(status.textContent).toBe("Saving…");
  });

  it("turns them back on and says why when it failed", async () => {
    const { buttons, status } = group();
    const res = await whileBusyAll(buttons, buttons[1] as HTMLButtonElement, status, async () => ({
      ok: false,
      status: 409,
      code: "conflict",
      message: "Someone else already decided this one.",
    }));
    expect(res.ok).toBe(false);
    expect(buttons.map((b) => b.disabled)).toEqual([false, false]);
    expect(status.textContent).toBe("Someone else already decided this one.");
  });
});
