import type { Result } from "@terrakin/ui/http";
import { makeRequest } from "@terrakin/ui/http";
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
