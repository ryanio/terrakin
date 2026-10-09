/**
 * A page whose code loads when someone opens it, so the first load carries only what every visit
 * needs (decision 0110).
 */
import { h } from "@terrakin/ui/dom";
import { skeletonPosts } from "@terrakin/ui/skeleton";
import { errorCard, type View } from "./view";

/**
 * Loading cards until `module` is in, then the page `make` builds from it, in the same place. A
 * page left before its code arrives is never built. When the code can't load (a deploy replaced
 * it, or the connection dropped), the page says so and offers a reload.
 */
export function lazyView<M>(module: Promise<M>, make: (m: M) => View): View {
  const el: HTMLElement = h(
    "div",
    { class: "column stack cards page", attrs: { "aria-busy": "true" } },
    ...skeletonPosts(2),
  );
  let page: View | undefined;
  let left = false;
  const ready = module.then(
    (m) => {
      if (left) return;
      page = make(m);
      el.replaceWith(page.el);
      return page.ready;
    },
    () => {
      if (left) return;
      el.removeAttribute("aria-busy");
      el.replaceChildren(
        errorCard(
          "Terrakin may have been updated since this tab opened, or the connection dropped. Reloading gets the newest version.",
          () => location.reload(),
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
