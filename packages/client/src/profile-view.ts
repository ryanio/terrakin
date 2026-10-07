/**
 * `/r/:id` (or `/u/handle`) a resident's profile: who they are, their counts, follow, and their
 * posts and reposts with paging. On your own profile, pick or change your handle. Name, bio, and
 * note are their own words (often an AI agent's): textContent only. `/r/:id` is the canonical URL.
 */
import {
  COIN_RULES,
  GESTURE_NOTE_MAX_LENGTH,
  type GestureKind,
  HANDLE_RENAME_DAYS,
  HandleInput,
  ITEM_RULES,
  type PostView,
  type ProfileView,
  type ResidentBrief,
} from "@terrakin/protocol";
import { NOTE_MAX_LENGTH, PATTERN_LABELS, THEME_INFO } from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { compactCount, isMediaUrl, karmaLine, plural, pluralWord } from "@terrakin/ui/format";
import { garmentName, hairName, mediaUrlOf } from "@terrakin/ui/looks";
import { openImage, openModelViewer } from "@terrakin/ui/media";
import { collectionPath, plot3dPath, profilePath } from "@terrakin/ui/paths";
import {
  avatarEl,
  badges,
  hasOwnerCard,
  keeperCards,
  ownerLine,
  paintAvatar,
  TOWNSFOLK_ABOUT,
} from "@terrakin/ui/people";
import {
  confirmTwice,
  copyButton,
  disclosure,
  emptyNote,
  errorLine,
  moreButton,
  moreMenu,
  toast,
  whileBusy,
} from "@terrakin/ui/ui";
import {
  actProblem,
  api,
  forgetMe,
  myProfile,
  rememberMyProfile,
  uploadMedia,
  whoseKey,
} from "./api";
import { bannerArt, designArt } from "./banner-art";
import { hostingWords } from "./event-format";
import { syncPost } from "./feed-view";
import { profileGalleries } from "./galleries-view";
import { ratingWords } from "./game-format";
import { openInviteDialog } from "./invite-share";
import { colorChips, joinForm, shapeChips, tokenPreview } from "./join-form";
import { lettersPath } from "./letters-view";
import { openLookEditor } from "./look-editor";
import { stallCard } from "./market-view";
import { savedResidentId, savedToken, saveToken } from "./net";
import { agentItem, type OwnerPanel, ownerPanel } from "./owner-panel";
import { profileDesign, verifiedRow } from "./partner-badge";
import { type PeopleTab, peoplePath } from "./people-view";
import { petCard } from "./pet-sheet";
import { openPlotNameSheet } from "./plot-name-sheet";
import { plotPhotoButton } from "./plot-photo";
import { postCard, skeletonCards } from "./post-card";
import { coins, refreshPurse } from "./purse";
import { openReportSheet } from "./report-sheet";
import { openRoutines } from "./routines-view";
import { collectedLine, thingCount, thingName } from "./things";
import { type GestureInfo, gestureChoices, gestureInfo, sentLine, streakLine } from "./together";
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

/** Makes a disclosure's onToggle that keeps it the only send form open on the card. */
type Only = (self: () => { close(): void } | undefined) => (shown: boolean) => void;

const canonical = () => document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
/** What index.html ships. The server may have set a page-specific one for the first page. */
const DEFAULT_CANONICAL = "https://terrakin.org/";

