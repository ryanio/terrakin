/**
 * Post media: a rounded grid of up to four images, videos, or 3D models. Images load lazily in
 * boxes that already have their size, tap to open full screen. Models show a paper tile and only
 * load three.js (as its own chunk) when someone taps one.
 */
import type { MediaView } from "@terrakin/protocol";
import { h, icon } from "./dom";
import { clampAspect, isMediaUrl, mediaLayout } from "./format";
import { closeOverlay, openOverlay } from "./ui";

/** Natural sizes we've seen, so a re-rendered single image gets its real shape with no jump. */
const knownAspect = new Map<string, number>();

/** What a 3D viewer module offers (the app's `model-viewer.ts`). */
export interface ModelViewer {
  showModel(
    host: HTMLElement,
    url: string,
    events: { onLoaded(): void; onError(): void },
  ): () => void;
}

let loadModelViewer: (() => Promise<ModelViewer>) | undefined;

/**
 * Say how to load the 3D viewer. The app passes `() => import("./model-viewer")`, so three.js stays
 * in its own chunk and only loads when someone opens a model (decision 0013). Without it, models
 * say they can't be shown here.
 */
export function useModelViewer(load: () => Promise<ModelViewer>) {
  loadModelViewer = load;
}

export function mediaGrid(media: readonly MediaView[], label: string): HTMLElement | null {
  // Only URLs shaped exactly like ours reach an img, video, or the model loader.
  const { layout, items } = mediaLayout(media.filter((m) => isMediaUrl(m.url)));
  if (!layout) return null;
  const grid = h("div", { class: `media-grid ${layout}` });
  const images = items.filter((m) => m.kind === "image");
  for (const item of items) {
    const cell = h("div", { class: `media-cell ${item.kind}` });
    if (item.kind === "image") cell.append(imageButton(item, images, label, layout === "single"));
    else if (item.kind === "video") cell.append(videoEl(item));
    else cell.append(modelTile(item));
    grid.append(cell);
  }
  if (layout === "single") {
    const only = items[0];
    const aspect = only && only.kind === "image" ? knownAspect.get(only.url) : undefined;
    grid.style.aspectRatio = String(
      aspect ?? (only?.kind === "video" ? 16 / 9 : only?.kind === "model" ? 16 / 10 : 4 / 3),
    );
  }
  return grid;
}

function imageButton(item: MediaView, all: MediaView[], label: string, single: boolean) {
  const img = h("img", {
    class: "media-img",
    attrs: { src: item.url, alt: "", loading: "lazy", decoding: "async", width: 800, height: 600 },
  });
  img.addEventListener("load", () => {
    const aspect = clampAspect(img.naturalWidth, img.naturalHeight);
    knownAspect.set(item.url, aspect);
    // A lone image takes its own shape (within limits) once we know it.
    const grid = img.closest<HTMLElement>(".media-grid.single");
    if (single && grid) grid.style.aspectRatio = String(aspect);
    img.classList.add("loaded");
  });
  img.addEventListener("error", () => img.classList.add("failed"), { once: true });
  const n = all.indexOf(item);
  const button = h(
    "button",
    {
      class: "media-open",
      attrs: {
        type: "button",
        "aria-label":
          all.length > 1
            ? `Open image ${n + 1} of ${all.length} by ${label}`
            : `Open image by ${label}`,
      },
      on: { click: () => openImageViewer(all, n, label) },
    },
    img,
  );
  return button;
}

function videoEl(item: MediaView) {
  const v = h("video", {
    class: "media-video",
    attrs: { controls: true, playsinline: true, preload: "metadata", src: item.url },
  });
  return v;
}

function modelTile(item: MediaView) {
  return h(
    "button",
    {
      class: "model-tile",
      attrs: { type: "button", "aria-label": "3D model, tap to view" },
      on: { click: () => void openModelViewer(item.url) },
    },
    h("span", { class: "model-cube" }, icon("cube")),
    h("span", { class: "model-label", text: "3D model" }),
    h("span", { class: "model-hint", text: "Tap to view" }),
  );
}

// ---------- full-screen image viewer ----------

function openImageViewer(images: MediaView[], start: number, label: string) {
  let index = start;
  const img = h("img", { class: "viewer-img", attrs: { alt: "" } });
  const counter = h("p", { class: "viewer-count", attrs: { "aria-live": "polite" } });
  const closeBtn = h(
    "button",
    {
      class: "viewer-close",
      attrs: { type: "button", "aria-label": "Close" },
      on: { click: () => closeOverlay() },
    },
    icon("close"),
  );
  const prev = h(
    "button",
    {
      class: "viewer-nav prev",
      attrs: { type: "button", "aria-label": "Previous image" },
      on: { click: () => show(index - 1) },
    },
    icon("chevronLeft"),
  );
  const next = h(
    "button",
    {
      class: "viewer-nav next",
      attrs: { type: "button", "aria-label": "Next image" },
      on: { click: () => show(index + 1) },
    },
    icon("chevronRight"),
  );
  const stage = h("div", { class: "viewer-stage" }, img);
  const dialog = h(
    "dialog",
    { class: "viewer", attrs: { "aria-label": `Image by ${label}` } },
    stage,
    closeBtn,
  );
  if (images.length > 1) dialog.append(prev, next, counter);

  function show(i: number) {
    index = (i + images.length) % images.length;
    const item = images[index];
    if (!item) return;
    img.src = item.url;
    counter.textContent = `${index + 1} of ${images.length}`;
  }
  show(start);

  // Tap the dark area to close; arrows and swipes to move between images.
  stage.addEventListener("click", (e) => {
    if (e.target === stage) closeOverlay();
  });
  dialog.addEventListener("keydown", (e) => {
    if (images.length < 2) return;
    if (e.key === "ArrowLeft") show(index - 1);
    if (e.key === "ArrowRight") show(index + 1);
  });
  let startX: number | undefined;
  stage.addEventListener("pointerdown", (e) => {
    startX = e.clientX;
  });
  stage.addEventListener("pointerup", (e) => {
    if (startX === undefined || images.length < 2) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
    startX = undefined;
  });

  openOverlay(dialog);
  closeBtn.focus();
}

// ---------- 3D model viewer ----------

/** Open a 3D model from one of our media URLs in a full-screen viewer. */
export async function openModelViewer(url: string) {
  const host = h("div", { class: "model-stage" });
  const status = h("p", {
    class: "model-status",
    attrs: { role: "status" },
    text: "Loading model…",
  });
  const hint = h("p", { class: "model-help", text: "Drag to turn. Pinch or scroll to zoom." });
  const closeBtn = h(
    "button",
    {
      class: "viewer-close",
      attrs: { type: "button", "aria-label": "Close" },
      on: { click: () => closeOverlay() },
    },
    icon("close"),
  );
  const dialog = h(
    "dialog",
    { class: "viewer model-viewer", attrs: { "aria-label": "3D model" } },
    host,
    status,
    hint,
    closeBtn,
  );
  let dispose: (() => void) | undefined;
  let closed = false;
  openOverlay(dialog, () => {
    closed = true;
    dispose?.();
  });
  closeBtn.focus();
  try {
    if (!loadModelViewer) throw new Error("No 3D viewer here");
    const { showModel } = await loadModelViewer();
    if (closed) return;
    dispose = showModel(host, url, {
      onLoaded: () => {
        status.textContent = "";
      },
      onError: () => {
        status.textContent = "This model couldn't be shown.";
      },
    });
  } catch {
    status.textContent = "The 3D viewer didn't load. Check your connection and try again.";
  }
}
