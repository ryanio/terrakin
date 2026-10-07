/**
 * The landing curtain: welcome card, join form (a name, a character, and a note), "Bring your AI"
 * popover and the notes.
 * Self-contained, so a router can show it, skip it, or put it back. It never touches the world
 * or the connection; it reports a join through `onJoin` and the caller decides what happens next.
 */

import { plural } from "@terrakin/ui/format";
import { reducedMotion } from "@terrakin/ui/motion";
import { initBrandMarks, initBringAi } from "./chrome";
import { characterPicker, type JoinLook } from "./join-form";

export interface Landing {
  /** True while the curtain is showing (not lifted or hidden). */
  isUp(): boolean;
  /** Bring the curtain back, for example after a stale token. */
  show(): void;
  /** Lift the curtain with a short fade. `instant` skips the animation. */
  hide(options?: { instant?: boolean }): void;
  setJoining(on: boolean): void;
  setError(text: string): void;
  focusName(): void;
  focusNote(): void;
  /** Open "Restore with a key", for a saved key the server no longer knows. */
  openRestore(): void;
  /** Update the live line, for example "12 residents, 3 online now". */
  setPopulation(total: number, online: number): void;
}

export interface LandingOptions {
  /** A new character: a name, its look, and a note when one was written. */
  onJoin(choice: { name: string; note?: string } & JoinLook): void;
  /** Check a pasted key. Resolve with an error message, or null once it is saved. */
  onRestore(key: string): Promise<string | null>;
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

export function createLanding(root: HTMLElement, { onJoin, onRestore }: LandingOptions): Landing {
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

  const character = characterPicker("join");
  byId(root, "join-character").replaceWith(character.el);

  // On a phone the error line scrolls into view, since the sticky Step inside button can sit over
  // it. The field it's about (the one that gets focus) is marked invalid until the error clears.
  name.setAttribute("aria-describedby", "join-error");
  note.setAttribute("aria-describedby", "join-error");
  const showError = (text: string) => {
    error.textContent = text;
    if (text) {
      error.scrollIntoView({ block: "nearest" });
      return;
    }
    name.removeAttribute("aria-invalid");
    note.removeAttribute("aria-invalid");
  };
  const markInvalid = (field: HTMLInputElement) => {
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
  restoreKey.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void restore();
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = name.value.trim();
    if (!value) {
      showError("Pick a name first. Anything you like, up to 24 letters.");
      markInvalid(name);
      return;
    }
    showError("");
    const words = note.value.trim();
    onJoin({ name: value, ...character.value(), ...(words ? { note: words } : {}) });
  });

  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const landing: Landing = {
    isUp: () => !root.hidden && !root.classList.contains("lifted"),
    show() {
      clearTimeout(hideTimer);
      root.hidden = false;
      // Next frame, so the transition runs from the lifted state.
      requestAnimationFrame(() => root.classList.remove("lifted"));
      landing.setJoining(false);
    },
    hide({ instant = false } = {}) {
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
      submitLabel.textContent = on ? "Stepping inside…" : "Step inside";
    },
    setError: showError,
    focusName: () => markInvalid(name),
    focusNote: () => markInvalid(note),
    openRestore() {
      byId<HTMLDetailsElement>(root, "restore").open = true;
    },
    setPopulation(total, online) {
      liveText.textContent = populationLine(total, online);
      live.hidden = false;
    },
  };
  return landing;
}
