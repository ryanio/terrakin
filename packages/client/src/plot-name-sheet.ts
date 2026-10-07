/**
 * Naming a plot (decision 0121): the sheet the world opens right after you claim a plot, and the
 * visit card on your own plot and your profile open later. One field and Save, and a way to take
 * the name down once it has one. The server decides: the name goes through its filters and its
 * once-a-day limit with the plot's free renames, and the sheet says what it answered. A plot's
 * name is its residents' words: text only.
 */
import { PLOT_NAMES } from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import {
  closeOverlay,
  confirmTwice,
  errorLine,
  openOverlay,
  overlayShowing,
  sheet,
  toast,
  whileBusy,
} from "@terrakin/ui/ui";
import { actProblem, api } from "./api";

export interface PlotNameOptions {
  /** After the name changed: reload what the page shows. */
  after?: () => unknown;
  /** Where to say it worked, when not the site's toast (the world has its own). */
  say?: (text: string) => void;
  /** Just claimed: say so, and offer Not now, since naming it can wait for the profile. */
  claimed?: boolean;
  /** Words under the title in place of the usual ones. */
  lede?: string;
  /** Shown above the field: what just happened, like a starter home and its pantry. */
  news?: Node | null;
}

/** Name plot (px, py), or rename it, or take its name down. */
export function openPlotNameSheet(
  plot: { px: number; py: number; name?: string | undefined },
  o: PlotNameOptions = {},
) {
  const say = o.say ?? toast;
  const input = h("input", {
    class: "field-input",
    attrs: {
      id: "plot-name-input",
      maxlength: PLOT_NAMES.max,
      autocomplete: "off",
      enterkeyhint: "done",
      placeholder: "Juniper's Lemon Grove",
    },
  });
  input.value = plot.name ?? "";
  const error = errorLine("plot-name-error");
  const save = h("button", {
    class: "btn-primary",
    attrs: { type: "submit", id: "plot-name-save" },
    text: plot.name ? "Rename" : "Save name",
  });
  const clear = plot.name
    ? h("button", {
        class: "pill-button small plot-name-clear",
        attrs: { type: "button", id: "plot-name-clear" },
        text: "Take the name down",
      })
    : null;
  const later = o.claimed
    ? h("button", {
        class: "pill-button small",
        attrs: { type: "button", id: "plot-name-later" },
        text: "Not now",
      })
    : null;
  const form = h(
    "form",
    { class: "stack plot-name-form" },
    h("label", { class: "field-label", attrs: { for: "plot-name-input" }, text: "Name" }),
    input,
    error,
    h("div", { class: "cluster plot-name-actions" }, save, clear, later),
  );
  const s = sheet(
    {
      id: "plot-name-title",
      title: o.claimed ? "Name your new plot" : plot.name ? "Rename your plot" : "Name your plot",
      className: "plot-name-sheet",
      closeOnBackdrop: true,
      lede:
        o.lede ??
        (o.claimed
          ? `This plot is yours. Give it a name everyone sees on the map and wherever it's shown, up to ${PLOT_NAMES.max} characters. You can name it later from your profile, too.`
          : `Everyone sees it, on the map and wherever your plot is shown. Up to ${PLOT_NAMES.max} characters. It can change once a day, and each plot has ${PLOT_NAMES.freeRenames} free renames for fixing it sooner.`),
    },
    o.news ?? null,
    form,
  );
  later?.addEventListener("click", () => closeOverlay(s.dialog));

  /** Send the name (or `null` to take it down) and close once the world took it. */
  async function send(button: HTMLButtonElement, name: string | null, done: string) {
    error.textContent = "";
    const r = await whileBusy(button, () =>
      api.act({ type: "name_plot", px: plot.px, py: plot.py, name }),
    );
    const problem = actProblem(r);
    if (problem) {
      // Closed while it went: the error line is gone with it.
      if (overlayShowing(s.dialog)) error.textContent = problem;
      else say(problem);
      return;
    }
    closeOverlay(s.dialog);
    say(done);
    await o.after?.();
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) {
      error.textContent = "Write a name, or close this to keep it as it is.";
      return;
    }
    if (name === plot.name) {
      closeOverlay(s.dialog);
      return;
    }
    void send(save, name, `Your plot is called ${name} now.`);
  });
  if (clear) {
    // The plot keeps no name until someone names it again, so this asks twice.
    confirmTwice(clear, "Tap again to take it down", () =>
      send(clear, null, "Your plot's name is down."),
    );
  }
  openOverlay(s.dialog);
  input.focus();
  return s;
}
