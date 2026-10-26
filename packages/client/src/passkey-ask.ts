/**
 * The passkey offer (RFC 0037, decision 0377): a sheet titled "Keep your character on any device"
 * whose one button opens the device's own passkey sheet, with a plain Skip. A person sees it right
 * after they join, and again at the moments that give them more to lose (a plot, a hearth, a first
 * level-up), at most once a day, until a passkey is bound. The home wall's card keeps the same
 * clock (`passkey-prompt.ts`).
 *
 * It is our sheet first, and the device's after one tap, because a browser opens its passkey sheet
 * only inside a tap, and the join's own tap has been spent on two requests by the time a passkey
 * could be asked for.
 */
import type { ProfileView } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { closeOverlay, errorLine, openOverlay, sheet, toast, whileBusy } from "@terrakin/ui/ui";
import { signinApi } from "./api/signin";
import "./passkey-ask.css";
import { passkeysWork } from "./passkey";
import { addPasskey } from "./passkey-sheet";
import {
  offerPasskey,
  PASSKEY_ASK_TITLE,
  type PasskeyMoment,
  passkeyAskLine,
} from "./passkey-words";

/** The resident this device last asked, and when: `r_… 1729…`. */
const ASKED_KEY = "terrakin.passkeyAsked";

/**
 * When this device last asked `me`, if it has. An older value holds the id alone, from when one
 * answer put the offer away for good: that reads as long ago, so it comes back.
 */
export function askedAt(me: string): number | undefined {
  try {
    const [id, at] = (localStorage.getItem(ASKED_KEY) ?? "").split(" ");
    if (id !== me) return undefined;
    const ms = Number(at);
    return Number.isFinite(ms) && at !== undefined ? ms : 0;
  } catch {
    return undefined;
  }
}

/** This device asked `me` now. */
export function markAsked(me: string) {
  try {
    localStorage.setItem(ASKED_KEY, `${me} ${Date.now()}`);
  } catch {
    // Storage off: the offer may come back sooner, which is all that's lost.
  }
}

/** The sheet on screen, so two moments close together never open two. */
let open = false;

/** Resolve once no sheet is over the page, so the offer never covers one someone is using. */
function whenClear(): Promise<void> {
  const root = document.documentElement;
  if (!root.classList.contains("overlay-open")) return Promise.resolve();
  return new Promise((done) => {
    const watch = new MutationObserver(() => {
      if (root.classList.contains("overlay-open")) return;
      watch.disconnect();
      done();
    });
    watch.observe(root, { attributes: true, attributeFilter: ["class"] });
  });
}

/**
 * Offer `me` a passkey at `moment`, if the rule says to. A fresh join has none to read; at a later
 * moment the server says first whether one is bound. Showing it is the ask, so it won't come back
 * for a day whichever way it's answered, or if it isn't.
 */
export async function askForPasskey(o: {
  me: string;
  kind: ProfileView["kind"];
  moment: PasskeyMoment;
}): Promise<void> {
  const works = passkeysWork();
  const rule = (passkeys: number) =>
    offerPasskey({ kind: o.kind, passkeys, works, askedAt: askedAt(o.me), nowMs: Date.now() });
  if (open || !rule(0)) return;
  let passkeys = 0;
  if (o.moment !== "joined") {
    const r = await signinApi.claims();
    if (!r.ok) return;
    passkeys = r.data.claims.length;
    // One is bound: nothing to offer, and nothing to ask the server again for a day.
    if (passkeys > 0) markAsked(o.me);
  }
  await whenClear();
  if (open || !rule(passkeys)) return;
  open = true;
  markAsked(o.me);

  const problem = errorLine("passkey-ask-error");
  const label = h("span", { text: "Add a passkey" });
  const add = h(
    "button",
    { class: "btn-primary", attrs: { type: "button", id: "passkey-ask-add" } },
    icon("key"),
    label,
  ) as HTMLButtonElement;
  const skip = h("button", {
    class: "text-button quiet passkey-ask-skip",
    attrs: { type: "button", id: "passkey-ask-skip" },
    text: "Skip",
  });
  const { dialog } = sheet(
    {
      id: "passkey-ask-title",
      title: PASSKEY_ASK_TITLE,
      className: "passkey-ask",
      lede: passkeyAskLine(o.moment),
      closeOnBackdrop: true,
    },
    h("div", { class: "stack" }, add, skip),
    problem,
  );
  dialog.id = "passkey-ask";
  add.addEventListener("click", () => {
    void whileBusy(
      add,
      async () => {
        problem.textContent = "";
        const failed = await addPasskey();
        if (failed) {
          problem.textContent = failed;
          return;
        }
        closeOverlay(dialog);
        toast("Passkey added. You can open Terrakin as this character on any device.");
      },
      "Waiting for your device…",
      label,
    );
  });
  skip.addEventListener("click", () => closeOverlay(dialog));
  openOverlay(dialog, () => {
    open = false;
  });
}
