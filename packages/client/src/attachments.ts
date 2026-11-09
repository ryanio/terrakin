/**
 * Files attached to a post or a letter. Each upload starts as soon as it's picked and shows its
 * progress in a list row with a thumbnail and a remove button. The server judges every file;
 * the size check here only spares an upload the server would refuse.
 */
import { MEDIA_TYPES, type MediaView } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { uploadMedia } from "./api/media";

/** The largest file any of `types` may be, in bytes. */
export function largestOf(types: readonly string[]): number {
  const sizes = types.flatMap((t) => {
    const known = MEDIA_TYPES[t as keyof typeof MEDIA_TYPES];
    return known ? [known.maxBytes] : [];
  });
  return Math.max(...sizes);
}

/** `bytes` as whole megabytes, the way the size refusal says it ("25 MB"). */
export const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

export interface PickPlan<F> {
  /** The picked files that go on the list, in the order they were picked. */
  take: F[];
  /** What the error line says about the pick, or "" when nothing needs saying. */
  note: string;
}

/**
 * Which of `files` join the `held` already attached, at most `max` in all. A pick past the limit
 * keeps the first ones that fit and says so, naming what's attached (`things`) and to what (`per`).
 */
export function planPick<F>(
  files: readonly F[],
  held: number,
  max: number,
  words: { things: string; per: string },
): PickPlan<F> {
  const room = Math.max(0, max - held);
  return {
    take: files.slice(0, room),
    note:
      files.length > room
        ? `Up to ${max} ${words.things} per ${words.per}. We added the first ${room}.`
        : "",
  };
}

/** The refusal for a file over `largest` bytes, or undefined when it may upload. */
export function sizeProblem(size: number, largest: number): string | undefined {
  return size > largest
    ? `That file is too big. The largest allowed is ${megabytes(largest)}.`
    : undefined;
}

export interface Attachment {
  file: File;
  el: HTMLElement;
  preview: string | undefined;
  media?: MediaView;
  error?: string;
  abort(): void;
}

export interface AttachmentsOptions {
  /** The list the rows go in. */
  list: HTMLElement;
  /** The form's error line, which says why a pick or an upload failed. */
  error: HTMLElement;
  /** The most files attached at once. */
  max: number;
  /** The media types the picker accepts, for the size check. */
  types: readonly string[];
  /** Words for the limit's message: "files" per "post". */
  words: { things: string; per: string };
  /** Called whenever an attachment is added, finishes, fails, or goes. */
  changed(): void;
  /** Called after `a` is taken off the list. */
  removed?(a: Attachment): void;
}

export interface Attachments {
  /** What's attached now, in order. */
  readonly items: readonly Attachment[];
  /** Attach the files from one pick, keeping to the limit. */
  pick(files: readonly File[]): void;
  /** Attach one file. */
  add(file: File): void;
  /** Whether any upload is still running. */
  uploading(): boolean;
  /** Whether any upload failed. */
  failed(): boolean;
  /** The uploaded media's ids, for sending. */
  mediaIds(): string[];
  /** Empty the list after a send, freeing the previews. */
  clear(): void;
  /** Stop every upload and free the previews. After this no upload changes anything. */
  destroy(): void;
}

export function attachments(o: AttachmentsOptions): Attachments {
  const largest = largestOf(o.types);
  let items: Attachment[] = [];
  let destroyed = false;

  const remove = (a: Attachment) => {
    a.abort();
    if (a.preview) URL.revokeObjectURL(a.preview);
    a.el.remove();
    items = items.filter((x) => x !== a);
    o.removed?.(a);
    o.changed();
  };

  function fail(a: Attachment, message: string) {
    a.error = message;
    a.el.classList.remove("uploading");
    a.el.classList.add("failed");
    const state = a.el.querySelector(".attachment-state");
    if (state) state.textContent = "Failed";
    o.error.textContent = `${a.file.name}: ${message}`;
    o.changed();
  }

  function add(file: File) {
    if (destroyed) return;
    const isModel = file.name.toLowerCase().endsWith(".glb") || file.type === "model/gltf-binary";
    const isVideo = file.type.startsWith("video/");
    const preview = isModel ? undefined : URL.createObjectURL(file);
    const progress = h("span", { class: "attachment-progress" });
    const state = h("span", { class: "attachment-state", text: "Uploading…" });
    const thumb = h("span", { class: "attachment-thumb" });
    if (isModel) thumb.append(icon("cube"));
    else if (isVideo && preview)
      thumb.append(
        h("video", {
          class: "thumb-media",
          attrs: { src: preview, muted: true, playsinline: true, preload: "metadata" },
        }),
      );
    else if (preview)
      thumb.append(h("img", { class: "thumb-media", attrs: { src: preview, alt: "" } }));
    const removeBtn = h(
      "button",
      {
        class: "attachment-remove",
        attrs: { type: "button", "aria-label": `Remove ${file.name}` },
      },
      icon("close"),
    );
    const el = h("li", { class: "attachment uploading" }, thumb, progress, state, removeBtn);
    o.list.append(el);

    const a: Attachment = { file, el, preview, abort: () => {} };
    items.push(a);
    removeBtn.addEventListener("click", () => remove(a));

    const tooBig = sizeProblem(file.size, largest);
    if (tooBig) {
      fail(a, tooBig);
      return;
    }
    const upload = uploadMedia(file, (f) => {
      progress.style.setProperty("--progress", String(f));
    });
    a.abort = upload.abort;
    void upload.promise.then((r) => {
      if (destroyed || !items.includes(a)) return;
      if (r.ok) {
        a.media = r.data;
        el.classList.remove("uploading");
        el.classList.add("done");
        state.textContent = "";
      } else fail(a, r.message);
      o.changed();
    });
  }

  return {
    get items() {
      return items;
    },
    pick(files) {
      const plan = planPick(files, items.length, o.max, o.words);
      // A failed upload's reason stays while it's on the list, since it's what keeps sending off.
      if (plan.note || !items.some((a) => a.error)) o.error.textContent = plan.note;
      for (const file of plan.take) add(file);
      o.changed();
    },
    add,
    uploading: () => items.some((a) => !a.media && !a.error),
    failed: () => items.some((a) => a.error),
    mediaIds: () => items.flatMap((a) => (a.media ? [a.media.id] : [])),
    clear() {
      for (const a of items) if (a.preview) URL.revokeObjectURL(a.preview);
      items = [];
      o.list.replaceChildren();
    },
    destroy() {
      destroyed = true;
      for (const a of items) {
        a.abort();
        if (a.preview) URL.revokeObjectURL(a.preview);
      }
      items = [];
    },
  };
}
