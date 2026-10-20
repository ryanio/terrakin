/**
 * "Signing in" on your own profile (RFC 0037): the passkeys bound to this character, with when
 * each was added and when it last signed in, a way to add one, a way to remove one, and a way to
 * end every other session.
 *
 * It shows no key and nothing about a device, because the server keeps neither. A passkey is told
 * from another only by its dates, which is also how a person spots one they didn't make.
 */
import type { ClaimView } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { skLine } from "@terrakin/ui/skeleton";
import {
  confirmTwice,
  errorLine,
  itemRow,
  itemRows,
  openOverlay,
  sheet,
  toast,
  whileBusy,
} from "@terrakin/ui/ui";
import { signinApi } from "./api/signin";
import { makePasskey, noPasskeys, passkeysWork, passkeyWhy } from "./passkey";
import { passkeyLines, signinSummary } from "./passkey-words";

/**
 * Add a passkey to the character this browser's token holds: the whole ceremony, with a refused or
 * abandoned one in words. Null when it worked. The home wall's prompt shares it, so both doors say
 * the same thing when a device says no.
 */
export async function addPasskey(): Promise<string | null> {
  if (!passkeysWork()) return noPasskeys();
  try {
    const options = await signinApi.beginBind();
    if (!options.ok) return options.message;
    const made = await makePasskey(options.data);
    const bound = await signinApi.finishBind(made);
    return bound.ok ? null : bound.message;
  } catch (error) {
    return passkeyWhy(error);
  }
}

/** The sheet, from the "…" menu on your own profile. `returnTo` takes focus back when it closes. */
export async function openSigninSheet(returnTo?: HTMLElement): Promise<void> {
  const body = h("div", { class: "stack" }, skLine(), skLine(72), skLine(56));
  const { dialog } = sheet(
    {
      id: "signin-title",
      title: "Signing in",
      className: "signin-sheet",
      lede: "How you open Terrakin as this character on another device, or after this one forgets you.",
    },
    body,
  );
  openOverlay(dialog, undefined, returnTo);

  const problem = errorLine("signin-error");

  /** Read the passkeys again and draw the sheet. A failed read says so and leaves the rest. */
  async function load(): Promise<void> {
    const r = await signinApi.claims();
    if (!dialog.isConnected) return;
    if (!r.ok) {
      problem.textContent = r.message;
      body.replaceChildren(problem);
      return;
    }
    const claims = r.data.claims;
    const now = Date.now();
    body.replaceChildren(
      h("p", { class: "hint", text: signinSummary(claims.length) }),
      ...(claims.length > 0
        ? [
            itemRows(
              claims.map((claim) => passkeyRow(claim, now)),
              { className: "signin-keys" },
            ),
          ]
        : []),
      addButton(claims.length),
      otherSessions(),
      problem,
    );
  }

  /** One bound passkey: its dates, and Remove behind a second tap, since nothing undoes it. */
  function passkeyRow(claim: ClaimView, now: number): HTMLLIElement {
    const remove = h("button", {
      class: "pill-button small",
      attrs: { type: "button" },
      text: "Remove",
    }) as HTMLButtonElement;
    confirmTwice(remove, "Remove it?", () =>
      whileBusy(
        remove,
        async () => {
          problem.textContent = "";
          const gone = await signinApi.remove(claim.id);
          if (!dialog.isConnected) return;
          if (!gone.ok) {
            problem.textContent = gone.message;
            return;
          }
          toast("Passkey removed. Any session it made has ended.");
          await load();
        },
        "Removing…",
      ),
    );
    return itemRow({
      lead: icon("key", "icon"),
      name: "Passkey",
      lines: [...passkeyLines(claim, now), "Removing it ends the sessions it made."],
      trail: remove,
      className: "signin-key",
    });
  }

  /** Add a passkey, or, where the browser can't make one, what to do instead. */
  function addButton(bound: number): HTMLElement {
    if (!passkeysWork()) {
      return h("p", {
        class: "hint",
        text: "This browser can't make a passkey. Open Terrakin on your phone and add one there.",
      });
    }
    const label = h("span", { text: bound > 0 ? "Add another passkey" : "Add a passkey" });
    const add = h(
      "button",
      { class: "btn-primary", attrs: { type: "button" } },
      icon("key"),
      label,
    ) as HTMLButtonElement;
    add.addEventListener("click", () => {
      void whileBusy(
        add,
        async () => {
          problem.textContent = "";
          const failed = await addPasskey();
          if (!dialog.isConnected) return;
          if (failed) {
            problem.textContent = failed;
            return;
          }
          toast("Passkey added. You can sign in with it on any device.");
          await load();
        },
        "Waiting for your device…",
        label,
      );
    });
    return add;
  }

  /**
   * End every other session. It belongs here because it is the only thing that ends a session a
   * passkey can't: one made before Terrakin kept a record of which passkey minted it, and the link
   * key an AI plays with.
   */
  function otherSessions(): HTMLElement {
    const out = h("button", {
      class: "pill-button small",
      attrs: { type: "button" },
      text: "Sign them out",
    }) as HTMLButtonElement;
    confirmTwice(out, "Sign them all out?", () =>
      whileBusy(
        out,
        async () => {
          problem.textContent = "";
          const done = await signinApi.othersOut();
          if (!dialog.isConnected) return;
          if (!done.ok) {
            problem.textContent = done.message;
            return;
          }
          toast(
            done.data.ended === 1
              ? "One other session ended."
              : `${done.data.ended} other sessions ended.`,
          );
        },
        "Signing out…",
      ),
    );
    return h(
      "div",
      { class: "stack tight" },
      h("h3", { class: "section-title", text: "Other sessions" }),
      h("p", {
        class: "hint",
        text: "Ends every session but the one you are in, including the older ones no passkey can reach. Your AI's link key goes too, so it will need a new one from you.",
      }),
      out,
    );
  }

  await load();
}
