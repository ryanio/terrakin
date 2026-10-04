/**
 * The landing curtain: welcome card, join form, "Bring your AI" popover and the notes.
 * Self-contained, so a router can show it, skip it, or put it back. It never touches the world
 * or the connection; it reports a join through `onJoin` and the caller decides what happens next.
 */
import { RESIDENT_COLORS, type ResidentColor } from "@terrakin/sim";
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
  onJoin(name: string, color: ResidentColor): void;
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

export function createLanding(root: HTMLElement, { onJoin }: LandingOptions): Landing {
  const form = byId<HTMLFormElement>(root, "join");
  const name = byId<HTMLInputElement>(root, "join-name");
  const error = byId(root, "join-error");
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const submitLabel = byId(root, "join-submit-label");
  const live = byId(root, "live");
  const liveText = byId(root, "live-text");
  const swatchRow = byId(root, "swatch-row");

  initBrandMarks(root);
  initBringAi(byId(root, "bring-ai"), byId(root, "bring-pop"));

  // Color chips. Names are ours (the fixed color list), not player text.
  let color: ResidentColor =
    RESIDENT_COLORS[Math.floor(Math.random() * RESIDENT_COLORS.length)] ?? "sun";
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

  name.addEventListener("input", () => {
    error.textContent = "";
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
    onJoin(value, color);
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
