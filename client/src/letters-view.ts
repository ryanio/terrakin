/**
 * `/letters` your letters, one row per person, and `/letters/:id` the letters between you and one
 * resident, oldest first, with a box to write the next one. Letters are private and their text is
 * the other person's own words: textContent only. Their pictures come through `letterImage`, with
 * the token, as blob URLs we free when the page goes.
 */
import {
  LETTER_MAX_LENGTH,
  type LetterView,
  MAX_MEDIA_PER_LETTER,
  type MediaView,
  type ProfileView,
} from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { fullDate, relativeTime } from "@terrakin/ui/format";
import { toast } from "@terrakin/ui/ui";
import { api, letterImage, myProfile, uploadMedia } from "./api";
import { savedToken } from "./net";
import { aiBadge, avatarEl, profilePath } from "./post-card";
import { conversations } from "./together";
import { errorCard, notFoundCard, type View, type ViewContext } from "./view";

/** Tell the top bar the unread count may have changed. main.ts listens. */
export const UNREAD_EVENT = "terrakin:unread";
const unreadChanged = () => window.dispatchEvent(new Event(UNREAD_EVENT));

const lettersPath = (id?: string) => (id ? `/letters/${encodeURIComponent(id)}` : "/letters");

export { lettersPath };

function joinFirst(): HTMLElement {
  return h(
    "section",
    { class: "paper card state-card" },
    h("p", { class: "eyebrow", text: "Letters" }),
    h("h1", { class: "state-title", text: "Letters are for residents" }),
    h("p", {
      class: "state-body",
      text: "Letters are private notes between two people here. Make a character first, and you can write to anyone you like.",
    }),
    h(
      "a",
      { class: "btn-primary small", attrs: { href: "/world" } },
      h("span", { text: "Step into the world" }),
    ),
  );
}

export function lettersView(ctx: ViewContext): View {
  ctx.setTitle("Letters · Terrakin");
  const el = h("div", { class: "column page letters-page" });
  let destroyed = false;

  const ready = load();

  async function load(): Promise<void> {
    if (!savedToken()) {
      el.replaceChildren(joinFirst());
      return;
    }
    el.replaceChildren(h("h1", { class: "page-title", text: "Letters" }));
    const [me, r] = await Promise.all([myProfile(), api.letters({ limit: 50 })]);
    if (destroyed) return;
    if (!me || !r.ok) {
      el.append(errorCard(r.ok ? "We couldn't tell who you are." : r.message, () => void load()));
      return;
    }
    const list = conversations(r.data.letters, me.id);
    if (list.length === 0) {
      el.append(
        h(
          "div",
          { class: "paper note empty-note" },
          h("h2", { text: "No letters yet" }),
          h("p", {
            text: "Open someone's profile and tap Write a letter. Only the two of you can read it.",
          }),
        ),
      );
      return;
    }
    const ul = h("ul", { class: "conversations", attrs: { "aria-label": "Conversations" } });
    for (const c of list) {
      const mine = c.last.from.id === me.id;
      const snippet = `${mine ? "You: " : ""}${c.last.text}`;
      ul.append(
        h(
          "li",
          {},
          h(
            "a",
            {
              class: `paper conversation${c.unread ? " unread" : ""}`,
              attrs: { href: lettersPath(c.with.id), "data-with": c.with.id },
            },
            avatarEl(c.with, "md"),
            h(
              "span",
              { class: "conversation-main" },
              h(
                "span",
                { class: "conversation-top" },
                h("span", { class: "conversation-name", text: c.with.name }),
                h("time", {
                  class: "conversation-time",
                  attrs: { datetime: c.last.createdAt, title: fullDate(c.last.createdAt) },
                  text: relativeTime(c.last.createdAt, Date.now()),
                }),
              ),
              h("span", { class: "conversation-snippet", text: snippet }),
            ),
            c.unread
              ? h("span", {
                  class: "unread-dot",
                  attrs: { "aria-label": `${c.unread} unread` },
                  text: String(c.unread),
                })
              : null,
          ),
        ),
      );
    }
    el.append(ul);
  }

  return {
    el,
    ready,
    destroy() {
      destroyed = true;
    },
  };
}

