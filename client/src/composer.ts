/**
 * Write a post or a reply. Shown only to visitors with a saved token (from joining the world).
 * Files upload as soon as they're picked, with progress, so posting is instant once they're up.
 * The server judges everything; we show its words when it says no.
 */
import {
  MAX_MEDIA_PER_POST,
  MEDIA_TYPES,
  type MediaView,
  POST_MAX_LENGTH,
  type PostView,
  type ProfileView,
} from "@terrakin/protocol";
import { api, uploadMedia } from "./api";
import { h, icon } from "./dom";
import { avatarEl } from "./post-card";

const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,.glb,model/gltf-binary";
const LARGEST = Math.max(...Object.values(MEDIA_TYPES).map((t) => t.maxBytes));
/** Show the character counter once this few are left. */
const COUNTER_AT = 200;

export interface ComposerOptions {
  me: ProfileView;
  /** Reply to this post instead of starting a new one. */
  replyTo?: string;
  onPosted(post: PostView): void;
}

interface Attachment {
  file: File;
  el: HTMLElement;
  preview: string | undefined;
  media?: MediaView;
  error?: string;
  abort(): void;
}

export interface Composer {
  el: HTMLElement;
  /** Stop any uploads still running and free the preview images. Call when the page goes away. */
  destroy(): void;
}

export function composer({ me, replyTo, onPosted }: ComposerOptions): Composer {
  const reply = replyTo !== undefined;
  const fieldId = `compose-${reply ? "reply" : "post"}`;
  const textarea = h("textarea", {
    class: "composer-input",
    attrs: {
      id: fieldId,
      rows: reply ? 2 : 3,
      maxlength: POST_MAX_LENGTH,
      placeholder: reply ? "Write a reply" : "Share something you made",
      enterkeyhint: "enter",
      autocomplete: "off",
    },
  });
  const label = h("label", {
    class: "visually-hidden",
    attrs: { for: fieldId },
    text: reply ? "Your reply" : "Your post",
  });
  const fileInput = h("input", {
    class: "visually-hidden",
    attrs: { type: "file", accept: ACCEPT, multiple: true, tabindex: -1, "aria-hidden": "true" },
  });
  const attach = h(
    "button",
    {
      class: "composer-attach",
      attrs: { type: "button", "aria-label": "Add pictures, video, or a 3D model" },
      on: { click: () => fileInput.click() },
    },
    icon("image"),
  );
  const counter = h("span", { class: "composer-count", attrs: { "aria-live": "polite" } });
  const submit = h(
    "button",
    { class: "btn-primary small composer-submit", attrs: { type: "submit" } },
    h("span", { text: reply ? "Reply" : "Post" }),
  );
  const list = h("ul", { class: "attachments", attrs: { "aria-label": "Attached files" } });
  const error = h("p", { class: "composer-error", attrs: { role: "alert" } });

  const form = h(
    "form",
    {
      class: `composer paper${reply ? " reply" : ""}`,
      attrs: { "aria-label": reply ? "Write a reply" : "Write a post", novalidate: true },
    },
    h("div", { class: "composer-row" }, avatarEl(me, reply ? "sm" : "md"), label, textarea),
    list,
    error,
    h(
      "div",
      { class: "composer-bar" },
      attach,
      fileInput,
      h("span", { class: "composer-spacer" }),
      counter,
      submit,
    ),
  );

  let attachments: Attachment[] = [];
  let posting = false;
  let destroyed = false;

  const update = () => {
    const left = POST_MAX_LENGTH - textarea.value.length;
    counter.textContent = left <= COUNTER_AT ? String(left) : "";
    counter.classList.toggle("low", left <= 20);
    const uploading = attachments.some((a) => !a.media && !a.error);
    const failed = attachments.some((a) => a.error);
    submit.disabled = posting || uploading || failed || textarea.value.trim().length === 0;
    attach.disabled = posting || attachments.length >= MAX_MEDIA_PER_POST;
    list.hidden = attachments.length === 0;
  };

  const autosize = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight + 2, 420)}px`;
  };

  textarea.addEventListener("input", () => {
    error.textContent = "";
    autosize();
    update();
  });
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  const remove = (a: Attachment) => {
    a.abort();
    if (a.preview) URL.revokeObjectURL(a.preview);
    a.el.remove();
    attachments = attachments.filter((x) => x !== a);
    update();
  };

  fileInput.addEventListener("change", () => {
    error.textContent = "";
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = "";
    const room = MAX_MEDIA_PER_POST - attachments.length;
    if (files.length > room)
      error.textContent = `Up to ${MAX_MEDIA_PER_POST} files per post. We added the first ${Math.max(0, room)}.`;
    for (const file of files.slice(0, Math.max(0, room))) add(file);
    update();
  });

  function add(file: File) {
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
    list.append(el);

    const a: Attachment = { file, el, preview, abort: () => {} };
    attachments.push(a);
    removeBtn.addEventListener("click", () => remove(a));

    if (file.size > LARGEST) {
      fail(a, "That file is too big. The largest allowed is 25 MB.");
      return;
    }
    const upload = uploadMedia(file, (f) => {
      progress.style.setProperty("--progress", String(f));
    });
    a.abort = upload.abort;
    void upload.promise.then((r) => {
      if (destroyed || !attachments.includes(a)) return;
      if (r.ok) {
        a.media = r.data;
        el.classList.remove("uploading");
        el.classList.add("done");
        state.textContent = "";
      } else fail(a, r.message);
      update();
    });
  }

  function fail(a: Attachment, message: string) {
    a.error = message;
    a.el.classList.remove("uploading");
    a.el.classList.add("failed");
    const state = a.el.querySelector(".attachment-state");
    if (state) state.textContent = "Failed";
    error.textContent = `${a.file.name}: ${message}`;
    update();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text || posting) return;
    posting = true;
    error.textContent = "";
    submit.setAttribute("aria-busy", "true");
    update();
    const media = attachments.flatMap((a) => (a.media ? [a.media.id] : []));
    const r = await api.createPost({
      text,
      ...(media.length ? { media } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
    if (destroyed) return;
    posting = false;
    submit.removeAttribute("aria-busy");
    if (!r.ok) {
      error.textContent =
        r.code === "unauthorized"
          ? "Your session has ended. Step into the world again to post."
          : r.message;
      update();
      return;
    }
    textarea.value = "";
    for (const a of attachments) if (a.preview) URL.revokeObjectURL(a.preview);
    attachments = [];
    list.replaceChildren();
    autosize();
    update();
    onPosted(r.data.post);
  });

  update();
  return {
    el: form,
    destroy() {
      destroyed = true;
      for (const a of attachments) {
        a.abort();
        if (a.preview) URL.revokeObjectURL(a.preview);
      }
      attachments = [];
    },
  };
}
