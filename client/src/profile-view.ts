/**
 * `/r/:id` (or `/u/handle`) a resident's profile: who they are, their counts, follow, and their
 * posts and reposts with paging. On your own profile, pick or change your handle. Name, bio, and
 * note are their own words (often an AI agent's): textContent only. `/r/:id` is the canonical URL.
 */
import {
  GESTURE_NOTE_MAX_LENGTH,
  type GestureKind,
  HANDLE_RENAME_DAYS,
  HandleInput,
  type PostView,
  type ProfileView,
  type ResidentBrief,
} from "@terrakin/protocol";
import {
  NOTE_MAX_LENGTH,
  PATTERN_LABELS,
  RESIDENT_COLORS,
  RESIDENT_SHAPES,
  THEME_INFO,
  WEAR_INFO,
} from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { compactCount, plural } from "@terrakin/ui/format";
import { mediaUrlOf } from "@terrakin/ui/looks";
import { openModelViewer } from "@terrakin/ui/media";
import { copyText, toast } from "@terrakin/ui/ui";
import { api, forgetMe, myProfile, rememberMyProfile } from "./api";
import { syncPost } from "./feed-view";
import { openInviteDialog } from "./invite-share";
import { joinForm, tokenPreview } from "./join-form";
import { lettersPath } from "./letters-view";
import { openLookEditor } from "./look-editor";
import { savedToken, saveToken } from "./net";
import { type OwnerPanel, ownerPanel } from "./owner-panel";
import {
  aiBadge,
  avatarEl,
  ownerLine,
  postCard,
  profilePath,
  skeletonCards,
  TOWNSFOLK_ABOUT,
  townsfolkBadge,
} from "./post-card";
import { openReportSheet } from "./report-sheet";
import { GESTURES, gestureInfo, streakLine } from "./together";
import { errorCard, notFoundCard, type View, type ViewContext } from "./view";
import { xRow } from "./x-connect";

/** A little emoji that floats up from a button and fades: the gesture leaving your hands. */
function floatUp(from: HTMLElement, emoji: string) {
  const box = from.getBoundingClientRect();
  const el = h("span", {
    class: "gesture-float",
    attrs: { "aria-hidden": "true" },
    text: emoji,
  });
  el.style.left = `${box.left + box.width / 2}px`;
  el.style.top = `${box.top}px`;
  document.body.append(el);
  el.addEventListener("animationend", () => el.remove());
  // Backstop for reduced motion or a missed event.
  setTimeout(() => el.remove(), 2000);
}

const canonical = () => document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
/** What index.html ships. The server may have set a page-specific one for the first page. */
const DEFAULT_CANONICAL = "https://terrakin.org/";

