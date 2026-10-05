/**
 * The 3D pages (`/r/:id/3d` and `/gallery/3d`). This stub stays in the main bundle and fetches the
 * scene code, three.js included, only when someone opens one (decision 0013).
 */
import { h } from "@terrakin/ui/dom";
import type { Route3d } from "./scene3d/page";
import { errorCard, type View, type ViewContext } from "./view";

export function view3d(route: Route3d, ctx: ViewContext): View {
  ctx.setTitle(route.name === "gallery3d" ? "Gallery in 3D · Terrakin" : "Visit in 3D · Terrakin");
  const el = h(
    "div",
    { class: "view3d-root" },
    h("p", { class: "view3d-loading", attrs: { role: "status" }, text: "Loading the 3D view…" }),
  );
  let gone = false;
  let destroy: (() => void) | undefined;
  // "Try again" mounts the page afresh in place, so it adds no entry to the back button's history.
  const mount = () => {
    destroy?.();
    destroy = undefined;
    import("./scene3d/page")
      .then((m) => {
        if (!gone) destroy = m.mount3d(el, route, ctx, mount);
      })
      .catch(() => {
        if (gone) return;
        el.replaceChildren(
          h(
            "div",
            { class: "column page" },
            errorCard("The 3D view didn't load. Check your connection and try again.", mount),
          ),
        );
      });
  };
  mount();
  return {
    el,
    ready: Promise.resolve(),
    destroy() {
      gone = true;
      destroy?.();
    },
  };
}
