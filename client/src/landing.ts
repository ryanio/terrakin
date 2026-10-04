/**
 * The landing curtain: welcome card, join form, "Bring your AI" popover and the notes.
 * Self-contained, so a router can show it, skip it, or put it back. It never touches the world
 * or the connection; it reports a join through `onJoin` and the caller decides what happens next.
 */
import {
  RESIDENT_COLORS,
  RESIDENT_SHAPES,
  type ResidentColor,
  type ResidentShape,
} from "@terrakin/sim";
import { initBrandMarks, initBringAi } from "./chrome";
import { RESIDENT_COLOR_HEX } from "./render";

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
  /** Update the live line, for example "12 residents, 3 online now". */
  setPopulation(total: number, online: number): void;
}

export interface LandingOptions {
  onJoin(choice: { name: string; color: ResidentColor; shape: ResidentShape; note: string }): void;
  /** Check a pasted key. Resolve with an error message, or null once it is saved. */
  onRestore(key: string): Promise<string | null>;
}

/** "12 residents, 3 online now". Pure, so tests can pin the wording. */
export function populationLine(total: number, online: number): string {
  if (total === 0) return "Nobody here yet. Be the first";
  const residents = `${total} ${total === 1 ? "resident" : "residents"}`;
  return online > 0 ? `${residents}, ${online} online now` : `${residents}, quiet right now`;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function byId<T extends HTMLElement>(root: ParentNode, id: string): T {
  const el = root.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`landing: missing #${id}`);
  return el;
}

export function createLanding(root: HTMLElement, { onJoin, onRestore }: LandingOptions): Landing {
  const form = byId<HTMLFormElement>(root, "world-join");
  const note = byId<HTMLInputElement>(root, "join-note");
  const shapeRow = byId(root, "shape-row");
  const name = byId<HTMLInputElement>(root, "join-name");
  const error = byId(root, "join-error");
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const submitLabel = byId(root, "join-submit-label");
  const live = byId(root, "live");
  const liveText = byId(root, "live-text");
  const swatchRow = byId(root, "swatch-row");

  initBrandMarks(root);
  initBringAi(byId(root, "bring-ai"), byId(root, "bring-pop"));

  // Color chips. Names are ours (the fixed color list), not player text. The first color is
  // picked to start, every time: a choice that changes on each load reads as a glitch.
  let color: ResidentColor = RESIDENT_COLORS[0] ?? "sun";
  for (const c of RESIDENT_COLORS) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", c);
    b.setAttribute("aria-pressed", String(c === color));
    const dot = document.createElement("span");
    dot.className = "swatch-dot";
    dot.style.background = RESIDENT_COLOR_HEX[c];
    const label = document.createElement("span");
    label.className = "swatch-name";
    label.textContent = c;
    b.append(dot, label);
    b.addEventListener("click", () => {
      color = c;
      for (const s of swatchRow.children) s.setAttribute("aria-pressed", String(s === b));
    });
    swatchRow.append(b);
  }

  let shape: ResidentShape = RESIDENT_SHAPES[0] ?? "round";
  for (const s of RESIDENT_SHAPES) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", s);
    b.setAttribute("aria-pressed", String(s === shape));
    const dot = document.createElement("span");
    dot.className = `shape-dot ${s}`;
    const label = document.createElement("span");
    label.className = "swatch-name";
    label.textContent = s;
    b.append(dot, label);
    b.addEventListener("click", () => {
      shape = s;
      for (const other of shapeRow.children)
        other.setAttribute("aria-pressed", String(other === b));
    });
    shapeRow.append(b);
  }

  name.addEventListener("input", () => {
    error.textContent = "";
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
      error.textContent = "Pick a name first. Anything you like, up to 24 letters.";
      name.focus();
      return;
    }
    error.textContent = "";
    onJoin({ name: value, color, shape, note: note.value.trim() });
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
    setError(text) {
      error.textContent = text;
    },
    focusName: () => name.focus(),
    setPopulation(total, online) {
      liveText.textContent = populationLine(total, online);
      live.hidden = false;
    },
  };
  return landing;
}