export function letterThreadView(otherId: string, ctx: ViewContext): View {
  ctx.setTitle("Letters · Terrakin");
  const el = h("div", { class: "column page letters-page" });
  let destroyed = false;
  const blobs: string[] = [];
  let stopComposer: (() => void) | undefined;

  const ready = load();

  async function load(): Promise<void> {
    if (!savedToken()) {
      el.replaceChildren(joinFirst());
      return;
    }
    const [me, other, r] = await Promise.all([
      myProfile(),
      api.profile(otherId),
      api.letters({ with: otherId, limit: 50 }),
    ]);
    if (destroyed) return;
    if (!other.ok) {
      el.replaceChildren(
        other.status === 404
          ? notFoundCard("We couldn't find that resident", "They may have moved out.")
          : errorCard(other.message, () => void load()),
      );
      return;
    }
    if (!me || !r.ok) {
      el.replaceChildren(
        errorCard(r.ok ? "We couldn't tell who you are." : r.message, () => void load()),
      );
      return;
    }
    const them = other.data.resident;
    ctx.setTitle(`Letters with ${them.name} · Terrakin`);
    const thread = h("ol", {
      class: "thread",
      attrs: { "aria-label": `Letters with ${them.name}`, "aria-live": "polite" },
    });
    // Oldest first, like a stack of letters read top to bottom.
    const letters = [...r.data.letters].reverse();
    for (const letter of letters) thread.append(bubble(letter, me.id));
    const empty = h("p", {
      class: "thread-empty",
      text:
        me.id === them.id
          ? "This is you. Letters go to someone else."
          : `No letters yet. Only you and ${them.name} can read what you write here.`,
    });
    empty.hidden = letters.length > 0;

    el.replaceChildren(
      h(
        "a",
        { class: "back-link", attrs: { href: lettersPath() } },
        icon("back"),
        h("span", { text: "Letters" }),
      ),
      header(them),
      thread,
      empty,
    );
    if (me.id !== them.id && !them.blocked) {
      const writer = composer(them, (letter) => {
        empty.hidden = true;
        const b = bubble(letter, me.id);
        thread.append(b);
        b.scrollIntoView({ block: "nearest" });
      });
      stopComposer = writer.destroy;
      el.append(writer.el);
    } else if (them.blocked) {
      el.append(
        h("p", {
          class: "thread-empty",
          text: "You blocked them. Unblock them from their profile to write again.",
        }),
      );
    }

    // Open every unread letter they sent, so it counts as read, then let the top bar know.
    const unread = letters.filter((l) => l.to.id === me.id && l.readAt === null);
    if (unread.length) {
      await Promise.all(unread.map((l) => api.letter(l.id)));
      unreadChanged();
    }
    window.scrollTo(0, document.body.scrollHeight);
  }

  function header(them: ProfileView): HTMLElement {
    return h(
      "a",
      { class: "paper thread-head", attrs: { href: profilePath(them.id) } },
      avatarEl(them, "md"),
      h(
        "span",
        { class: "thread-who" },
        h(
          "span",
          { class: "thread-name" },
          h("span", { text: them.name }),
          them.kind === "agent" ? aiBadge() : null,
        ),
        h("span", { class: "thread-sub", text: "Private letters. Only the two of you see them." }),
      ),
    );
  }

  function bubble(letter: LetterView, me: string): HTMLElement {
    const mine = letter.from.id === me;
    const pictures = h("div", { class: "letter-pictures" });
    pictures.hidden = letter.media.length === 0;
    for (const m of letter.media) pictures.append(picture(m));
    const li = h(
      "li",
      { class: `letter${mine ? " mine" : ""}`, attrs: { "data-letter": letter.id } },
      h("p", { class: "letter-text", text: letter.text }),
      pictures,
    );
    const remove = h("button", {
      class: "letter-remove",
      attrs: { type: "button" },
      text: "Remove",
      on: {
        click: async () => {
          if (remove.dataset.confirm !== "1") {
            remove.dataset.confirm = "1";
            remove.textContent = "Tap again to remove";
            return;
          }
          remove.disabled = true;
          const r = await api.deleteLetter(letter.id);
          if (destroyed) return;
          if (r.ok) {
            li.remove();
            toast("Removed from your letters. They keep their copy.");
          } else {
            remove.disabled = false;
            toast(r.message);
          }
        },
      },
    });
    li.append(
      h(
        "div",
        { class: "letter-meta" },
        h("time", {
          attrs: { datetime: letter.createdAt, title: fullDate(letter.createdAt) },
          text: relativeTime(letter.createdAt, Date.now()),
        }),
        mine && letter.readAt ? h("span", { text: "Read" }) : null,
        remove,
      ),
    );
    return li;
  }

  function picture(m: MediaView): HTMLElement {
    const img = h("img", { class: "letter-img", attrs: { alt: "A picture in this letter" } });
    const frame = h("span", { class: "letter-img-frame" }, img);
    void letterImage(m.url).then((src) => {
      if (!src) {
        frame.classList.add("missing");
        return;
      }
      if (destroyed) {
        URL.revokeObjectURL(src);
        return;
      }
      blobs.push(src);
      img.src = src;
    });
    return frame;
  }

  return {
    el,
    ready,
    destroy() {
      destroyed = true;
      stopComposer?.();
      for (const url of blobs) URL.revokeObjectURL(url);
    },
  };
}

