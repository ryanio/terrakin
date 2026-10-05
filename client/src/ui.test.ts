import { confirmTwice, toastMs } from "@terrakin/ui/ui";
import { describe, expect, it, vi } from "vitest";

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
