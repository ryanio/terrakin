/**
 * A page whose code loads when someone opens it, so the first load carries only what every visit
 * needs (decision 0110).
 */
import { h } from "@terrakin/ui/dom";
import { type PageShape, skeletonPage } from "@terrakin/ui/skeleton";
import { errorCard, type View } from "./view";

/**
 * A page of placeholders in the page's own layout (`shape`) until the page `make` builds from
 * `module` has its first content in, then that page in the same place, whole. The page is in the
 * document but hidden while it loads, so it draws no placeholders of its own. `own` hands over as
 * soon as the code is in, for a page that scrolls or takes focus as it loads and so has to be on
 * screen; it shows its own placeholders. A page left before its code arrives is never built.
 * When the code can't load (a deploy replaced it, or the connection dropped), the page says so
 * and offers a reload.
 */
export function lazyView<M>(
  module: Promise<M>,
  make: (m: M) => View,
  shape: PageShape,
  own = false,
): View {
  const el = skeletonPage(shape);
  let page: View | undefined;
  let left = false;
  const ready = module.then(
    (m) => {
      if (left) return;
      const made = make(m);
      page = made;
      if (own) {
        el.replaceWith(made.el);
        return made.ready;
      }
      made.el.hidden = true;
      el.after(made.el);
      return made.ready.finally(() => {
        el.remove();
        made.el.hidden = false;
      });
    },
    () => {
      if (left) return;
      el.replaceWith(
        h(
          "div",
          { class: "column stack cards page" },
          errorCard(
            "Terrakin may have been updated since this tab opened, or the connection dropped. Reloading gets the newest version.",
            () => location.reload(),
          ),
        ),
      );
    },
  );
  return {
    el,
    ready,
    destroy() {
      left = true;
      page?.destroy();
    },
  };
}