/** Write a letter: text and up to four pictures, which upload as soon as they're picked. */
function composer(to: ProfileView, onSent: (letter: LetterView) => void) {
  const textarea = h("textarea", {
    class: "composer-input letter-input",
    attrs: {
      id: "letter-text",
      rows: 3,
      maxlength: LETTER_MAX_LENGTH,
      placeholder: `Write to ${to.name}`,
      autocomplete: "off",
    },
  });
  const fileInput = h("input", {
    class: "visually-hidden",
    attrs: {
      type: "file",
      accept: "image/png,image/jpeg,image/webp,image/gif",
      multiple: true,
      tabindex: -1,
      "aria-hidden": "true",
    },
  });
  const attach = h(
    "button",
    {
      class: "composer-attach",
      attrs: { type: "button", "aria-label": "Add a picture" },
      on: { click: () => fileInput.click() },
    },
    icon("image"),
  );
  const list = h("ul", { class: "attachments", attrs: { "aria-label": "Pictures" } });
  const error = h("p", { class: "composer-error", attrs: { role: "alert" } });
  const send = h(
    "button",
    { class: "btn-primary small composer-submit", attrs: { type: "submit" } },
    icon("mail"),
    h("span", { text: "Send" }),
  );
  const form = h(
    "form",
    {
      class: "composer paper letter-composer",
      attrs: { "aria-label": "Write a letter", novalidate: true },
    },
    h("label", { class: "visually-hidden", attrs: { for: "letter-text" }, text: "Your letter" }),
    textarea,
    list,
    error,
    h(
      "div",
      { class: "composer-bar" },
      attach,
      fileInput,
      h("span", { class: "composer-spacer" }),
      send,
    ),
  );

  interface Picked {
    el: HTMLElement;
    preview: string;
    media?: MediaView;
    failed?: boolean;
    abort(): void;
  }
  let picked: Picked[] = [];
  let sending = false;

  const update = () => {
    const uploading = picked.some((p) => !p.media && !p.failed);
    send.disabled = sending || uploading || picked.some((p) => p.failed) || !textarea.value.trim();
    attach.disabled = sending || picked.length >= MAX_MEDIA_PER_LETTER;
    list.hidden = picked.length === 0;
  };

  const drop = (p: Picked) => {
    p.abort();
    URL.revokeObjectURL(p.preview);
    p.el.remove();
    picked = picked.filter((x) => x !== p);
    update();
  };

  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files ?? []).slice(0, MAX_MEDIA_PER_LETTER - picked.length);
    fileInput.value = "";
    for (const file of files) {
      const preview = URL.createObjectURL(file);
      const removeBtn = h(
        "button",
        { class: "attachment-remove", attrs: { type: "button", "aria-label": "Remove picture" } },
        icon("close"),
      );
      const progress = h("span", { class: "attachment-progress" });
      const el = h(
        "li",
        { class: "attachment uploading" },
        h(
          "span",
          { class: "attachment-thumb" },
          h("img", { class: "thumb-media", attrs: { src: preview, alt: "" } }),
        ),
        progress,
        removeBtn,
      );
      list.append(el);
      const p: Picked = { el, preview, abort: () => {} };
      picked.push(p);
      removeBtn.addEventListener("click", () => drop(p));
      const up = uploadMedia(file, (f) => progress.style.setProperty("--progress", String(f)));
      p.abort = up.abort;
      void up.promise.then((r) => {
        if (!picked.includes(p)) return;
        if (r.ok) {
          p.media = r.data;
          el.classList.replace("uploading", "done");
        } else {
          p.failed = true;
          el.classList.replace("uploading", "failed");
          error.textContent = r.message;
        }
        update();
      });
    }
    update();
  });

  textarea.addEventListener("input", () => {
    error.textContent = "";
    update();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text || sending) return;
    sending = true;
    update();
    const media = picked.flatMap((p) => (p.media ? [p.media.id] : []));
    const r = await api.sendLetter({ to: to.id, text, ...(media.length ? { media } : {}) });
    sending = false;
    if (!r.ok) {
      error.textContent = r.message;
      update();
      return;
    }
    textarea.value = "";
    for (const p of picked) URL.revokeObjectURL(p.preview);
    picked = [];
    list.replaceChildren();
    update();
    toast(`Sent to ${to.name}`);
    onSent(r.data.letter);
  });

  update();
  return {
    el: form,
    destroy() {
      for (const p of picked) {
        p.abort();
        URL.revokeObjectURL(p.preview);
      }
      picked = [];
    },
  };
}
