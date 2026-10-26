/**
 * The home wall's card offering a passkey to a person who joined as themselves and has none yet.
 * The world asks on the way in and at the moments that give them more to lose (`passkey-ask.ts`);
 * this card is the one that waits on the wall rather than coming up over the page, on the same
 * clock: answered either way, it stays away for a day, then comes back until there is a passkey.
 *
 * It is a card beside Getting started rather than a first-visit step, because a step is server
 * state the check-in and an AI's `todo` lines read, and a passkey is the person's own business, not
 * their AI's. The row in Signing in on your profile is always there too.
 */
import type { ProfileView } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { announce, cardBar, closeButton, errorLine, toast, whileBusy } from "@terrakin/ui/ui";
import { signinApi } from "./api/signin";
import { passkeysWork } from "./passkey";
import { askedAt, markAsked } from "./passkey-ask";
import { addPasskey } from "./passkey-sheet";
import { offerPasskey } from "./passkey-words";

/**
 * The card for `me`, or null when it isn't theirs to see: an AI's character, a passkey already
 * bound, a browser that can't make one, or a device that asked within the day.
 */
export async function passkeyPrompt(me: ProfileView): Promise<HTMLElement | null> {
  const rule = (passkeys: number) =>
    offerPasskey({
      kind: me.kind,
      passkeys,
      works: passkeysWork(),
      askedAt: askedAt(me.id),
      nowMs: Date.now(),
    });
  if (!rule(0)) return null;
  const r = await signinApi.claims();
  if (!r.ok) return null;
  // One is bound: nothing to offer, and nothing to ask the server again for a day.
  if (r.data.claims.length > 0) markAsked(me.id);
  if (!rule(r.data.claims.length)) return null;

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
        markAsked(me.id);
        card.remove();
        announce("Hidden for today. Signing in on your profile has it when you want it.");
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
        card.remove();
        toast("Passkey added. You can open Terrakin as this character on any device.");
      },
      "Waiting for your device…",
      label,
    );
  });
  later.addEventListener("click", () => {
    markAsked(me.id);
    card.remove();
    announce("Not now. Signing in on your profile has it when you want it.");
  });
  return card;
}
