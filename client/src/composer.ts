/**
 * Write a post, a reply, or a quote. Shown only to visitors with a saved token (from joining the
 * world). Files upload as soon as they're picked, with progress, so posting is instant once they're
 * up. Typing `@` suggests handles of people you follow. The server judges everything; we show its
 * words when it says no.
 */
import {
  type AuthorView,
  MAX_MEDIA_PER_POST,
  MEDIA_TYPES,
  type MediaView,
  POST_MAX_LENGTH,
  type PostView,
  type ProfileView,
} from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { activeMention, insertMention, suggestHandles } from "@terrakin/ui/mentions";
import { avatarEl, quoteEmbed } from "@terrakin/ui/people";
import { closeOverlay, openOverlay } from "@terrakin/ui/ui";
import { api, uploadMedia } from "./api";

const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,.glb,model/gltf-binary";
const LARGEST = Math.max(...Object.values(MEDIA_TYPES).map((t) => t.maxBytes));
/** Show the character counter once this few are left. */
const COUNTER_AT = 200;

export interface ComposerOptions {
  me: ProfileView;
  /** Reply to this post instead of starting a new one. */
  replyTo?: string;
  /** Quote this post: it shows under the box and goes along with the new post. */
  quote?: PostView;
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

/** Files waiting for the next new-post composer (for example a photo taken in the 3D view). */
let queued: File[] = [];

/** Attach `file` to the next new-post composer that opens. */
export function queueAttachment(file: File) {
  queued = [...queued, file].slice(-MAX_MEDIA_PER_POST);
}

export function composer({ me, replyTo, quote, onPosted }: ComposerOptions): Composer {
  const reply = replyTo !== undefined;
  const mode = reply ? "reply" : quote ? "quote" : "post";
  const fieldId = `compose-${mode}`;
  const textarea = h("textarea", {
    class: "composer-input",
    attrs: {
      id: fieldId,
      rows: reply ? 2 : 3,
      maxlength: POST_MAX_LENGTH,
      placeholder: reply
        ? "Write a reply"
        : quote
          ? "Add your thoughts"
          : "Share something you made",
      enterkeyhint: "enter",
      autocomplete: "off",
      autocapitalize: "sentences",
      "aria-autocomplete": "list",
      "aria-controls": `${fieldId}-people`,
    },
  });
  const label = h("label", {
    class: "visually-hidden",
    attrs: { for: fieldId },
    text: reply ? "Your reply" : quote ? "Your quote post" : "Your post",
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
  const suggest = h("ul", {
    class: "mention-suggest",
    attrs: {
      id: `${fieldId}-people`,
      role: "listbox",
      "aria-label": "People you follow",
      hidden: true,
    },
  });
  const list = h("ul", { class: "attachments", attrs: { "aria-label": "Attached files" } });
  const error = h("p", { class: "composer-error", attrs: { role: "alert" } });

  const form = h(
    "form",
    {
      class: `composer paper${reply ? " reply" : ""}${quote ? " quoting" : ""}`,
      attrs: {
        "aria-label": reply ? "Write a reply" : quote ? "Quote a post" : "Write a post",
        novalidate: true,
      },
    },
    h("div", { class: "composer-row" }, avatarEl(me, reply ? "sm" : "md"), label, textarea),
    suggest,
    quote ? quoteEmbed(quote) : null,
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
    refreshSuggest();
  });

  // ---------- @handle suggestions from people you follow ----------

  let people: AuthorView[] | undefined;
  let loadingPeople: Promise<void> | undefined;
  let options: (AuthorView & { handle: string })[] = [];
  let active = 0;
  const loadPeople = () => {
    loadingPeople ??= api.following(me.id).then((r) => {
      people = r.ok ? r.data.residents : [];
    });
    return loadingPeople;
  };
  const caret = () => textarea.selectionStart ?? textarea.value.length;

  function hideSuggest() {
    options = [];
    suggest.hidden = true;
    suggest.replaceChildren();
    textarea.removeAttribute("aria-activedescendant");
  }

  function paintSuggest() {
    suggest.replaceChildren(
      ...options.map((p, i) =>
        h(
          "li",
          {
            class: "mention-option",
            attrs: {
              id: `${fieldId}-person-${i}`,
              role: "option",
              "aria-selected": String(i === active),
            },
            on: {
              // Keep focus (and the phone keyboard) in the text box.
              pointerdown: (e) => e.preventDefault(),
              click: () => choose(p.handle),
            },
          },
          avatarEl(p, "sm"),
          h("span", { class: "mention-name", text: p.name }),
          h("span", { class: "mention-handle", text: `@${p.handle}` }),
        ),
      ),
    );
    suggest.hidden = options.length === 0;
    if (options.length)
      textarea.setAttribute("aria-activedescendant", `${fieldId}-person-${active}`);
    else textarea.removeAttribute("aria-activedescendant");
  }

  function refreshSuggest() {
    if (!activeMention(textarea.value, caret())) return hideSuggest();
    void loadPeople().then(() => {
      if (destroyed) return;
      const typed = activeMention(textarea.value, caret());
      if (!typed || !people) return hideSuggest();
      options = suggestHandles(people, typed.query);
      active = 0;
      paintSuggest();
    });
  }

  function choose(handle: string) {
    const typed = activeMention(textarea.value, caret());
    if (!typed) return hideSuggest();
    const next = insertMention(textarea.value, typed.start, caret(), handle);
    textarea.value = next.text;
    textarea.setSelectionRange(next.caret, next.caret);
    textarea.focus();
    hideSuggest();
    autosize();
    update();
  }

  textarea.addEventListener("click", () => refreshSuggest());
  textarea.addEventListener("blur", () => setTimeout(hideSuggest, 150));
  textarea.addEventListener("keydown", (e) => {
    if (options.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length;
      paintSuggest();
    } else if (e.key === "Enter" || e.key === "Tab") {
      const pick = options[active];
      if (!pick || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      choose(pick.handle);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      hideSuggest();
    }
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
      ...(quote ? { quote: quote.id } : {}),
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

  if (mode === "post" && queued.length > 0) {
    const files = queued;
    queued = [];
    for (const file of files) add(file);
  }

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

/** A full-screen sheet to quote `post`. Back, Escape, or the close button dismisses it. */
export function openQuoteComposer(
  me: ProfileView,
  post: PostView,
  onPosted: (post: PostView) => void,
) {
  const writer = composer({
    me,
    quote: post,
    onPosted(quoted) {
      closeOverlay();
      onPosted(quoted);
    },
  });
  const dialog = h(
    "dialog",
    { class: "quote-dialog", attrs: { "aria-labelledby": "quote-title" } },
    h(
      "div",
      { class: "quote-sheet" },
      h(
        "header",
        { class: "quote-sheet-head" },
        h("h2", { class: "quote-sheet-title", attrs: { id: "quote-title" }, text: "Quote post" }),
        h(
          "button",
          {
            class: "pill-button small quote-close",
            attrs: { type: "button", "aria-label": "Close" },
            on: { click: () => closeOverlay() },
          },
          icon("close"),
        ),
      ),
      writer.el,
    ),
  );
  openOverlay(dialog, () => writer.destroy());
  dialog.querySelector("textarea")?.focus();
}
