/** Motion on the page: counting numbers, replaying a little animation, and respecting reduced motion. */
import { compactCount } from "./format";

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** True when the person asked their device for less motion. */
export const reducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

/** Run a CSS animation class again from the start, even if it's still on. */
export function replay(el: Element, className: string) {
  el.classList.remove(className);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(className);
}

const frames = new WeakMap<HTMLElement, number>();

/** Show `n` in `el` straight away, stopping any count in progress. */
export function showNumber(el: HTMLElement, n: number) {
  cancelAnimationFrame(frames.get(el) ?? 0);
  el.dataset.n = String(n);
  el.textContent = compactCount(n);
}

/**
 * Count the number in `el` from what it shows to `to`, easing out. The first number, an unchanged
 * one, and reduced motion just show it. Returns true when it counted, so the caller can add a flash.
 */
export function countTo(el: HTMLElement, to: number, ms = 700): boolean {
  const from = Number(el.dataset.n ?? Number.NaN);
  if (!Number.isFinite(from) || from === to || reducedMotion()) {
    showNumber(el, to);
    return false;
  }
  cancelAnimationFrame(frames.get(el) ?? 0);
  el.dataset.n = String(to);
  const start = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - start) / ms);
    const eased = 1 - (1 - k) ** 3;
    el.textContent = compactCount(Math.round(from + (to - from) * eased));
    if (k < 1) frames.set(el, requestAnimationFrame(step));
  };
  frames.set(el, requestAnimationFrame(step));
  return true;
}
