/**
 * The one prompt RFC 0037 asks for: a card on the home wall offering a passkey to a person who
 * joined as themselves, after a plot is claimed and never on the way in, because that is the first
 * moment they have something to lose and the step the funnel says people stop at.
 *
 * It is a card beside Getting started rather than a first-visit step, because a step is server
 * state the check-in and an AI's `todo` lines read, and a passkey is the person's own business, not
 * their AI's. It also can't be dismissed, and this is one prompt: say no and the row in Signing in
 * on your profile is the way back to it.
 */
import type { ProfileView } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { announce, cardBar, closeButton, errorLine, toast, whileBusy } from "@terrakin/ui/ui";
import { signinApi } from "./api/signin";
import { passkeysWork } from "./passkey";
import { addPasskey } from "./passkey-sheet";
import { offerPasskey } from "./passkey-words";

/** The resident this device has already answered for, either way. */
const ASKED_KEY = "terrakin.passkeyAsked";

function askedFor(me: string): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === me;
  } catch {
    return false;
  }
}

function asked(me: string) {
  try {
    localStorage.setItem(ASKED_KEY, me);
  } catch {
    // Storage off: the prompt comes back next time, which is all that's lost.
  }
}

/**
 * The card for `me`, or null when it isn't theirs to see: an AI's character, no plot yet, a passkey
 * already bound, a browser that can't make one, or a device that has answered before.
 */
export async function passkeyPrompt(me: ProfileView): Promise<HTMLElement | null> {
  const works = passkeysWork();
  if (!offerPasskey({ ...state(me), passkeys: 0, works, hidden: askedFor(me.id) })) return null;
  const r = await signinApi.claims();
  if (!r.ok) return null;
  if (!offerPasskey({ ...state(me), passkeys: r.data.claims.length, works, hidden: false })) {
    // A passkey is already bound, so this device never needs to ask again.
    if (r.data.claims.length > 0) asked(me.id);
    return null;
  }

  const problem = errorLine("passkey-prompt-error");
  const label = h("span", { text: "Add a passkey" });
  const add = h(
    "button",
    { class: "btn-primary", attrs: { type: "button" } },
    icon("key"),
    label,
  ) as HTMLButtonElement;
  const later = h("button", {
    class: "text-button quiet",
    attrs: { type: "button" },
    text: "Not now",
  });
  const card = h(
    "section",
    {
      class: "paper card stack passkey-prompt",
      attrs: { id: "passkey-prompt", "aria-labelledby": "passkey-prompt-title" },
    },
    cardBar(
      "Keep your character",
      closeButton("Hide this", () => {
        asked(me.id);
        card.remove();
        announce("Hidden. Signing in on your profile has it when you want it.");
      }),
    ),
    h("h2", {
      class: "card-title",
      attrs: { id: "passkey-prompt-title" },
      text: "Add a passkey",
    }),
    h("p", {
      text: "This browser is the only thing holding your character. Clear it, or come back on another phone, and Terrakin won't know you. A passkey is how you get back in: Face ID, a fingerprint, or your screen lock, with nothing to write down.",
    }),
    h("div", { class: "cluster" }, add, later),
    problem,
  );

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
        asked(me.id);
        card.remove();
        toast("Passkey added. You can open Terrakin as this character on any device.");
      },
      "Waiting for your device…",
      label,
    );
  });
  later.addEventListener("click", () => {
    asked(me.id);
    card.remove();
    announce("Not now. Signing in on your profile has it when you want it.");
  });
  return card;
}

/** What the rule reads off the profile: their kind, and whether they live on a plot. */
const state = (me: ProfileView) => ({ kind: me.kind, settled: me.home !== undefined });
