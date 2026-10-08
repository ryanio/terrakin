/**
 * Visiting a plot from a tap: the jump itself and the tap that starts it. On their own, without the
 * `/visit` page, because the feed's home wall uses them on the first load.
 */
import type { PlotView } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { toast, whileBusy } from "@terrakin/ui/ui";
import { actProblem, api } from "./api";
import { worldLinkPath } from "./world-link";

type PlotAt = { px: number; py: number };

/**
 * Jump to plot (px, py) and open the world there. `plot` is the plot, or a read that finds it and
 * otherwise says in words why there's nowhere to go. The button stays busy through the read and
 * the jump, so a second tap can't send a second visit. Already standing on it is where you wanted
 * to be too. Your own plot (or one shared with you) isn't a visit: the world opens looking at it,
 * where Go there takes you home or walks you there. Any other refusal is said in a toast.
 */
export async function visitPlot(
  button: HTMLButtonElement,
  plot: PlotAt | (() => Promise<PlotAt | string>),
  navigate: (path: string) => void,
) {
  let ours: PlotAt | undefined;
  const problem = await whileBusy(button, async () => {
    const at = typeof plot === "function" ? await plot() : plot;
    if (typeof at === "string") return at;
    const r = await api.act({ type: "visit", px: at.px, py: at.py });
    const code = r.ok && !r.data.ok ? r.data.error.code : undefined;
    if (code === "own_plot") ours = at;
    return code === "already_there" || code === "own_plot" ? null : actProblem(r);
  });
  if (problem) return toast(problem);
  navigate(ours ? worldLinkPath({ kind: "plot", px: ours.px, py: ours.py }) : "/world");
}

/**
 * One tap that visits a plot, as Visit does, or a link into the world for someone who hasn't
 * joined: a plot's picture and name on the home wall, and "Jump there" on a plot photo. `label` is
 * its accessible name.
 */
export function visitTap(
  plot: Pick<PlotView, "px" | "py">,
  label: string,
  me: string | null,
  navigate: (path: string) => void,
  className: string,
  ...children: (Node | null)[]
): HTMLElement {
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

/**
 * "Jump there" on a picture taken in the world (a plot photo's plot). Its words hide beside other
 * pictures, so its name is set too.
 */
export function jumpThere(
  place: PlotAt,
  me: string | null,
  navigate: (path: string) => void,
): HTMLElement {
  return visitTap(
    place,
    "Jump there",
    me,
    navigate,
    "pill-button small media-place",
    icon("world"),
    h("span", { class: "media-place-text", text: "Jump there" }),
  );
}
