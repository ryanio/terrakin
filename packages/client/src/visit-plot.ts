/**
 * Visiting a plot from a tap: the jump itself and the tap that starts it. On their own, without the
 * `/visit` page, because the feed's home wall uses them on the first load.
 */
import type { PlotView } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { toast, whileBusy } from "@terrakin/ui/ui";
import { actProblem, api } from "./api";
import { worldLinkPath } from "./world-link";

type PlotAt = { px: number; py: number };

/**
 * Jump to plot (px, py) and open the world there. `plot` is the plot, or a read that finds it and
 * otherwise says in words why there's nowhere to go. The button stays busy through the read and
 * the jump, so a second tap can't send a second visit. Already standing on it is where you wanted
 * to be too. Any other refusal is said in a toast.
 */
export async function visitPlot(
  button: HTMLButtonElement,
  plot: PlotAt | (() => Promise<PlotAt | string>),
  navigate: (path: string) => void,
) {
  const problem = await whileBusy(button, async () => {
    const at = typeof plot === "function" ? await plot() : plot;
    if (typeof at === "string") return at;
    const r = await api.act({ type: "visit", px: at.px, py: at.py });
    const there = r.ok && !r.data.ok && r.data.error.code === "already_there";
    return there ? null : actProblem(r);
  });
  if (problem) return toast(problem);
  navigate("/world");
}

/**
 * A plot's picture and name as one tap that visits it, as Visit does, or a link into the world for
 * someone who hasn't joined. For other people's plots: the home wall's strip never shows your own.
 */
export function visitTap(
  plot: Pick<PlotView, "px" | "py">,
  name: string,
  me: string | null,
  navigate: (path: string) => void,
  className: string,
  ...children: (Node | null)[]
): HTMLElement {
  const label = `Visit ${name}`;
  if (me === null) {
    const href = worldLinkPath({ kind: "plot", px: plot.px, py: plot.py });
    return h("a", { class: className, attrs: { href, "aria-label": label } }, ...children);
  }
  const button = h(
    "button",
    { class: className, attrs: { type: "button", "aria-label": label } },
    ...children,
  );
  button.addEventListener("click", () => void visitPlot(button, plot, navigate));
  return button;
}
