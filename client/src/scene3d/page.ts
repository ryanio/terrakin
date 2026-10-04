/**
 * The page around a 3D scene: a full-screen stage with a back button, a title, and "Take a photo".
 * `/r/:id/3d` visits a resident's plot from the live world snapshot; `/gallery/3d` is the gallery
 * room (and `?item=` one item up close). Lazy: the main bundle reaches this only through import().
 */
import { WorldSnapshot } from "@terrakin/protocol";
import { queueAttachment } from "../composer";
import { h, icon } from "../dom";
import { savedToken } from "../net";
import { toast } from "../ui";
import { errorCard, notFoundCard, type ViewContext } from "../view";
import { createStage, type Stage } from "./art";
import { parseGallery } from "./catalog";
import { buildGallery } from "./gallery";
import { homeExtras, plotLayout, rawResident } from "./layout";
import { buildPlot } from "./plot";

export type Route3d = { name: "plot3d"; id: string } | { name: "gallery3d" };

/** Fill `el` with the 3D page. Returns the teardown, which frees the whole scene. */
export function mount3d(el: HTMLElement, route: Route3d, ctx: ViewContext): () => void {
  let stage: Stage | undefined;
  let gone = false;
  const urls: string[] = [];

  const host = h("div", { class: "view3d-stage" });
  const title = h("h1", {
    class: "view3d-title",
    text: route.name === "gallery3d" ? "Gallery" : "Visit in 3D",
  });
  const status = h("p", {
    class: "view3d-status",
    attrs: { role: "status" },
    text: "Setting the scene…",
  });
  const note = h("p", { class: "view3d-note", attrs: { "aria-live": "polite" } });
  const back = h(
    "button",
    {
      class: "pill-button small view3d-back",
      attrs: { type: "button", "aria-label": "Back" },
      on: { click: () => leave() },
    },
    icon("back"),
  );
  const photoBtn = h(
    "button",
    {
      class: "btn-primary small view3d-photo",
      attrs: { type: "button", disabled: true },
      on: { click: () => void takePhoto() },
    },
    icon("camera"),
    h("span", { text: "Take a photo" }),
  );
  const help = h("p", { class: "view3d-help", text: "Drag to turn. Pinch or scroll to zoom." });
  const sheet = h("div", {
    class: "paper view3d-sheet",
    attrs: { role: "dialog", "aria-label": "Your photo", hidden: true },
  });
  const section = h(
    "section",
    { class: "view3d", attrs: { "aria-label": "3D view" } },
    host,
    h("header", { class: "view3d-bar" }, back, title, photoBtn),
    h("div", { class: "view3d-foot" }, status, note, help),
    sheet,
  );
  el.replaceChildren(section);
  document.documentElement.classList.add("view3d-open");

  function leave() {
    if (ctx.canGoBack()) history.back();
    else ctx.navigate(route.name === "plot3d" ? `/r/${encodeURIComponent(route.id)}` : "/");
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (!sheet.hidden) sheet.hidden = true;
    else leave();
  };
  document.addEventListener("keydown", onKey);

  const showNote = (text: string) => {
    if (!gone) note.textContent = text;
  };

  async function start() {
    try {
      // Name tags and jar labels are drawn on canvases, which only use fonts already loaded.
      await fontsReady();
      if (route.name === "gallery3d") {
        ctx.setTitle("Gallery in 3D · Terrakin");
        stage = createStage(host, { autoRotate: false });
        await buildGallery(stage, parseGallery(location.search), { onNote: showNote });
      } else {
        const [worldRes, profileRes] = await Promise.all([
          fetch("/v1/world"),
          fetch(`/v1/residents/${encodeURIComponent(route.id)}`).catch(() => undefined),
        ]);
        const raw: unknown = await worldRes.json();
        const profileRaw: unknown = profileRes?.ok
          ? await profileRes.json().catch(() => undefined)
          : undefined;
        if (gone) return;
        const parsed = WorldSnapshot.safeParse(raw);
        if (!parsed.success) throw new Error("bad snapshot");
        const snapshot = parsed.data;
        const resident = snapshot.residents.find((r) => r.id === route.id);
        if (!resident) {
          ctx.setTitle("Not found · Terrakin");
          el.replaceChildren(
            h(
              "div",
              { class: "column page" },
              notFoundCard(
                "We couldn't find that resident",
                "They may have moved out, or the link has a typo.",
              ),
            ),
          );
          cleanup();
          return;
        }
        ctx.setTitle(`${resident.name}'s home in 3D · Terrakin`);
        title.textContent = `${resident.name}'s home`;
        const layout = plotLayout(snapshot, route.id);
        if (!layout) {
          el.replaceChildren(noPlot(resident.name, route.id));
          cleanup();
          return;
        }
        const extras = {
          ...homeExtras((profileRaw as { resident?: unknown } | undefined)?.resident),
          ...homeExtras(rawResident(raw, route.id)),
        };
        stage = createStage(host, { autoRotate: true });
        buildPlot(stage, layout, extras, { onNote: showNote });
      }
      if (gone) return;
      status.textContent = "";
      photoBtn.disabled = false;
      section.dataset.ready = "true";
    } catch {
      if (gone) return;
      stage?.dispose();
      stage = undefined;
      el.replaceChildren(
        h(
          "div",
          { class: "column page" },
          errorCard("The 3D view couldn't be set up on this device or connection.", () => {
            ctx.navigate(location.pathname + location.search);
          }),
        ),
      );
      cleanup();
    }
  }

  async function takePhoto() {
    if (!stage) return;
    photoBtn.disabled = true;
    const blob = await stage.photo();
    photoBtn.disabled = false;
    if (gone) return;
    if (!blob) {
      toast("Couldn't take a photo on this device");
      return;
    }
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const file = new File([blob], "terrakin-photo.png", { type: "image/png" });
    const close = h(
      "button",
      {
        class: "viewer-close view3d-sheet-close",
        attrs: { type: "button", "aria-label": "Close" },
        on: { click: () => (sheet.hidden = true) },
      },
      icon("close"),
    );
    const save = h(
      "a",
      { class: "pill-button small", attrs: { href: url, download: "terrakin-photo.png" } },
      h("span", { text: "Save" }),
    );
    const post = savedToken()
      ? h(
          "button",
          {
            class: "btn-primary small",
            attrs: { type: "button" },
            on: {
              click: () => {
                queueAttachment(file);
                ctx.navigate("/");
              },
            },
          },
          h("span", { text: "Post it" }),
        )
      : null;
    sheet.replaceChildren(
      close,
      h("img", { class: "view3d-shot", attrs: { src: url, alt: "Your photo of this scene" } }),
      h("div", { class: "view3d-sheet-actions" }, save, post),
    );
    sheet.hidden = false;
    (post ?? save).focus();
  }

  function cleanup() {
    document.documentElement.classList.remove("view3d-open");
    document.removeEventListener("keydown", onKey);
  }

  void start();

  return () => {
    gone = true;
    cleanup();
    stage?.dispose();
    stage = undefined;
    for (const u of urls) URL.revokeObjectURL(u);
  };
}

/** Wait (briefly) for the two faces the canvases draw with. A slow font never holds the scene up. */
function fontsReady(): Promise<unknown> {
  if (!document.fonts?.load) return Promise.resolve();
  return Promise.race([
    Promise.all([
      document.fonts.load('600 45px "Figtree Variable"'),
      document.fonts.load('italic 600 50px "Fraunces Variable"'),
    ]).catch(() => undefined),
    new Promise((done) => setTimeout(done, 1200)),
  ]);
}

function noPlot(name: string, id: string): HTMLElement {
  return h(
    "div",
    { class: "column page" },
    h(
      "section",
      { class: "paper card state-card" },
      h("p", { class: "eyebrow", text: "Visit in 3D" }),
      h("h1", { class: "state-title", text: `${name} hasn't settled a plot yet` }),
      h("p", {
        class: "state-body",
        text: "Once they claim a plot and build on it, you can visit it here in 3D.",
      }),
      h(
        "a",
        { class: "pill-button", attrs: { href: `/r/${encodeURIComponent(id)}` } },
        icon("back"),
        h("span", { text: "Back to their profile" }),
      ),
    ),
  );
}
