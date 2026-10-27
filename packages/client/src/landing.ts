/**
 * The Move in card: the door over the live town, asking only for a name, with one already
 * suggested and "Pick your look" (a character picked at random, and a note) folded away, and the
 * "Bring your AI" popover. Someone with no character walks the town first as a guest
 * (decision 0380), and the card comes up when they tap Move in; Keep looking around puts it away.
 * Self-contained, so a router can show it, skip it, or put it back. It never touches the world
 * or the connection; it reports a join through `onJoin` and the caller decides what happens next.
 */

import { SIGNIN } from "@terrakin/protocol";
import { nameProblem } from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import { plural } from "@terrakin/ui/format";
import { reducedMotion } from "@terrakin/ui/motion";
import { initBrandMarks, initBringAi } from "./chrome";
import {
  characterPicker,
  type JoinLook,
  nameRule,
  randomCharacter,
  suggestName,
} from "./join-form";
import { passkeyAutofillWorks, passkeysWork } from "./passkey";

export interface Landing {
  /** True while the curtain is showing (not lifted or hidden). */
  isUp(): boolean;
  /**
   * Bring the curtain back, for example after a stale token. `signin` opens "Restore with a key"
   * and brings the ways to sign in into view, after a Sign in that didn't.
   */
  show(options?: { signin?: boolean }): void;
  /** Lift the curtain with a short fade. `instant` skips the animation. */
  hide(options?: { instant?: boolean }): void;
  setJoining(on: boolean): void;
  /** The refusal to show, with any free names to offer as buttons (`name_taken`). */
  setError(text: string, free?: readonly string[]): void;
  /** The name last sent came back `name_taken`: "Suggest" never offers it again. */
  nameTaken(): void;
  focusName(): void;
  focusNote(): void;
  /** Open "Restore with a key", for a saved key the server no longer knows. */
  openRestore(): void;
  /**
   * The name was taken, and it may be yours from another browser: a button under the refusal that
   * signs in with a passkey, or where this browser can't use one, "Restore with a key" opened.
   */
  offerSignin(): void;
  /**
   * Nobody is signed in here: offer a passkey saved for this site among the browser's own
   * suggestions on the name field (WebAuthn's conditional mediation), with the card up or away.
   * Picking one signs in.
   */
  autofill(): void;
  /** Someone is in, or the world's page is left: take back the passkey request `autofill` holds. */
  pause(): void;
  /**
   * Sign in with a passkey from outside the card (a guest's Sign in), with `button` held down
   * meanwhile. False where this browser can't use one, or it didn't sign in; the reason is then
   * under the card's own sign-in button.
   */
  signIn(button: HTMLButtonElement): Promise<boolean>;
  /** Update the live line, for example "12 residents, 3 online now". */
  setPopulation(total: number, online: number): void;
  /** How tall the door card is, in CSS pixels, so the world behind it can center above it. */
  cardHeight(): number;
  /** The look picked for the character, which a guest walks the town in before joining. */
  look(): JoinLook;
}

export interface LandingOptions {
  /** A new character: a name, its look, and a note when one was written. */
  onJoin(choice: { name: string; note?: string } & JoinLook): void;
  /** Check a pasted key. Resolve with an error message, or null once it is saved. */
  onRestore(key: string): Promise<string | null>;
  /**
   * Sign in with a passkey already bound to a character, which may be the one an AI plays
   * (RFC 0037). Resolve with an error message, or null once the session is saved. With
   * `autofill`, the browser waits for someone to pick a passkey from its suggestions, and
   * `signal` takes that back.
   */
  onSignin(how?: { autofill: true; signal: AbortSignal }): Promise<string | null>;
  /** Keep looking around: put the card away and walk the town as a guest. */
  onLater(): void;
}

/** "12 residents, 3 online now". Pure, so tests can pin the wording. */
export function populationLine(total: number, online: number): string {
  if (total === 0) return "Nobody here yet. Be the first";
  const residents = plural(total, "resident", "residents");
  return online > 0 ? `${residents}, ${online} online now` : `${residents}, quiet right now`;
}

function byId<T extends HTMLElement>(root: ParentNode, id: string): T {
  const el = root.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`landing: missing #${id}`);
  return el;
}