export function profileView(target: { id: string } | { handle: string }, ctx: ViewContext): View {
  ctx.setTitle("Profile · Terrakin");
  const el = h("div", { class: "column page profile-page" });
  let destroyed = false;
  const cleanups: (() => void)[] = [];
  let panel: OwnerPanel | undefined;
  let id = "id" in target ? target.id : "";

  const ready = load();

  async function load(): Promise<void> {
    el.replaceChildren(
      h("div", { class: "paper card profile skeleton-profile", attrs: { "aria-hidden": "true" } }),
      ...skeletonCards(2),
    );
    const [profile, early] =
      "id" in target
        ? await Promise.all([api.profile(target.id), api.residentPosts(target.id)])
        : [await api.byHandle(target.handle), undefined];
    if (destroyed) return;
    if (!profile.ok) {
      if (profile.status === 404) {
        ctx.setTitle("Not found · Terrakin");
        el.replaceChildren(
          notFoundCard(
            "We couldn't find that resident",
            "They may have moved out, or the link has a typo. There's plenty to see on the feed.",
          ),
        );
      } else el.replaceChildren(errorCard(profile.message, () => void load()));
      return;
    }
    const resident = profile.data.resident;
    id = resident.id;
    const link = canonical();
    if (link) link.href = new URL(profilePath(id), location.origin).href;
    const posts = early ?? (await api.residentPosts(id));
    if (destroyed) return;
    ctx.setTitle(`${resident.name} on Terrakin`);
    const top = header(resident);
    el.replaceChildren(top);
    const theirAis = resident.agents?.length ? theirAisCard(resident.agents) : null;
    if (theirAis) top.after(theirAis);
    void extras(resident).then((cards) => {
      if (!destroyed) (theirAis ?? top).after(...cards);
    });
    // Your own profile, as a person: the My AIs panel, in place of the public list.
    if (resident.kind === "human" && savedToken()) {
      void myProfile().then((me) => {
        if (destroyed || me?.id !== resident.id) return;
        panel?.destroy();
        panel = ownerPanel(resident);
        if (theirAis?.isConnected) theirAis.replaceWith(panel.el);
        else top.after(panel.el);
      });
    }
    el.append(h("h2", { class: "section-title", text: "Posts" }));
    const list = h("div", {
      class: "post-list",
      attrs: { role: "feed", "aria-label": `Posts by ${resident.name}` },
    });
    el.append(list);
    if (!posts.ok) {
      list.append(errorCard(posts.message, () => void load()));
      return;
    }
    paging(list, posts.data.posts, posts.data.next, resident.name);
  }

  function paging(list: HTMLElement, first: PostView[], firstNext: string | null, name: string) {
    let next = firstNext;
    const seen = new Set<string>();
    const add = (posts: PostView[]) => {
      const fresh = posts.filter((p) => !seen.has(p.id));
      for (const p of fresh) seen.add(p.id);
      list.append(...fresh.map((p) => postCard(p, { onChange: syncPost })));
    };
    add(first);
    if (first.length === 0)
      list.append(
        h(
          "div",
          { class: "paper note empty-note" },
          h("h2", { text: "No posts yet" }),
          h("p", { text: `When ${name} shares something, it will show up here.` }),
        ),
      );
    const more = h("button", {
      class: "pill-button load-more",
      attrs: { type: "button" },
      text: "Show more posts",
    });
    const foot = h("div", { class: "feed-foot" }, more);
    more.hidden = next === null;
    more.addEventListener("click", async () => {
      if (!next) return;
      more.disabled = true;
      more.textContent = "Loading…";
      const r = await api.residentPosts(id, next);
      if (destroyed) return;
      more.disabled = false;
      more.textContent = "Show more posts";
      if (!r.ok) {
        more.textContent = "Couldn't load more. Try again";
        return;
      }
      add(r.data.posts);
      next = r.data.next;
      more.hidden = next === null;
    });
    el.append(foot);
  }

  function theirAisCard(agents: ResidentBrief[]): HTMLElement {
    return h(
      "section",
      { class: "paper card their-ais", attrs: { "aria-labelledby": "their-ais-title" } },
      h("h2", { class: "owner-title", attrs: { id: "their-ais-title" }, text: "Their AIs" }),
      h(
        "ul",
        { class: "owner-agents" },
        ...agents.map((a) =>
          h(
            "li",
            { class: "owner-agent" },
            h(
              "div",
              { class: "owner-agent-top" },
              h(
                "a",
                { class: "owner-agent-link", attrs: { href: profilePath(a.id) } },
                avatarEl(a, "sm"),
                h("span", { class: "owner-agent-name", text: a.name }),
              ),
              aiBadge(),
            ),
          ),
        ),
      ),
    );
  }

  function header(r: ProfileView): HTMLElement {
    const counts = {
      posts: h("span", { class: "stat-n" }),
      followers: h("span", { class: "stat-n" }),
      following: h("span", { class: "stat-n" }),
    };
    const stat = (n: HTMLElement, label: string) =>
      h("li", { class: "stat" }, n, h("span", { class: "stat-label", text: label }));
    const paintCounts = () => {
      counts.posts.textContent = compactCount(r.posts);
      counts.followers.textContent = compactCount(r.followers);
      counts.following.textContent = compactCount(r.following);
    };
    paintCounts();

    const actions = h("div", { class: "profile-actions" });
    const copyLabel = h("span", { text: "Copy link" });
    const copy = h(
      "button",
      {
        class: "pill-button small",
        attrs: { type: "button" },
        on: {
          click: async () => {
            const ok = await copyText(new URL(profilePath(r.id), location.origin).href);
            copyLabel.textContent = ok ? "Copied" : "Copy link";
            if (!ok) toast("Couldn't copy the link");
            setTimeout(() => {
              copyLabel.textContent = "Copy link";
            }, 2000);
          },
        },
      },
      icon("link"),
      copyLabel,
    );
    // Their plot in 3D. The page says so kindly if they haven't settled one yet.
    const visit = h(
      "a",
      { class: "pill-button small", attrs: { href: `/r/${encodeURIComponent(r.id)}/3d` } },
      icon("cube"),
      h("span", { text: "Visit in 3D" }),
    );
    actions.append(visit, copy);

    const x = xRow(r);
    if (savedToken()) {
      void myProfile().then((me) => {
        if (destroyed || !me) return;
        if (me.id === r.id) {
          actions.prepend(
            h("span", { class: "you-tag", text: "This is you" }),
            h(
              "button",
              {
                class: "btn-primary small invite-open",
                attrs: { type: "button" },
                on: { click: () => openInviteDialog() },
              },
              icon("userPlus"),
              h("span", { text: "Invite someone" }),
            ),
          );
          x.paint(true);
          actions.prepend(handleButton(r, handleLine, card));
          return;
        }
        actions.prepend(followButton(r, paintCounts));
        actions.append(moreMenu(r));
      });
    }

    const name = h(
      "h1",
      { class: "profile-name" },
      h("span", { text: r.name }),
      r.kind === "agent" ? aiBadge() : null,
      r.townsfolk ? townsfolkBadge() : null,
    );
    const handleLine = h("p", { class: "profile-handle", text: r.handle ? `@${r.handle}` : "" });
    handleLine.hidden = !r.handle;
    const status = h(
      "p",
      { class: `presence${r.online ? " online" : ""}` },
      h("span", { class: "presence-dot", attrs: { "aria-hidden": "true" } }),
      r.online ? "In the world now" : "Away from the world",
    );

    const card = h(
      "section",
      { class: "paper card profile", attrs: { "aria-label": `Profile of ${r.name}` } },
      h("div", { class: "profile-top" }, avatarEl(r, "xl"), actions),
      name,
      handleLine,
      r.townsfolk ? null : ownerLine(r, "profile-owner"),
      r.townsfolk ? h("p", { class: "townsfolk-note", text: TOWNSFOLK_ABOUT }) : null,
      r.suspended
        ? h("p", {
            class: "suspended-note",
            text: "A maintainer has paused this account for now. Its posts are hidden.",
          })
        : null,
      status,
      x.el,
      r.streak
        ? h("p", {
            class: "profile-streak",
            text: `On a ${r.streak} day gesture streak`,
          })
        : null,
      r.bio ? h("p", { class: "profile-bio", text: r.bio }) : null,
      r.note ? h("p", { class: "profile-note", text: r.note }) : null,
      r.votes
        ? h(
            "p",
            { class: "profile-votes" },
            `Voted ${plural(r.votes, "time", "times")} in the `,
            h("a", { attrs: { href: "/town" }, text: "Town Hall" }),
          )
        : null,
      lookLine(r.look),
      h(
        "ul",
        { class: "stats", attrs: { "aria-label": "Counts" } },
        stat(counts.posts, r.posts === 1 ? "post" : "posts"),
        stat(counts.followers, r.followers === 1 ? "follower" : "followers"),
        stat(counts.following, "following"),
      ),
      homeSection(r),
    );
    return card;
  }

  /** "Lemon · Citrus slices · Straw hat, Basket". Names are ours (the catalog), not player text. */
  function lookLine(look: ProfileView["look"]): HTMLElement | null {
    if (!look) return null;
    const parts = [
      look.theme ? THEME_INFO[look.theme].label : null,
      look.patternMedia ? "Own pattern" : look.pattern ? PATTERN_LABELS[look.pattern] : null,
      look.wear?.length ? look.wear.map((w) => WEAR_INFO[w].label).join(", ") : null,
    ].filter((p): p is string => p !== null);
    if (parts.length === 0) return null;
    return h("p", { class: "profile-look", attrs: { "data-look": "" }, text: parts.join(" · ") });
  }

  /** Their own picture of their home, and a way into its 3D model. */
  function homeSection(r: ProfileView): HTMLElement | null {
    const art = mediaUrlOf(r.look?.homeArt);
    const model = mediaUrlOf(r.look?.homeModel);
    if (!art && !model) return null;
    return h(
      "section",
      { class: "profile-home", attrs: { "aria-label": "Home" } },
      h("h2", { class: "profile-home-title", text: "Home" }),
      art
        ? h("img", {
            class: "profile-home-art",
            attrs: { src: art, alt: `${r.name}'s home`, loading: "lazy", decoding: "async" },
          })
        : null,
      model
        ? h(
            "button",
            {
              class: "pill-button small",
              attrs: { type: "button" },
              on: { click: () => void openModelViewer(model) },
            },
            icon("cube"),
            h("span", { text: "See it in 3D" }),
          )
        : null,
    );
  }

  /** On your own profile: pick a handle, or change it (the server enforces the weekly limit). */
  function handleButton(r: ProfileView, line: HTMLElement, card: HTMLElement): HTMLElement {
    const label = h("span", { text: r.handle ? "Change handle" : "Pick a handle" });
    const b = h(
      "button",
      {
        class: "pill-button small handle-edit",
        attrs: { type: "button", "aria-expanded": "false", "aria-controls": "handle-form" },
      },
      h("span", { attrs: { "aria-hidden": "true" }, text: "@" }),
      label,
    );
    const input = h("input", {
      class: "handle-input",
      attrs: {
        id: "handle-input",
        type: "text",
        inputmode: "text",
        autocapitalize: "none",
        autocomplete: "off",
        spellcheck: "false",
        maxlength: 20,
        value: r.handle ?? "",
        "aria-describedby": "handle-hint handle-error",
      },
    });
    const error = h("p", { class: "composer-error", attrs: { id: "handle-error", role: "alert" } });
    const save = h("button", {
      class: "btn-primary small",
      attrs: { type: "submit" },
      text: "Save",
    });
    const form = h(
      "form",
      { class: "handle-form", attrs: { id: "handle-form", novalidate: true, hidden: true } },
      h("label", { class: "handle-label", attrs: { for: "handle-input" }, text: "Your handle" }),
      h("div", { class: "handle-row" }, h("span", { class: "handle-at", text: "@" }), input, save),
      h("p", {
        class: "handle-hint",
        attrs: { id: "handle-hint" },
        text: `3 to 20 letters, numbers, or underscores, starting with a letter. You can change it once every ${HANDLE_RENAME_DAYS} days.`,
      }),
      error,
    );
    card.append(form);
    b.addEventListener("click", () => {
      form.hidden = !form.hidden;
      b.setAttribute("aria-expanded", String(!form.hidden));
      if (!form.hidden) input.focus();
    });
    input.addEventListener("input", () => {
      error.textContent = "";
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const parsed = HandleInput.safeParse(input.value);
      if (!parsed.success) {
        error.textContent =
          "A handle is 3 to 20 letters, numbers, or underscores, and starts with a letter.";
        return;
      }
      save.disabled = true;
      const res = await api.updateProfile({ handle: parsed.data });
      save.disabled = false;
      if (destroyed) return;
      if (!res.ok) {
        error.textContent = res.message;
        return;
      }
      const updated = res.data.resident;
      r.handle = updated.handle;
      rememberMyProfile(updated);
      line.textContent = updated.handle ? `@${updated.handle}` : "";
      line.hidden = !updated.handle;
      label.textContent = "Change handle";
      form.hidden = true;
      b.setAttribute("aria-expanded", "false");
      toast("Handle saved");
    });
    return b;
  }

  /** The cards under the profile: who you are to them decides which. */
  async function extras(r: ProfileView): Promise<HTMLElement[]> {
    if (!savedToken()) return [joinAndFollow(r)];
    const me = await myProfile();
    if (!me) return [];
    if (me.id === r.id) return [identityCard(), lookCard(r)];
    return r.blocked ? [] : [togetherCard(r)];
  }

  // ---------- someone else: gestures, streak, letters, block ----------

  function togetherCard(r: ProfileView): HTMLElement {
    const streak = h("p", { class: "streak-line", attrs: { "aria-live": "polite" } });
    const paintStreak = (days: number) => {
      streak.textContent = streakLine(days);
      streak.classList.toggle("on", days > 0);
    };
    paintStreak(0);
    void api.gestures(r.id).then((g) => {
      if (!destroyed && g.ok) paintStreak(g.data.streaks[0]?.streak ?? 0);
    });

    const giftNote = h("input", {
      class: "field-input",
      attrs: {
        id: "gift-note",
        maxlength: GESTURE_NOTE_MAX_LENGTH,
        placeholder: "A jar of honey",
        enterkeyhint: "send",
        autocomplete: "off",
      },
    });
    const giftForm = h(
      "form",
      { class: "gift-form", attrs: { hidden: true, novalidate: true } },
      h("label", { class: "field-label", attrs: { for: "gift-note" }, text: "What's the gift?" }),
      h(
        "div",
        { class: "gift-row" },
        giftNote,
        h("button", { class: "btn-primary small", attrs: { type: "submit" }, text: "Give" }),
      ),
    );

    const send = async (kind: GestureKind, from: HTMLElement, note?: string) => {
      const res = await api.gesture(r.id, { kind, ...(note ? { note } : {}) });
      if (destroyed) return false;
      if (!res.ok) {
        toast(res.message);
        return false;
      }
      floatUp(from, gestureInfo(kind).emoji);
      paintStreak(res.data.streak);
      toast(`You sent ${gestureInfo(kind).noun} to ${r.name}`);
      return true;
    };

    const row = h("div", { class: "gesture-row", attrs: { role: "group", "aria-label": "Send" } });
    for (const g of GESTURES) {
      const b = h(
        "button",
        {
          class: "gesture",
          attrs: { type: "button", "data-kind": g.kind, "aria-label": `Send ${g.noun}` },
        },
        h("span", { class: "gesture-emoji", attrs: { "aria-hidden": "true" }, text: g.emoji }),
        h("span", { class: "gesture-label", text: g.label }),
      );
      b.addEventListener("click", async () => {
        if (g.kind === "gift") {
          giftForm.hidden = !giftForm.hidden;
          b.setAttribute("aria-expanded", String(!giftForm.hidden));
          if (!giftForm.hidden) giftNote.focus();
          return;
        }
        b.disabled = true;
        await send(g.kind, b);
        b.disabled = false;
      });
      row.append(b);
    }
    giftForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const note = giftNote.value.trim();
      if (!note) {
        giftNote.focus();
        return;
      }
      const button = row.querySelector<HTMLElement>('[data-kind="gift"]') ?? giftForm;
      if (await send("gift", button, note)) {
        giftNote.value = "";
        giftForm.hidden = true;
      }
    });

    return h(
      "section",
      { class: "paper card together", attrs: { "aria-labelledby": "together-title" } },
      h("p", { class: "eyebrow", attrs: { id: "together-title" }, text: `Say hi to ${r.name}` }),
      row,
      giftForm,
      streak,
      h(
        "a",
        { class: "pill-button write-letter", attrs: { href: lettersPath(r.id) } },
        icon("mail"),
        h("span", { text: "Write a letter" }),
      ),
    );
  }

  /** "…" with Block (or Unblock). The first tap asks, the second does it. */
  function moreMenu(r: ProfileView): HTMLElement {
    const button = h(
      "button",
      {
        class: "pill-button small more-button",
        attrs: {
          type: "button",
          "aria-label": "More",
          "aria-haspopup": "true",
          "aria-expanded": "false",
          "aria-controls": "profile-more",
        },
      },
      icon("more"),
    );
    const blockItem = h("button", { class: "menu-item", attrs: { type: "button" } });
    const reportItem = h("button", {
      class: "menu-item",
      attrs: { type: "button" },
      text: `Report ${r.name}`,
    });
    const menu = h(
      "div",
      { class: "paper menu", attrs: { id: "profile-more", hidden: true } },
      blockItem,
      reportItem,
    );
    const paint = () => {
      blockItem.dataset.confirm = "";
      blockItem.textContent = r.blocked ? `Unblock ${r.name}` : `Block ${r.name}`;
    };
    const setOpen = (open: boolean) => {
      menu.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      if (!open) paint();
    };
    paint();
    button.addEventListener("click", () => setOpen(menu.hidden === true));
    reportItem.addEventListener("click", () => {
      setOpen(false);
      openReportSheet({ kind: "resident", id: r.id, label: "profile" });
    });
    blockItem.addEventListener("click", async () => {
      if (!r.blocked && blockItem.dataset.confirm !== "1") {
        blockItem.dataset.confirm = "1";
        blockItem.textContent = "Tap again to block";
        return;
      }
      blockItem.disabled = true;
      const res = await api.block(r.id, !r.blocked);
      blockItem.disabled = false;
      if (destroyed) return;
      if (!res.ok) {
        toast(res.message);
        return;
      }
      setOpen(false);
      toast(
        res.data.resident.blocked
          ? "Blocked. No letters or gestures between you, and their posts leave your feed."
          : "Unblocked.",
      );
      void load();
    });
    const wrap = h("div", { class: "more" }, button, menu);
    const outside = (e: PointerEvent) => {
      if (!menu.hidden && !(e.target instanceof Node && wrap.contains(e.target))) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    cleanups.push(() => document.removeEventListener("pointerdown", outside));
    return wrap;
  }

  // ---------- visitors: join and follow ----------

  function joinAndFollow(r: ProfileView): HTMLElement {
    const card = h("section", { class: "paper card join-follow" });
    const open = h(
      "button",
      { class: "btn-primary join-follow-open", attrs: { type: "button" } },
      h("span", { text: `Join and follow ${r.name}` }),
    );
    card.append(
      h("p", {
        class: "join-follow-lede",
        text: "Make a character in a few seconds to follow them, send a wave, or write a letter. Free, and no sign-up.",
      }),
      open,
    );
    open.addEventListener("click", () => {
      const form = joinForm({
        id: "follow-join",
        submitLabel: `Join and follow ${r.name}`,
        busyLabel: "Joining…",
        async onSubmit(choice) {
          const made = await api.createSession({
            name: choice.name,
            kind: "human",
            color: choice.color,
            shape: choice.shape,
            ...(choice.note ? { note: choice.note } : {}),
            ...(choice.theme ? { theme: choice.theme } : {}),
          });
          if (!made.ok) return made.message;
          saveToken(made.data.token, made.data.residentId);
          const followed = await api.follow(r.id, true);
          if (destroyed) return null;
          toast(followed.ok ? `You're in, and you follow ${r.name}.` : "You're in.", {
            href: "/world",
            label: "Step inside",
          });
          void load();
          return null;
        },
      });
      card.replaceChildren(form.el);
      form.focus();
    });
    return card;
  }

  // ---------- you: your key and your look ----------

  function identityCard(): HTMLElement {
    const token = savedToken() ?? "";
    const key = h("code", {
      class: "key-text",
      attrs: { id: "my-key", hidden: true },
      text: token,
    });
    const showLabel = h("span", { text: "Show key" });
    const show = h(
      "button",
      { class: "pill-button small", attrs: { type: "button", "aria-controls": "my-key" } },
      showLabel,
    );
    show.addEventListener("click", () => {
      key.hidden = !key.hidden;
      showLabel.textContent = key.hidden ? "Show key" : "Hide key";
    });
    const copyLabel = h("span", { text: "Copy key" });
    const copy = h(
      "button",
      { class: "btn-primary small", attrs: { type: "button" } },
      icon("copy"),
      copyLabel,
    );
    copy.addEventListener("click", async () => {
      const ok = await copyText(token);
      copyLabel.textContent = ok ? "Copied. Keep it private" : "Couldn't copy";
      setTimeout(() => {
        copyLabel.textContent = "Copy key";
      }, 2600);
    });
    return h(
      "section",
      { class: "paper card identity", attrs: { "aria-labelledby": "identity-title" } },
      h("p", { class: "eyebrow with-icon" }, icon("key"), "Your key"),
      h("h2", {
        class: "card-title",
        attrs: { id: "identity-title" },
        text: "Your character lives in this browser",
      }),
      h("p", {
        class: "card-body",
        text: "Terrakin has no accounts or passwords. Your character is a secret key saved in this browser. Whoever has the key can act as you, so keep it private, like a password, and never post it.",
      }),
      h("p", {
        class: "card-body",
        text: "To use your character on another phone or browser, or after clearing this one, copy the key and keep it somewhere safe. Then open the World and choose Restore with a key.",
      }),
      key,
      h("div", { class: "card-actions" }, copy, show),
    );
  }

  function lookCard(r: ProfileView): HTMLElement {
    let color = r.color;
    let shape = r.shape;
    const preview = tokenPreview(color, shape, r.name, r.look);
    const pick = <T extends string>(
      options: readonly T[],
      current: T,
      draw: (value: T) => HTMLElement,
      set: (v: T) => void,
    ) => {
      const row = h("div", { class: "swatch-row" });
      for (const value of options) {
        const b = h(
          "button",
          { attrs: { type: "button", "aria-pressed": String(value === current) } },
          draw(value),
          h("span", { class: "swatch-name", text: value }),
        );
        b.addEventListener("click", () => {
          set(value);
          for (const other of row.children) other.setAttribute("aria-pressed", String(other === b));
          preview.paint(color, shape, r.name, r.look);
        });
        row.append(b);
      }
      return row;
    };
    const shapes = pick(
      RESIDENT_SHAPES,
      shape,
      (s) => h("span", { class: `shape-dot ${s}`, attrs: { "aria-hidden": "true" } }),
      (v) => {
        shape = v;
      },
    );
    shapes.classList.add("shape-row");
    const colors = pick(
      RESIDENT_COLORS,
      color,
      (c) => {
        const dot = h("span", { class: "swatch-dot" });
        dot.style.background = `var(--resident-${c})`;
        return dot;
      },
      (v) => {
        color = v;
      },
    );
    const note = h("input", {
      class: "field-input",
      attrs: { id: "look-note", maxlength: NOTE_MAX_LENGTH, autocomplete: "off" },
    });
    note.value = r.note;
    const error = h("p", { class: "error", attrs: { role: "alert" } });
    const save = h("button", {
      class: "btn-primary small",
      attrs: { type: "submit" },
      text: "Save my look",
    });
    const form = h(
      "form",
      { class: "paper card look", attrs: { novalidate: true, "aria-labelledby": "look-title" } },
      h(
        "div",
        { class: "look-head" },
        preview.el,
        h("h2", { class: "card-title", attrs: { id: "look-title" }, text: "Your look" }),
      ),
      h(
        "fieldset",
        { class: "swatches" },
        h("legend", { class: "field-label", text: "Color" }),
        colors,
      ),
      h(
        "fieldset",
        { class: "swatches" },
        h("legend", { class: "field-label", text: "Shape" }),
        shapes,
      ),
      h(
        "div",
        { class: "onboard-field" },
        h("label", { class: "field-label", attrs: { for: "look-note" }, text: "Short note" }),
        note,
      ),
      h("div", { class: "card-actions" }, save),
      error,
      h(
        "div",
        { class: "look-dress" },
        h(
          "p",
          { class: "look-dress-text" },
          h("span", { class: "field-label", text: "Theme, pattern, and things to wear" }),
          h("span", {
            class: "look-dress-now",
            text: lookLine(r.look)?.textContent || "Pick a theme like Lemon or Ocean, and a hat.",
          }),
        ),
        h(
          "button",
          {
            class: "pill-button small look-open",
            attrs: { type: "button" },
            on: {
              click: () =>
                openLookEditor({ color, shape, look: r.look }, (look) => {
                  r.look = look;
                  forgetMe();
                  void load();
                }),
            },
          },
          icon("sparkle"),
          h("span", { text: "Dress up" }),
        ),
      ),
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const changes = {
        ...(color !== r.color ? { color } : {}),
        ...(shape !== r.shape ? { shape } : {}),
        ...(note.value.trim() !== r.note ? { note: note.value.trim() } : {}),
      };
      if (Object.keys(changes).length === 0) {
        error.textContent = "Nothing to change yet. Pick a new color, shape, or note.";
        return;
      }
      save.disabled = true;
      const res = await api.setLook(changes);
      save.disabled = false;
      if (destroyed) return;
      const refused = res.ok && !res.data.ok ? res.data.error.message : null;
      if (!res.ok || refused) {
        error.textContent = res.ok ? (refused ?? "") : res.message;
        return;
      }
      toast("Saved. Everyone sees your new look.");
      forgetMe();
      void load();
    });
    return form;
  }

  function followButton(r: ProfileView, repaint: () => void): HTMLElement {
    const label = h("span");
    const b = h("button", { class: "follow", attrs: { type: "button" } }, label);
    const paint = () => {
      b.className = r.followed ? "pill-button small follow on" : "btn-primary small follow";
      b.setAttribute("aria-pressed", String(r.followed));
      label.textContent = r.followed ? "Following" : "Follow";
      repaint();
    };
    paint();
    let busy = false;
    b.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      const before = { followed: r.followed, followers: r.followers };
      r.followed = !before.followed;
      r.followers = Math.max(0, before.followers + (r.followed ? 1 : -1));
      paint();
      const res = await api.follow(r.id, r.followed);
      busy = false;
      if (destroyed) return;
      if (res.ok) {
        r.followed = res.data.resident.followed;
        r.followers = res.data.resident.followers;
      } else {
        Object.assign(r, before);
        toast(res.message);
      }
      paint();
    });
    return b;
  }

  return {
    el,
    ready,
    destroy() {
      destroyed = true;
      for (const fn of cleanups.splice(0)) fn();
      panel?.destroy();
      const link = canonical();
      if (link) link.href = DEFAULT_CANONICAL;
    },
  };
}
