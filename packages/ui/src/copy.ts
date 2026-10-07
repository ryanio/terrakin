/**
 * Copying: a line with a Copy button (`copyBlock`), the button alone (`copyButton`), and the
 * screen reader announcement it makes. Its own module, with only the DOM helpers and the toast, so
 * the docs pages load it without the app (decision 0211). `ui.ts` re-exports all of it.
 */
import { h, icon } from "./dom";
import { toast } from "./toast";

/** How long a copy button says "Copied" before it goes back. */
const COPIED_MS = 2600;

let announcer: HTMLElement | undefined;

/**
 * Say `text` to screen readers without showing it, for a result that only changes a label. The
 * live region sits in `near`'s dialog when it has one, since an open modal hides the rest of the
 * page from them.
 */
export function announce(text: string, near?: Element) {
  const host = near?.closest("dialog") ?? document.body;
  if (announcer?.parentElement !== host) {
    announcer?.remove();
    announcer = h("p", { class: "visually-hidden", attrs: { role: "status" } });
    host.append(announcer);
  }
  const el = announcer;
  el.textContent = "";
  // A live region reads what changes in it, so the words go in a moment after it's ready.
  setTimeout(() => {
    el.textContent = text;
  }, 100);
}

export interface CopyButtonOptions {
  /** The label at rest, like "Copy" or "Copy link". */
  idle: string;
  copied?: string;
  /** Shown when the clipboard refused and `fallback` got selected instead. */
  selected?: string;
  /** Selected when the clipboard refuses, so a long-press copy works. */
  fallback?: Element;
  /** The toast when the clipboard refuses and there is nothing on the page to select. */
  failed?: string;
  /** After each try, and again with `null` when the label goes back to `idle`. */
  onChange?: (state: "copied" | "selected" | "failed" | null) => void;
}

/**
 * Make `button` copy `text()` when tapped and say so on `label` for a moment. Every copy button
 * in both apps goes through here, so they all answer the same way.
 */
export function copyButton(
  button: HTMLButtonElement,
  label: HTMLElement,
  text: () => string,
  o: CopyButtonOptions,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener("click", async () => {
    const ok = await copyText(text(), o.fallback);
    const state = ok ? "copied" : o.fallback ? "selected" : "failed";
    if (state === "failed") toast(o.failed ?? "Couldn't copy. Press and hold the text to copy it.");
    label.textContent =
      state === "copied"
        ? (o.copied ?? "Copied")
        : state === "selected"
          ? (o.selected ?? "Selected")
          : o.idle;
    o.onChange?.(state);
    // A changed label isn't read out, so say it. A failure already said so in the toast.
    if (state !== "failed") announce(label.textContent ?? "", button);
    clearTimeout(timer);
    timer = setTimeout(() => {
      label.textContent = o.idle;
      o.onChange?.(null);
    }, COPIED_MS);
  });
}

/**
 * A line to copy, with a caption and a Copy button. The text sits in one paragraph with no hard
 * breaks, so it wraps on screen and copies as one line.
 */
export function copyBlock(caption: string, text: string, className = ""): HTMLElement {
  const body = h("p", { class: "copy-text", text });
  const label = h("span", { text: "Copy" });
  // The caption is in the button's name as hidden words, not an aria-label, so the name follows
  // the label when it says "Copied".
  const button = h(
    "button",
    { class: "pill-button small copy-button", attrs: { type: "button" } },
    icon("copy"),
    label,
    h("span", { class: "visually-hidden", text: `: ${caption}` }),
  );
  copyButton(button, label, () => body.textContent ?? text, { idle: "Copy", fallback: body });
  return h(
    "figure",
    { class: ["copy-line", className].filter(Boolean).join(" ") },
    h("figcaption", { class: "copy-caption", text: caption }),
    body,
    button,
  );
}

/** Copy text, or select `fallback` so a long-press copy works. Returns true when it copied. */
export async function copyText(text: string, fallback?: Element): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallback) {
      const range = document.createRange();
      range.selectNodeContents(fallback);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    return false;
  }
}