export function createLanding(
  root: HTMLElement,
  { onJoin, onRestore, onSignin, onLater }: LandingOptions,
): Landing {
  const form = byId<HTMLFormElement>(root, "world-join");
  const note = byId<HTMLInputElement>(root, "join-note");
  const name = byId<HTMLInputElement>(root, "join-name");
  const error = byId(root, "join-error");
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const submitLabel = byId(root, "join-submit-label");
  const live = byId(root, "live");
  const liveText = byId(root, "live-text");

  initBrandMarks(root);
  initBringAi(byId(root, "bring-ai"), byId(root, "bring-pop"));

  const look = byId<HTMLDetailsElement>(root, "join-look");
  const character = characterPicker("join", randomCharacter());
  byId(root, "join-character").replaceWith(character.el);
  const suggest = suggestName(name);
  byId(root, "join-name-head").append(suggest.el);
  let sent = "";

  // On a phone the error line scrolls into view, since the sticky Move in button can sit over
  // it. The field it's about (the one that gets focus) is marked invalid until the error clears.
  nameRule(name, byId(root, "join-name-hint"));
  name.setAttribute("aria-describedby", "join-name-hint join-error");
  note.setAttribute("aria-describedby", "join-error");
  // Names nobody has, offered after a `name_taken` refusal so a newcomer is one tap from a name
  // that works instead of inventing another themselves. The row is empty the rest of the time,
  // and `.cluster:empty` leaves no gap.
  const freeRow = byId(root, "join-free");
  const offerFree = (names: readonly string[]) => {
    freeRow.replaceChildren(
      ...names.map((free) =>
        h(
          "button",
          {
            class: "pill-button small",
            attrs: { type: "button" },
            on: {
              click: () => {
                name.value = free;
                // As if typed: the refusal clears, and "Suggest" sees a name it didn't put there.
                name.dispatchEvent(new Event("input"));
                name.focus();
              },
            },
          },
          free,
        ),
      ),
    );
  };
  const showError = (text: string, free: readonly string[] = []) => {
    error.textContent = text;
    offerFree(text ? free : []);
    if (text) {
      error.scrollIntoView({ block: "nearest" });
      return;
    }
    name.removeAttribute("aria-invalid");
    note.removeAttribute("aria-invalid");
  };
  const markInvalid = (field: HTMLInputElement) => {
    // The note is folded under "Pick your look": open it so the field can take focus.
    if (look.contains(field)) look.open = true;
    field.setAttribute("aria-invalid", "true");
    field.focus();
  };

  name.addEventListener("input", () => showError(""));
  note.addEventListener("input", () => {
    if (note.getAttribute("aria-invalid")) showError("");
  });

  // Restore with a key: bring a character made in another browser to this one.
  const restoreKey = byId<HTMLInputElement>(root, "restore-key");
  const restoreGo = byId<HTMLButtonElement>(root, "restore-go");
  const restoreError = byId(root, "restore-error");
  const restore = async () => {
    const key = restoreKey.value.trim();
    if (!key) {
      restoreError.textContent = "Paste your key first.";
      restoreKey.focus();
      return;
    }
    restoreGo.disabled = true;
    restoreError.textContent = "";
    const problem = await onRestore(key);
    restoreGo.disabled = false;
    if (problem) restoreError.textContent = problem;
    else restoreKey.value = "";
  };
  restoreGo.addEventListener("click", () => void restore());
  byId(root, "join-later").addEventListener("click", () => onLater());

  restoreKey.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void restore();
    }
  });

  // Sign in with a passkey. The whole door stays away where the browser can't use one, rather
  // than offering a button that only ever says no.
  const signin = byId(root, "signin");
  const signinGo = byId<HTMLButtonElement>(root, "signin-go");
  const signinError = byId(root, "signin-error");
  if (passkeysWork()) signin.hidden = false;
  const signIn = async (button: HTMLButtonElement): Promise<boolean> => {
    // A browser holds one passkey request at a time, so the suggestions step aside meanwhile.
    stopAutofill();
    button.disabled = true;
    signinError.textContent = "";
    const problem = await onSignin();
    button.disabled = false;
    if (!problem) return true;
    signinError.textContent = problem;
    signin.scrollIntoView({ block: "nearest" });
    void startAutofill();
    return false;
  };
  signinGo.addEventListener("click", () => void signIn(signinGo));

  // Passkey autofill. The challenge it asks for lasts `SIGNIN.challengeMinutes`, so a fresh one
  // replaces it a minute before; a failed pick waits for the field's next focus to try again.
  // While nobody is signed in (`autofill` to `pause`) it stays open with the card away too, as a
  // guest walks the town: the browser offers the passkey only in the name field's suggestions.
  let autofilling: AbortController | undefined;
  let held = false;
  const asking = () => held || landing.isUp();
  let renewing = false;
  const RENEW_MS = (SIGNIN.challengeMinutes - 1) * 60_000;
  async function startAutofill() {
    if (autofilling || !asking() || !(await passkeyAutofillWorks())) return;
    if (autofilling || !asking()) return;
    const request = new AbortController();
    autofilling = request;
    const renew = setTimeout(() => {
      renewing = true;
      request.abort();
    }, RENEW_MS);
    const problem = await onSignin({ autofill: true, signal: request.signal });
    clearTimeout(renew);
    if (autofilling === request) autofilling = undefined;
    if (renewing) {
      renewing = false;
      void startAutofill();
    } else if (problem && !request.signal.aborted) {
      signinError.textContent = problem;
    }
  }
  function stopAutofill() {
    autofilling?.abort();
    autofilling = undefined;
  }
  name.addEventListener("focus", () => void startAutofill());

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    stopAutofill();
    const value = name.value.trim();
    if (!value) {
      showError("Pick a name first. Anything you like, up to 24 letters.");
      markInvalid(name);
      return;
    }
    // The rule is said before anything is sent, in the same words the server would use.
    const rule = nameProblem(value);
    if (rule) {
      showError(rule);
      markInvalid(name);
      return;
    }
    showError("");
    sent = value;
    const words = note.value.trim();
    onJoin({ name: value, ...character.value(), ...(words ? { note: words } : {}) });
  });

  // Kept by an observer rather than read each frame, so the world's loop never forces a layout.
  let formHeight = 0;
  new ResizeObserver(([entry]) => {
    formHeight = entry?.borderBoxSize[0]?.blockSize ?? form.offsetHeight;
  }).observe(form);

  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const landing: Landing = {
    isUp: () => !root.hidden && !root.classList.contains("lifted"),
    show({ signin: signingIn = false } = {}) {
      clearTimeout(hideTimer);
      root.hidden = false;
      // A name is already there, so Move in is one tap; Suggest offers another, or type your own.
      if (!name.value) suggest.fill();
      if (signingIn) landing.openRestore();
      // Next frame, so the transition runs from the lifted state.
      requestAnimationFrame(() => {
        root.classList.remove("lifted");
        if (signingIn) byId(root, "restore").scrollIntoView({ block: "nearest" });
        void startAutofill();
      });
      landing.setJoining(false);
    },
    hide({ instant = false } = {}) {
      if (!held) stopAutofill();
      if (root.hidden) return;
      root.classList.add("lifted");
      const done = () => {
        if (root.classList.contains("lifted")) root.hidden = true;
      };
      clearTimeout(hideTimer);
      if (instant || reducedMotion()) done();
      else hideTimer = setTimeout(done, 650);
    },
    setJoining(on) {
      if (submit) submit.disabled = on;
      submitLabel.textContent = on ? "Moving in…" : "Move in";
    },
    setError: showError,
    nameTaken: () => suggest.taken(sent),
    focusName: () => markInvalid(name),
    focusNote: () => markInvalid(note),
    openRestore() {
      byId<HTMLDetailsElement>(root, "restore").open = true;
    },
    offerSignin() {
      if (!passkeysWork()) {
        landing.openRestore();
        return;
      }
      const again = h(
        "button",
        {
          class: "pill-button small",
          attrs: { type: "button", id: "join-signin" },
          on: { click: () => void signIn(again) },
        },
        "Sign in with your passkey",
      ) as HTMLButtonElement;
      freeRow.append(again);
    },
    autofill() {
      held = true;
      void startAutofill();
    },
    pause() {
      held = false;
      stopAutofill();
    },
    signIn: (button) => (passkeysWork() ? signIn(button) : Promise.resolve(false)),
    setPopulation(total, online) {
      liveText.textContent = populationLine(total, online);
      live.hidden = false;
    },
    cardHeight: () => formHeight,
    look: () => character.value(),
  };
  return landing;
}
