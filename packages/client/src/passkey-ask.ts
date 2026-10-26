/**
 * The passkey offer (RFC 0037, decision 0378): a sheet titled "Keep your character on any device"
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

/** The sheet on screen, or one waiting for the page to clear, so two moments never open two. */
let open = false;
/** The moment a waiting sheet will speak for: the latest one that came while it waited. */
let waiting: PasskeyMoment | undefined;

/** How long the page has to stay clear first, so a sheet opening right after one closes goes first. */
const SETTLE_MS = 600;

/** Resolve once no sheet has been over the page for `SETTLE_MS`, so the offer never covers one. */
async function whenClear(): Promise<void> {
  const root = document.documentElement;
  const clear = () => !root.classList.contains("overlay-open");
  for (;;) {
    if (!clear()) {
      await new Promise<void>((done) => {
        const watch = new MutationObserver(() => {
          if (!clear()) return;
          watch.disconnect();
          done();
        });
        watch.observe(root, { attributes: true, attributeFilter: ["class"] });
      });
    }
    await new Promise((done) => setTimeout(done, SETTLE_MS));
    if (clear()) return;
  }
}

/**
 * Offer `me` a passkey at `moment`, if the rule says to. A fresh join has none to read; at a later
 * moment the server says first whether one is bound. It waits for the page to be clear of other
 * sheets, and showing it is the ask, so it won't come back for a day whichever way it's answered,
 * or if it isn't.
 */
export async function askForPasskey(o: {
  me: string;
  kind: ProfileView["kind"];
  moment: PasskeyMoment;
}): Promise<void> {
  const works = passkeysWork();
  const rule = (passkeys: number) =>
    offerPasskey({ kind: o.kind, passkeys, works, askedAt: askedAt(o.me), nowMs: Date.now() });
  if (waiting && rule(0)) waiting = o.moment;
  if (open || !rule(0)) return;
  open = true;
  waiting = o.moment;
  let passkeys = 0;
  if (o.moment !== "joined") {
    const r = await signinApi.claims();
    passkeys = r.ok ? r.data.claims.length : 1;
    // One is bound: nothing to offer, and nothing to ask the server again for a day.
    if (r.ok && passkeys > 0) markAsked(o.me);
  }
  if (passkeys === 0) await whenClear();
  const moment = waiting;
  waiting = undefined;
  if (!rule(passkeys)) {
    open = false;
    return;
  }
  markAsked(o.me);
  showSheet(moment);
}

/** Whether a sheet other than the offer is open: one that took its place. */
const anotherSheet = () => document.querySelector("dialog[open]:not(#passkey-ask)") !== null;

/**
 * The sheet itself. Another sheet opening over it (a home after a claim, say) takes its place, and
 * it comes back once the page is clear again, since that was no answer.
 */
function showSheet(moment: PasskeyMoment) {
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
      lede: passkeyAskLine(moment),
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
    // The sheet that replaces this one is opened right after this runs.
    setTimeout(() => {
      if (anotherSheet()) void whenClear().then(() => showSheet(moment));
      else open = false;
    }, 0);
  });
}