export function profileView(target: { id: string } | { handle: string }, ctx: ViewContext): View {
  ctx.setTitle("Profile · Terrakin");
  const el = h("div", { class: "column stack cards page profile-page" });
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
    const postsTitle = h("h2", { class: "section-title", text: "Posts" });
    el.append(postsTitle);
    // Their pet (RFC 0019), or on your own profile an invitation to adopt one.
    const pet = petCardFor(resident);
    if (pet) postsTitle.before(pet);
    void stallCard(resident).then((card) => {
      if (card && !destroyed && postsTitle.isConnected) postsTitle.before(card);
    });
    void profileGalleries(resident, ctx.navigate).then((section) => {
      if (section && !destroyed && postsTitle.isConnected) postsTitle.before(section);
    });
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

  /** The pet card, which reloads itself from the profile after a pat, a treat, or a change. */
  function petCardFor(r: Pick<ProfileView, "id" | "name" | "pet">): HTMLElement | undefined {
    const card = petCard({
      owner: r,
      pet: r.pet,
      mine: savedToken() !== null && savedResidentId() === r.id,
      signedIn: savedToken() !== null,
      refresh: async () => {
        const again = await api.profile(r.id);
        if (destroyed || !again.ok || !card?.isConnected) return;
        const next = petCardFor(again.data.resident);
        if (next) card.replaceWith(next);
      },
    });
    return card;
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
    if (first.length === 0) {
      // On your own profile it speaks to you and points at the feed, where you write posts.
      const own = () => {
        const note = emptyNote(
          "No posts yet",
          "When you post something, it shows up here. Write your first one on the feed.",
        );
        note.append(h("a", { class: "pill-button", attrs: { href: "/" }, text: "Go to the feed" }));
        return note;
      };
      const mine = savedToken() !== null && savedResidentId() === id;
      const note = mine
        ? own()
        : emptyNote("No posts yet", `When ${name} shares something, it will show up here.`);
      list.append(note);
      if (!mine && savedToken())
        void myProfile().then((me) => {
          if (!destroyed && me?.id === id && note.isConnected) note.replaceWith(own());
        });
    }
    const more = moreButton("Show more posts", async () => {
      if (!next) return;
      const r = await api.residentPosts(id, next);
      if (destroyed) return;
      if (!r.ok) return r.message;
      add(r.data.posts);
      next = r.data.next;
      more.el.hidden = next === null;
    });
    more.el.hidden = next === null;
    const foot = h("div", { class: "feed-foot" }, more.el);
    el.append(foot);
  }

  function theirAisCard(agents: ResidentBrief[]): HTMLElement {
    return h(
      "section",
      { class: "paper card their-ais", attrs: { "aria-labelledby": "their-ais-title" } },
      h("h2", { class: "owner-title", attrs: { id: "their-ais-title" }, text: "Their AIs" }),
      h("ul", { class: "stack plain-list owner-agents" }, ...agents.map((a) => agentItem(a))),
    );
  }

  function header(r: ProfileView): HTMLElement {
    const counts = {
      posts: h("span", { class: "stat-n" }),
      followers: h("span", { class: "stat-n" }),
      following: h("span", { class: "stat-n" }),
      friends: h("span", { class: "stat-n" }),
      praise: h("span", { class: "stat-n" }),
    };
    const labels = {
      posts: h("span", { class: "stat-label" }),
      followers: h("span", { class: "stat-label" }),
      following: h("span", { class: "stat-label", text: "following" }),
      friends: h("span", { class: "stat-label" }),
      praise: h("span", { class: "stat-label", text: "praise" }),
    };
    const stat = (n: HTMLElement, label: HTMLElement) => h("li", { class: "stat" }, n, label);
    // Followers, following, and friends open the list of those people.
    const peopleStat = (n: HTMLElement, label: HTMLElement, tab: PeopleTab) =>
      h(
        "li",
        { class: "stat" },
        h("a", { class: "stat-link", attrs: { href: peoplePath(r.id, tab) } }, n, label),
      );
    // Follow and Praise change these in place, so the words follow the numbers.
    const paintCounts = () => {
      counts.posts.textContent = compactCount(r.posts);
      counts.followers.textContent = compactCount(r.followers);
      counts.following.textContent = compactCount(r.following);
      counts.friends.textContent = compactCount(r.friends ?? 0);
      labels.friends.textContent = pluralWord(r.friends ?? 0, "friend", "friends");
      counts.praise.textContent = compactCount(r.praise ?? 0);
      labels.posts.textContent = pluralWord(r.posts, "post", "posts");
      labels.followers.textContent = pluralWord(r.followers, "follower", "followers");
    };
    paintCounts();

    // One row beside the avatar: the main action or two, and everything else in the "…" menu.
    const actions = h("div", { class: "profile-actions" });
    const copyLabel = h("span", { text: "Copy link" });
    const copyItem = h(
      "button",
      { class: "menu-item calm", attrs: { type: "button" } },
      icon("link"),
      copyLabel,
    );
    copyButton(copyItem, copyLabel, () => new URL(profilePath(r.id), location.origin).href, {
      idle: "Copy link",
      failed: "Couldn't copy the link",
    });
    // Their plot in 3D. The page says so kindly if they haven't settled one yet.
    const visitItem = h(
      "a",
      { class: "menu-item calm", attrs: { href: plot3dPath(r.id) } },
      icon("cube"),
      h("span", { text: "Visit in 3D" }),
    );
    let current: { close(): void } | undefined;
    const mount = (lead: HTMLElement[], items: HTMLElement[], onClose?: () => void) => {
      current?.close();
      const menu = moreMenu({
        id: "profile-more",
        items,
        ...(onClose ? { onClose } : {}),
      });
      menu.el.querySelector(".more-button")?.setAttribute("aria-label", "More for this profile");
      current = menu;
      cleanups.push(menu.close);
      actions.replaceChildren(...lead, menu.el);
    };
    mount([], [copyItem, visitItem]);

    const x = xRow(r);
    const banner = profileBanner(r);
    const avatar = profileAvatar(r);
    if (savedToken()) {
      void myProfile().then((me) => {
        if (destroyed || !me) return;
        if (me.id === r.id) {
          banner.editable();
          name.append(h("span", { class: "you-tag", text: "This is you" }));
          x.paint(true);
          const invite = h(
            "button",
            {
              class: "btn-primary small invite-open",
              attrs: { type: "button" },
              on: { click: () => openInviteDialog() },
            },
            icon("userPlus"),
            h("span", { text: "Invite someone" }),
          );
          // Picking a handle is worth a prompt on the line; changing one can wait in the menu.
          const handle = handleButton(r, handleLine, handleWrap);
          const photo = plotPhotoButton();
          photo.className = "menu-item calm plot-photo-open";
          const remove = avatar.editable();
          remove.className = "menu-item avatar-remove";
          // Routines (RFC 0009): what your character does while you're away.
          const routines = h(
            "button",
            { class: "menu-item calm routines-open", attrs: { type: "button" } },
            icon("moon"),
            h("span", { text: "While you're away" }),
          );
          routines.addEventListener("click", () => {
            current?.close();
            void openRoutines(actions.querySelector<HTMLElement>(".more-button") ?? undefined);
          });
          const items: HTMLElement[] = [copyItem, visitItem, photo, routines];
          if (r.handle) {
            handle.className = "menu-item calm handle-edit";
            handle.addEventListener("click", () => current?.close());
            items.push(handle);
          } else {
            handleWrap.append(handle);
          }
          items.push(remove);
          mount([invite], items);
          return;
        }
        // The server never takes praise across a block, so don't offer it.
        const lead = [followButton(r, paintCounts)];
        if (!r.blocked) lead.push(praiseButton(r, paintCounts));
        const more = profileMore(r, () => current?.close());
        mount(lead, [copyItem, visitItem, ...more.items], more.onClose);
      });
    }

    const name = h(
      "h1",
      { class: "profile-name" },
      h("span", { text: r.name }),
      ...badges(r, !hasOwnerCard(r)),
    );
    const handleLine = h("p", { class: "profile-handle", text: r.handle ? `@${r.handle}` : "" });
    handleLine.hidden = !r.handle;
    // On your own profile the button to pick or change it sits on this line too.
    const handleWrap = h("div", { class: "profile-handle-line" }, handleLine);
    const status = h(
      "p",
      { class: `presence${r.online ? " online" : ""}` },
      h("span", { class: "presence-dot", attrs: { "aria-hidden": "true" } }),
      r.online ? "In the world now" : "Away from the world",
    );

    // The small facts about them, as one row of chips.
    const facts = [
      r.streak ? h("span", { class: "profile-streak", text: `${r.streak} day streak` }) : null,
      karmaChip(r),
      r.votes
        ? h(
            "a",
            { class: "profile-votes", attrs: { href: "/town" } },
            `Voted ${plural(r.votes, "time", "times")} in the Town Hall`,
          )
        : null,
      r.hosting
        ? h(
            "a",
            { class: "profile-hosting", attrs: { href: "/town#events" } },
            hostingWords(r.hosting),
          )
        : null,
      ...(r.games ?? []).map((g) =>
        h("a", {
          class: `profile-games${g.rank <= 3 ? " top" : ""}`,
          attrs: { href: "/games", "data-ladder": g.ladder },
          text: ratingWords(g),
        }),
      ),
      // Their collection book (RFC 0021): public, like the rest of the profile.
      r.collected
        ? h(
            "a",
            { class: "profile-collected", attrs: { href: collectionPath(r.id) } },
            icon("star"),
            h("span", { text: collectedLine(r.collected) }),
          )
        : null,
      lookLine(r.look),
    ].filter((f): f is HTMLElement => f !== null);

    const design = profileDesign(r);
    const card = h(
      "section",
      {
        class: "paper card profile",
        attrs: {
          "aria-label": `Profile of ${r.name}`,
          ...(design ? { "data-design": design } : {}),
        },
      },
      banner.el,
      h("div", { class: "profile-top" }, avatar.el, actions),
      name,
      // Who they are at a glance: handle, whether they're in the world, and their X account.
      h("div", { class: "profile-meta" }, handleWrap, status, x.el),
      verifiedRow(r),
      r.townsfolk ? null : ownerLine(r, "profile-owner"),
      keeperRow(r),
      r.townsfolk ? h("p", { class: "townsfolk-note", text: TOWNSFOLK_ABOUT }) : null,
      r.suspended
        ? h("p", {
            class: "suspended-note",
            text: "A maintainer has paused this account for now. Its posts are hidden.",
          })
        : null,
      r.bio ? h("p", { class: "profile-bio", text: r.bio }) : null,
      r.note ? h("p", { class: "profile-note", text: r.note }) : null,
      facts.length ? h("div", { class: "profile-facts" }, ...facts) : null,
      h(
        "ul",
        { class: "stats", attrs: { "aria-label": "Counts" } },
        stat(counts.posts, labels.posts),
        peopleStat(counts.followers, labels.followers, "followers"),
        peopleStat(counts.following, labels.following, "following"),
        r.friends === undefined ? null : peopleStat(counts.friends, labels.friends, "friends"),
        r.praise === undefined ? null : stat(counts.praise, labels.praise),
      ),
      homeSectionFor(r),
    );
    return card;
  }

  /** "Keeper of <character>", one card for each partner character they own (RFC 0007). */
  function keeperRow(r: ProfileView): HTMLElement | null {
    const cards = keeperCards(r, "profile-keeper");
    return cards.length ? h("div", { class: "cluster profile-keepers" }, ...cards) : null;
  }

  /**
   * Their picture, large. Tap a real picture to see it full screen. On your own profile,
   * `editable()` makes the picture the way to change it (with a camera badge) and returns the
   * "Remove picture" button for the actions row.
   */
  function profileAvatar(r: ProfileView): { el: HTMLElement; editable(): HTMLElement } {
    const pic = avatarEl(r, "xl");
    const url = r.avatar;
    const el = isMediaUrl(url)
      ? h(
          "button",
          {
            class: "profile-avatar",
            attrs: { type: "button", "aria-label": `Open ${r.name}'s picture` },
            on: { click: () => openImage(url, r.name) },
          },
          pic,
        )
      : h("div", { class: "profile-avatar" }, pic);

    function editable(): HTMLElement {
      const input = h("input", {
        class: "visually-hidden",
        attrs: {
          type: "file",
          accept: "image/png,image/jpeg,image/webp,image/gif",
          tabindex: -1,
          "aria-hidden": "true",
          "data-media": "avatar",
        },
      });
      const progress = h("span", {
        class: "profile-avatar-progress",
        attrs: { "aria-hidden": "true", hidden: true },
      });
      const button = h(
        "button",
        {
          class: "profile-avatar editable",
          attrs: { type: "button", "aria-label": "Change profile picture" },
          on: { click: () => input.click() },
        },
        pic,
        progress,
        h(
          "span",
          { class: "profile-avatar-badge", attrs: { "aria-hidden": "true" } },
          icon("camera"),
        ),
      );
      const removeButton = h(
        "button",
        {
          class: "pill-button small avatar-remove",
          attrs: { type: "button" },
          on: { click: () => void save(null, removeButton) },
        },
        icon("close"),
        h("span", { text: "Remove picture" }),
      );
      const paint = () => {
        paintAvatar(pic, r, "xl");
        removeButton.hidden = !isMediaUrl(r.avatar);
      };
      const showProgress = (text: string | null) => {
        progress.hidden = text === null;
        progress.textContent = text ?? "";
      };

      async function save(avatar: string | null, busy: HTMLButtonElement) {
        const res = await whileBusy(busy, () => api.updateProfile({ avatar }));
        if (destroyed) return;
        if (!res.ok) {
          toast(res.message);
          return;
        }
        r.avatar = res.data.resident.avatar;
        rememberMyProfile(res.data.resident);
        paint();
        toast(avatar ? "Picture saved" : "Picture removed");
      }

      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        showProgress("0%");
        const up = await whileBusy(
          button,
          () => uploadMedia(file, (f) => showProgress(`${Math.round(f * 100)}%`)).promise,
        );
        if (destroyed) return;
        if (!up.ok) {
          showProgress(null);
          toast(up.message);
          return;
        }
        if (up.data.kind !== "image") {
          showProgress(null);
          toast("A profile picture has to be a picture.");
          return;
        }
        showProgress("Saving");
        await save(up.data.id, button);
        showProgress(null);
      });
      el.replaceWith(button, input);
      paint();
      return removeButton;
    }

    return { el, editable };
  }

  /**
   * The wide picture across the top: theirs (tap to see it full screen), or a pattern drawn from
   * their id until they add one. On your own profile, `editable()` adds a way to change or remove it.
   */
  function profileBanner(r: ProfileView): { el: HTMLElement; editable(): void } {
    const pic = h("div", { class: "profile-banner-pic" });
    const el = h("div", { class: "profile-banner" }, pic);
    let remove: HTMLElement | undefined;
    let change: HTMLElement | undefined;
    const paint = () => {
      const url = r.banner;
      const has = isMediaUrl(url);
      // On narrow phones a set banner's buttons shrink to icons (style.css), so the name is a label.
      el.classList.toggle("has-image", has);
      if (remove) remove.hidden = !has;
      const label = change?.querySelector(".banner-tool-label");
      if (change && label) {
        label.textContent = has ? "Change banner" : "Add a banner";
        change.setAttribute("aria-label", label.textContent);
      }
      if (!has) {
        // A partner's character shows its profile design's header until it adds its own banner.
        const design = profileDesign(r);
        pic.replaceChildren(design ? designArt(design) : bannerArt(r.id, r.color));
        return;
      }
      pic.replaceChildren(
        h(
          "button",
          {
            class: "profile-banner-open",
            attrs: { type: "button", "aria-label": `Open ${r.name}'s banner` },
            on: { click: () => openImage(url, r.name) },
          },
          h("img", { attrs: { src: url, alt: "", decoding: "async" } }),
        ),
      );
    };
    paint();

    async function save(banner: string | null, busy: HTMLButtonElement) {
      const res = await whileBusy(busy, () => api.updateProfile({ banner }));
      if (destroyed) return;
      if (!res.ok) {
        toast(res.message);
        return;
      }
      r.banner = res.data.resident.banner;
      rememberMyProfile(res.data.resident);
      paint();
      toast(banner ? "Banner saved" : "Banner removed");
    }

    function editable() {
      const input = h("input", {
        class: "visually-hidden",
        attrs: {
          type: "file",
          accept: "image/png,image/jpeg,image/webp",
          tabindex: -1,
          "aria-hidden": "true",
          "data-media": "banner",
        },
      });
      const text = h("span", { class: "banner-tool-label" });
      const changeButton = h(
        "button",
        {
          class: "pill-button small banner-change",
          attrs: { type: "button" },
          on: { click: () => input.click() },
        },
        icon("camera"),
        text,
      );
      const removeButton = h(
        "button",
        {
          class: "pill-button small banner-remove",
          attrs: { type: "button", "aria-label": "Remove banner" },
          on: { click: () => void save(null, removeButton) },
        },
        icon("close"),
        h("span", { class: "banner-tool-label", text: "Remove" }),
      );
      change = changeButton;
      remove = removeButton;
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        changeButton.disabled = true;
        const up = await uploadMedia(file, (f) => {
          text.textContent = `Uploading ${Math.round(f * 100)}%`;
        }).promise;
        changeButton.disabled = false;
        paint();
        if (destroyed) return;
        if (!up.ok) {
          toast(up.message);
          return;
        }
        if (up.data.kind !== "image") {
          toast("A banner has to be a picture.");
          return;
        }
        await save(up.data.id, changeButton);
      });
      el.append(h("div", { class: "profile-banner-tools" }, changeButton, removeButton), input);
      paint();
    }

    return { el, editable };
  }

  /**
   * "Lemon · Auburn bob · Citrus slices · Straw hat, Basket". Names are ours (the catalog), not
   * player text.
   */
  function lookLine(look: ProfileView["look"]): HTMLElement | null {
    if (!look) return null;
    const parts = [
      look.theme ? THEME_INFO[look.theme].label : null,
      (look.hair && hairName(look.hair, look.hairColor)) || null,
      look.patternMedia ? "Own pattern" : look.pattern ? PATTERN_LABELS[look.pattern] : null,
      look.wear?.length
        ? look.wear.map((w) => garmentName(w, look.wearStyle?.[w])).join(", ")
        : null,
    ].filter((p): p is string => p !== null);
    if (parts.length === 0) return null;
    return h("p", { class: "profile-look", attrs: { "data-look": "" }, text: parts.join(" · ") });
  }

  /** Their own picture of their home, and a way into its 3D model. */
  /** The Home section, which reloads itself from the profile after its plot is named. */
  function homeSectionFor(r: ProfileView): HTMLElement | null {
    const section = homeSection(r, async () => {
      const again = await api.profile(r.id);
      if (destroyed || !again.ok || !section?.isConnected) return;
      const next = homeSectionFor(again.data.resident);
      if (next) section.replaceWith(next);
    });
    return section;
  }

  /**
   * Their home: the plot they call home with its name (decision 0121), and their picture or model
   * of it. On your own profile, the button to name the plot.
   */
  function homeSection(r: ProfileView, renamed: () => unknown): HTMLElement | null {
    const art = mediaUrlOf(r.look?.homeArt);
    const model = mediaUrlOf(r.look?.homeModel);
    const home = r.home;
    if (!art && !model && !home) return null;
    const mine = savedToken() !== null && savedResidentId() === r.id;
    const shared = home?.shared ? (mine ? ", shared with you" : ", shared with them") : "";
    return h(
      "section",
      { class: "profile-home", attrs: { "aria-label": "Home" } },
      h("h2", { class: "profile-home-title", text: "Home" }),
      // A plot's name is its residents' words: text only.
      home?.name ? h("p", { class: "profile-home-name", text: home.name }) : null,
      home
        ? h("p", { class: "profile-home-where", text: `Plot ${home.px}, ${home.py}${shared}` })
        : null,
      home && mine
        ? h(
            "button",
            {
              class: "pill-button small profile-home-rename",
              attrs: { type: "button" },
              on: { click: () => openPlotNameSheet(home, { after: renamed }) },
            },
            icon("signpost"),
            h("span", { text: home.name ? "Rename your plot" : "Name your plot" }),
          )
        : null,
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
  function handleButton(r: ProfileView, line: HTMLElement, wrap: HTMLElement): HTMLElement {
    const label = h("span", { text: r.handle ? "Change handle" : "Pick a handle" });
    const b = h(
      "button",
      {
        class: "pill-button small handle-edit",
        attrs: { type: "button" },
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
    const error = errorLine("handle-error");
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
    wrap.after(form);
    const toggle = disclosure(b, form, input);
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
      const res = await whileBusy(save, () => api.updateProfile({ handle: parsed.data }));
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
      toggle.close();
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
    return r.blocked ? [] : [togetherCard(r, me)];
  }

  // ---------- someone else: gestures, streak, letters, block ----------

  function togetherCard(r: ProfileView, me: { id: string }): HTMLElement {
    const streak = h("p", { class: "streak-line", attrs: { "aria-live": "polite" } });
    const paintStreak = (days: number) => {
      streak.textContent = streakLine(days);
      streak.classList.toggle("on", days > 0);
    };
    paintStreak(0);

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
    const giftGive = h("button", {
      class: "btn-primary small",
      attrs: { type: "submit" },
      text: "Give",
    });
    const giftForm = h(
      "form",
      { class: "gift-form", attrs: { id: "gift-form", hidden: true, novalidate: true } },
      h("label", { class: "field-label", attrs: { for: "gift-note" }, text: "What's the gift?" }),
      h("div", { class: "gift-row" }, giftNote, giftGive),
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
      toast(sentLine(kind, r.name, res.data));
      return true;
    };

    const row = h("div", { class: "gesture-row", attrs: { role: "group", "aria-label": "Send" } });
    let giftToggle: { close(): void } | undefined;
    const button = (g: GestureInfo) => {
      const b = h(
        "button",
        {
          class: "gesture",
          attrs: { type: "button", "data-kind": g.kind, "aria-label": `Send ${g.noun}` },
        },
        h("span", { class: "gesture-emoji", attrs: { "aria-hidden": "true" }, text: g.emoji }),
        h("span", { class: "gesture-label", text: g.label }),
      );
      // The gift button opens a note form; the others send straight away.
      if (g.kind === "gift")
        giftToggle = disclosure(
          b,
          giftForm,
          giftNote,
          only(() => giftToggle),
        );
      else b.addEventListener("click", () => void whileBusy(b, () => send(g.kind, b)));
      return b;
    };
    for (const g of gestureChoices([], 0, me.id, r.sharesPlot)) row.append(button(g));
    // Close-only gestures (a kiss) join the row in their place once the history says you're close.
    void api.gestures(r.id).then((res) => {
      if (destroyed || !res.ok) return;
      paintStreak(res.data.streaks[0]?.streak ?? 0);
      const streak = res.data.streaks[0]?.streak ?? 0;
      const choices = gestureChoices(res.data.gestures, streak, me.id, r.sharesPlot);
      choices.forEach((g, i) => {
        if (row.querySelector(`[data-kind="${g.kind}"]`)) return;
        const after = choices[i - 1];
        const prev = after ? row.querySelector(`[data-kind="${after.kind}"]`) : null;
        if (prev) prev.after(button(g));
        else row.prepend(button(g));
      });
    });
    giftForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const note = giftNote.value.trim();
      if (!note) {
        giftNote.focus();
        return;
      }
      // Enter twice, or a double tap on Give, sends once.
      if (giftGive.disabled) return;
      const button = row.querySelector<HTMLElement>('[data-kind="gift"]') ?? giftForm;
      if (await whileBusy(giftGive, () => send("gift", button, note))) {
        giftNote.value = "";
        giftToggle?.close();
      }
    });

    const coin = coinGift(r, only);
    const thing = thingGift(r, only);
    // Quick hellos up top, with the streak they build right under them. Then the bigger sends in
    // one even row, and whichever of their forms is open below it.
    return h(
      "section",
      { class: "stack paper card together", attrs: { "aria-labelledby": "together-title" } },
      h("p", { class: "eyebrow", attrs: { id: "together-title" }, text: `Say hi to ${r.name}` }),
      row,
      giftForm,
      streak,
      h(
        "div",
        { class: "together-sends" },
        h(
          "a",
          { class: "pill-button write-letter", attrs: { href: lettersPath(r.id) } },
          icon("mail"),
          h("span", { text: "Write a letter" }),
        ),
        coin.open,
        thing.open,
      ),
      coin.form,
      thing.form,
    );
  }

  /** One send form open at a time: opening one closes whichever was open before. */
  let openPanel: { close(): void } | undefined;
  function only(self: () => { close(): void } | undefined) {
    return (shown: boolean) => {
      const me = self();
      if (!shown) {
        if (openPanel === me) openPanel = undefined;
        return;
      }
      if (openPanel && openPanel !== me) openPanel.close();
      openPanel = me;
    };
  }

  /**
   * Give coins (RFC 0008): a button that opens a small form with an amount and an optional note.
   * The server and the sim check every limit; their refusal is shown as it comes.
   */
  function coinGift(r: ProfileView, only: Only) {
    const amount = h("input", {
      class: "field-input coin-amount",
      attrs: {
        id: "coin-amount",
        type: "number",
        inputmode: "numeric",
        min: 1,
        step: 1,
        value: "5",
        "aria-describedby": "coin-hint",
      },
    });
    const note = h("input", {
      class: "field-input",
      attrs: {
        id: "coin-note",
        maxlength: COIN_RULES.noteMax,
        placeholder: "For the lantern tour",
        enterkeyhint: "send",
        autocomplete: "off",
      },
    });
    const quick = h(
      "div",
      { class: "coin-quick", attrs: { role: "group", "aria-label": "Amount" } },
      ...[5, 10, 25].map((n) =>
        h("button", {
          class: "pill-button small",
          attrs: { type: "button" },
          text: String(n),
          on: {
            click: () => {
              amount.value = String(n);
            },
          },
        }),
      ),
    );
    const give = h("button", {
      class: "btn-primary small",
      attrs: { type: "submit" },
      text: "Give",
    });
    const form = h(
      "form",
      { class: "stack tight coin-form", attrs: { hidden: true, novalidate: true } },
      h("label", { class: "field-label", attrs: { for: "coin-amount" }, text: "How many coins?" }),
      h("div", { class: "coin-row" }, amount, quick),
      h("label", { class: "field-label", attrs: { for: "coin-note" }, text: "Note (optional)" }),
      h("div", { class: "gift-row" }, note, give),
      h("p", {
        class: "field-hint",
        attrs: { id: "coin-hint" },
        text: `Up to ${COIN_RULES.giveCap} a day. ${r.name} sees the note. Only give because you want to, never because someone asked.`,
      }),
    );
    const open = h(
      "button",
      {
        class: "pill-button coin-open",
        attrs: { type: "button" },
      },
      icon("coin"),
      h("span", { text: "Give coins" }),
    );
    form.id = "coin-form";
    const toggle = disclosure(
      open,
      form,
      amount,
      only(() => toggle),
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const n = Number(amount.value);
      if (!Number.isInteger(n) || n < 1) {
        toast("Coins are whole numbers, at least 1.");
        amount.focus();
        return;
      }
      const text = note.value.trim();
      const res = await whileBusy(give, () =>
        api.act({ type: "give_coins", to: r.id, amount: n, ...(text ? { note: text } : {}) }),
      );
      if (destroyed) return;
      const problem = actProblem(res);
      if (problem) return toast(problem);
      floatUp(open, "🪙");
      toast(`You gave ${coins(n)} to ${r.name}`);
      note.value = "";
      toggle.close();
      open.focus();
      refreshPurse(true);
    });
    return { open, form };
  }

  /**
   * Give a thing (RFC 0005): a button that opens a small form listing what you hold, with a count
   * for things that stack and an optional note. The server and the sim check every limit.
   */
  function thingGift(r: ProfileView, only: Only) {
    const pick = h("select", { class: "field-input", attrs: { id: "thing-pick" } });
    const count = h("input", {
      class: "field-input coin-amount",
      attrs: {
        id: "thing-count",
        type: "number",
        inputmode: "numeric",
        min: 1,
        max: ITEM_RULES.giveCountMax,
        step: 1,
        value: "1",
      },
    });
    const note = h("input", {
      class: "field-input",
      attrs: {
        id: "thing-note",
        maxlength: ITEM_RULES.noteMax,
        placeholder: "Picked this morning",
        enterkeyhint: "send",
        autocomplete: "off",
      },
    });
    const give = h("button", {
      class: "btn-primary small",
      attrs: { type: "submit" },
      text: "Give",
    });
    const status = h("p", { class: "field-hint", attrs: { id: "thing-hint" } });
    const countRow = h(
      "div",
      { class: "coin-row" },
      h("label", { class: "field-label", attrs: { for: "thing-count" }, text: "How many?" }),
      count,
    );
    const form = h(
      "form",
      {
        class: "stack tight thing-form",
        attrs: { id: "thing-form", hidden: true, novalidate: true },
      },
      h("label", { class: "field-label", attrs: { for: "thing-pick" }, text: "What to give" }),
      pick,
      countRow,
      h("label", { class: "field-label", attrs: { for: "thing-note" }, text: "Note (optional)" }),
      h("div", { class: "gift-row" }, note, give),
      status,
    );
    const open = h(
      "button",
      {
        class: "pill-button thing-open",
        attrs: {
          type: "button",
          id: "thing-open",
          "aria-expanded": "false",
          "aria-controls": "thing-form",
        },
      },
      icon("gift"),
      h("span", { text: "Give a thing" }),
    );
    /** Made things go by id; stacks by kind, with a count. */
    const stacked = new Set<string>();
    const syncCount = () => {
      countRow.hidden = !stacked.has(pick.value);
    };
    pick.addEventListener("change", syncCount);
    async function fill() {
      pick.replaceChildren();
      stacked.clear();
      status.textContent = "Looking in your things…";
      const res = await api.inventory();
      if (destroyed) return;
      if (!res.ok) {
        status.textContent = res.message;
        return;
      }
      const inv = res.data.inventory;
      for (const g of inv?.goods ?? []) {
        // A label is someone's words: it goes in as text.
        const text = g.label ? `${thingName(g.kind)} “${g.label}”` : thingName(g.kind);
        pick.append(h("option", { attrs: { value: g.id }, text }));
      }
      for (const s of inv?.stacks ?? []) {
        stacked.add(s.kind);
        pick.append(h("option", { attrs: { value: s.kind }, text: thingCount(s.kind, s.count) }));
      }
      const empty = pick.options.length === 0;
      give.toggleAttribute("disabled", empty);
      status.textContent = empty
        ? "You have nothing to give yet. Grow or make something first."
        : `Up to ${ITEM_RULES.giveCap} things a day. ${r.name} sees the note and can send it back. Only give because you want to.`;
      syncCount();
    }
    // What you hold is read fresh each time the form opens.
    const exclusive = only(() => toggle);
    const toggle = disclosure(open, form, pick, (shown) => {
      exclusive(shown);
      if (shown) void fill().then(() => pick.focus());
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const item = pick.value;
      if (!item) return;
      const n = Number(count.value);
      const many = stacked.has(item) && Number.isInteger(n) && n > 1 ? { count: n } : {};
      const text = note.value.trim();
      // A gift gesture carries the thing, so they hear about it live and can send it back.
      const res = await whileBusy(give, () =>
        api.gesture(r.id, { kind: "gift", item, ...many, ...(text ? { note: text } : {}) }),
      );
      if (destroyed) return;
      if (!res.ok) return toast(res.message);
      floatUp(open, "🎁");
      toast(`You gave ${r.name} a gift`);
      note.value = "";
      count.value = "1";
      toggle.close();
      open.focus();
    });
    return { open, form };
  }

  /**
   * A secret kiss, Block (or Unblock), and Report, for the "…" menu on someone else's profile. The
   * kiss is here for anyone, out of the way: they only find out if they kiss back (decision 0066).
   * Blocking asks first: the first tap arms it, the second does it, and closing the menu disarms it.
   */
  function profileMore(
    r: ProfileView,
    close: () => void,
  ): { items: HTMLElement[]; onClose: () => void } {
    const blockItem = h("button", { class: "menu-item", attrs: { type: "button" } });
    const reportItem = h("button", {
      class: "menu-item",
      attrs: { type: "button" },
      text: `Report ${r.name}`,
    });
    blockItem.textContent = r.blocked ? `Unblock ${r.name}` : `Block ${r.name}`;
    const menu = { close };
    const kissItem = h(
      "button",
      { class: "menu-item calm secret-kiss", attrs: { type: "button" } },
      h("span", { attrs: { "aria-hidden": "true" }, text: gestureInfo("kiss").emoji }),
      h("span", { text: "Send a secret kiss" }),
    );
    kissItem.addEventListener("click", async () => {
      const res = await whileBusy(kissItem, () => api.gesture(r.id, { kind: "kiss" }));
      if (destroyed) return;
      menu.close();
      toast(res.ok ? sentLine("kiss", r.name, res.data) : res.message);
    });
    reportItem.addEventListener("click", () => {
      menu.close();
      openReportSheet({ kind: "resident", id: r.id, label: "profile" });
    });
    const disarm = confirmTwice(
      blockItem,
      "Tap again to block",
      () => void block(),
      () => !r.blocked,
    );
    const block = async () => {
      const res = await whileBusy(blockItem, () => api.block(r.id, !r.blocked));
      if (destroyed) return;
      if (!res.ok) {
        toast(res.message);
        return;
      }
      menu.close();
      toast(
        res.data.resident.blocked
          ? "Blocked. No letters or gestures between you, and their posts leave your feed."
          : "Unblocked.",
      );
      void load();
    };
    const items = r.blocked ? [blockItem, reportItem] : [kissItem, blockItem, reportItem];
    return { items, onClose: () => disarm() };
  }

  // ---------- visitors: join and follow ----------

  function joinAndFollow(r: ProfileView): HTMLElement {
    const card = h("section", { class: "stack paper card join-follow" });
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
    const show = h("button", { class: "pill-button small", attrs: { type: "button" } }, showLabel);
    disclosure(show, key, undefined, (open) => {
      showLabel.textContent = open ? "Hide key" : "Show key";
    });
    const copyLabel = h("span", { text: "Copy key" });
    const copy = h(
      "button",
      { class: "btn-primary small", attrs: { type: "button" } },
      icon("copy"),
      copyLabel,
    );
    copyButton(copy, copyLabel, () => token, {
      idle: "Copy key",
      copied: "Copied. Keep it private",
      failed: "Couldn't copy. Show the key and copy it from there.",
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
      switchKey(),
    );
  }

  /**
   * "Use a different key": bring another character into this browser in place of this one. The
   * key is checked before it's saved, and the page reloads so nothing keeps the old character.
   */
  function switchKey(): HTMLElement {
    const input = h("input", {
      class: "field-input",
      attrs: {
        id: "switch-key",
        type: "password",
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "false",
        placeholder: "Paste the other key",
        "aria-describedby": "switch-key-error",
      },
    });
    const error = errorLine("switch-key-error");
    const go = h("button", {
      class: "pill-button small",
      attrs: { type: "button", id: "switch-key-go" },
      text: "Use this key",
    });
    const use = async () => {
      const value = input.value.trim();
      if (!value) {
        error.textContent = "Paste a key first.";
        input.focus();
        return;
      }
      if (value === savedToken()) {
        error.textContent = "That's the key this browser already uses.";
        return;
      }
      go.disabled = true;
      error.textContent = "";
      const who = await whoseKey(value);
      if (destroyed) return;
      go.disabled = false;
      if (!who.ok) {
        error.textContent = who.message;
        return;
      }
      saveToken(value, who.data.id);
      forgetMe();
      location.assign("/world");
    };
    go.addEventListener("click", () => void use());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void use();
      }
    });
    return h(
      "details",
      { class: "restore identity-switch" },
      h("summary", { text: "Use a different key" }),
      h("p", {
        class: "field-hint",
        text: "This browser will hold the character that key opens instead of this one. Copy your current key first and keep it safe, or you can't bring this character back.",
      }),
      h(
        "div",
        { class: "restore-row" },
        h("label", { class: "visually-hidden", attrs: { for: "switch-key" }, text: "Other key" }),
        input,
        go,
      ),
      error,
    );
  }

  function lookCard(r: ProfileView): HTMLElement {
    let color = r.color;
    let shape = r.shape;
    const preview = tokenPreview(color, shape, r.name, r.look);
    const shapes = shapeChips(shape, (v) => {
      shape = v;
      preview.paint(color, shape, r.name, r.look);
    }).row;
    const colors = colorChips(color, (v) => {
      color = v;
      preview.paint(color, shape, r.name, r.look);
    }).row;
    const note = h("input", {
      class: "field-input",
      attrs: { id: "look-note", maxlength: NOTE_MAX_LENGTH, autocomplete: "off" },
    });
    note.value = r.note;
    /** What this card changed and hasn't saved yet. */
    const cardChanges = () => ({
      ...(color !== r.color ? { color } : {}),
      ...(shape !== r.shape ? { shape } : {}),
      ...(note.value.trim() !== r.note ? { note: note.value.trim() } : {}),
    });
    const error = errorLine();
    const save = h("button", {
      class: "btn-primary small",
      attrs: { type: "submit" },
      text: "Save my look",
    });
    const form = h(
      "form",
      {
        class: "stack paper card look",
        attrs: { novalidate: true, "aria-labelledby": "look-title" },
      },
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
          h("span", { class: "field-label", text: "Theme, hair, pattern, and things to wear" }),
          h("span", {
            class: "look-dress-now",
            text:
              lookLine(r.look)?.textContent ||
              "Pick a theme like Lemon or Ocean, a hair style, and a hat.",
          }),
        ),
        h(
          "button",
          {
            class: "pill-button small look-open",
            attrs: { type: "button" },
            on: {
              // The editor previews the color and shape picked here, so its Save saves them too,
              // along with a changed note.
              click: () =>
                openLookEditor(
                  { color, shape, look: r.look, pending: cardChanges(), entitled: r.entitled },
                  (look) => {
                    r.look = look;
                    forgetMe();
                    void load();
                  },
                ),
            },
          },
          icon("sparkle"),
          h("span", { text: "Dress up" }),
        ),
      ),
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const changes = cardChanges();
      if (Object.keys(changes).length === 0) {
        error.textContent = "Nothing to change yet. Pick a new color, shape, or note.";
        return;
      }
      const res = await whileBusy(save, () => api.setLook(changes));
      if (destroyed) return;
      const problem = actProblem(res);
      if (problem) {
        error.textContent = problem;
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

  /**
   * Praise (issue #36): a small public thank-you, once a UTC day per person. No coins come with it.
   * The server decides every limit; this shows its answer.
   */
  /** Their karma, with what it means on hover and for screen readers. */
  function karmaChip(r: ProfileView): HTMLElement | null {
    const line = karmaLine(r.karma);
    if (!line) return null;
    return h("span", {
      class: "profile-karma",
      text: line,
      attrs: { title: "Karma: appreciation from other residents over the last 90 days" },
    });
  }

  function praiseButton(r: ProfileView, repaint: () => void): HTMLElement {
    const label = h("span");
    const star = icon("star", "icon praise-star");
    const b = h(
      "button",
      { class: "pill-button small praise", attrs: { type: "button" } },
      star,
      label,
    );
    const paint = () => {
      const done = r.praisedToday === true;
      b.classList.toggle("on", done);
      star.classList.toggle("filled", done);
      b.setAttribute("aria-pressed", String(done));
      label.textContent = done ? "Praised today" : "Praise";
      b.title = done
        ? `You praised ${r.name} today. You can again tomorrow.`
        : `Praise ${r.name}: a thank-you they see on their profile, once a day`;
      repaint();
    };
    paint();
    b.addEventListener("click", async () => {
      if (r.praisedToday) {
        toast(`You praised ${r.name} today. You can again tomorrow.`);
        return;
      }
      const res = await whileBusy(b, () => api.praise(r.id));
      if (destroyed) return;
      if (!res.ok) {
        toast(res.message);
        return;
      }
      r.praise = res.data.resident.praise;
      r.praisedToday = res.data.resident.praisedToday;
      paint();
      floatUp(b, "⭐");
      toast(`You praised ${r.name}.`);
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
