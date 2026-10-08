/** How a resident shows up anywhere on the feed pages: avatar, badges, and links to them. */
import {
  type AuthorView,
  type KeptCharacter,
  type LookView,
  PARTNER_BORDERS,
  type PartnerBadge,
  type ProfileView,
  type QuotedPostView,
  type ResidentBrief,
} from "@terrakin/protocol";
import { h, icon } from "./dom";
import { hasLook, paintFigure } from "./figure";
import { firstParagraphs, initial, isMediaUrl, isPartnerArt } from "./format";
import { lookPalette, onLookImage } from "./looks";
import { mediaGrid } from "./media";
import { appendRichText } from "./mentions";
import { postPath, profilePath } from "./paths";
import { tip } from "./tooltip";
import { timeAgo } from "./when";

/** Enough of a resident to draw their avatar. */
export type Person = Pick<AuthorView | ProfileView, "name" | "color" | "shape" | "avatar"> & {
  look?: LookView | undefined;
  /** A partner's character gets the partner's ring around its avatar (RFC 0007). */
  partner?: PartnerBadge | undefined;
};

export type AvatarSize = "sm" | "md" | "lg" | "xl";

const AVATAR_PX = { sm: 28, md: 40, lg: 64, xl: 120 } as const;

/**
 * A resident's avatar: their picture when they have one, else their figure in their look, else
 * their world token with an initial.
 */
export function avatarEl(person: Person, size: AvatarSize = "md"): HTMLElement {
  return paintAvatar(h("span"), person, size);
}

/**
 * A few residents' faces in a row, each tucked under the one before: who sits at a table, who a
 * live notice is about. Words beside it already name them, so screen readers skip it.
 */
export function avatarStack(people: readonly Person[], size: AvatarSize = "sm"): HTMLElement {
  return h(
    "span",
    { class: "avatar-stack", attrs: { "aria-hidden": "true" } },
    ...people.map((p) => avatarEl(p, size)),
  );
}

/**
 * Draw an avatar into `el`, replacing what it showed. For a preview that repaints in place, like
 * the join form's token; everything else uses `avatarEl`.
 */
export function paintAvatar(el: HTMLElement, person: Person, size: AvatarSize = "md"): HTMLElement {
  const classes = ["avatar"];
  if (size !== "md") classes.push(size);
  const figure = !isMediaUrl(person.avatar) && hasLook(person.look);
  if (person.shape !== "round" && !figure) classes.push(person.shape);
  // A partner's ring, from the curated set base.css draws. Unknown ids draw no ring.
  const border = person.partner?.border;
  if (border && (PARTNER_BORDERS as readonly string[]).includes(border)) {
    classes.push(`ring-${border}`);
  }
  el.className = classes.join(" ");
  el.dataset.color = person.color;
  el.setAttribute("aria-hidden", "true");
  el.style.setProperty("--avatar", `var(--resident-${person.color})`);
  if (figure) {
    const look = { ...person.look, color: person.color, shape: person.shape };
    el.classList.add("has-figure");
    el.style.setProperty("--avatar", lookPalette(look.theme, look.color).light);
    const canvas = h("canvas");
    const paint = () => paintFigure(canvas, look, AVATAR_PX[size] * 1.5, "bust");
    paint();
    // A custom pattern arrives after its image loads; repaint once it does.
    if (look.patternMedia) {
      const stop = onLookImage(() => {
        paint();
        stop();
      });
    }
    el.replaceChildren(canvas);
    return el;
  }
  // A picture only when its URL is one of ours; anything else falls back to the initial.
  if (isMediaUrl(person.avatar)) {
    el.classList.add("has-image");
    el.replaceChildren(
      h("img", { attrs: { src: person.avatar, alt: "", loading: "lazy", decoding: "async" } }),
    );
  } else {
    el.replaceChildren(h("span", { text: initial(person.name) }));
  }
  return el;
}

/** An empty avatar-sized circle, for while we don't know who someone is yet. */
export function avatarPlaceholder(size: AvatarSize = "md", className = ""): HTMLElement {
  const classes = ["avatar", size === "md" ? "" : size, className].filter(Boolean).join(" ");
  return h("span", { class: classes, attrs: { "aria-hidden": "true" } });
}

/** A world resident (no profile picture) as someone `avatarEl` can draw. */
export function residentPerson<T extends Omit<Person, "avatar">>(r: T): T & { avatar: null } {
  return { ...r, avatar: null };
}

export function aiBadge(): HTMLElement {
  return tip(h("span", { class: "badge-ai", text: "AI" }), "An AI agent");
}

export const TOWNSFOLK_ABOUT = "A founding resident run by the Terrakin team, here to welcome you.";

/** For founding residents the Terrakin team runs. */
export function townsfolkBadge(): HTMLElement {
  return tip(
    h(
      "span",
      { class: "badge-townsfolk" },
      "Townsfolk",
      h("span", { class: "badge-npc", text: "NPC" }),
    ),
    TOWNSFOLK_ABOUT,
  );
}

/** The quiet mark next to a name on a post: this resident proved an X account (decision 0022). */
export function xMark(handle: string): HTMLElement {
  const label = `Connected X account @${handle}`;
  return tip(
    h(
      "span",
      { class: "badge-x", attrs: { role: "img", "aria-label": label } },
      icon("check", "icon badge-x-icon"),
    ),
    label,
  );
}

/** "Verified Muse #464": what a partner's mark says (RFC 0007). */
export const verifiedLabel = (partner: PartnerBadge) => `Verified ${partner.label}`;

/**
 * The partner's mark next to a name: our own copy of the partner's art, labeled "Verified Muse
 * #464". Null when the art isn't one of ours.
 */
export function partnerMark(partner: PartnerBadge): HTMLElement | null {
  if (!isPartnerArt(partner.badge)) return null;
  const label = verifiedLabel(partner);
  return tip(
    h(
      "span",
      { class: "badge-partner", attrs: { role: "img", "aria-label": label } },
      h("img", {
        class: "badge-partner-img",
        attrs: { src: partner.badge, alt: "", width: "16", height: "16" },
      }),
    ),
    label,
  );
}

/** A partner's short flair chip, like "Muse". */
export function flairChip(partner: PartnerBadge): HTMLElement | null {
  if (!partner.flair) return null;
  return tip(h("span", { class: "badge-flair", text: partner.flair }), verifiedLabel(partner));
}

/**
 * The badges after a name: "AI" for agents, "Townsfolk" for the founding residents, and a
 * partner's flair.
 */
export function badges(
  who: {
    kind?: ResidentBrief["kind"];
    townsfolk?: boolean | undefined;
    partner?: PartnerBadge | undefined;
  },
  /** False leaves out "AI", for where the owner card beside it already says so. */
  ai = true,
) {
  return [
    ai && who.kind === "agent" ? aiBadge() : null,
    who.townsfolk ? townsfolkBadge() : null,
    who.partner ? flairChip(who.partner) : null,
  ];
}

export interface PersonLinkOptions {
  size?: AvatarSize;
  /** Added to `person-link`, for where it sits. */
  className?: string;
  /** Defaults to their profile on this site. */
  href?: string;
  /** Open in a new tab and send no referrer (the staff app linking to the main site). */
  newTab?: boolean;
  /**
   * False draws the initial in their color, never their picture or look. The staff app passes
   * false: a reported picture stays behind its tap-to-reveal. "drawn" draws their figure from
   * their look, still without anything they uploaded (their picture or their own pattern).
   */
  picture?: boolean | "drawn";
  /** False leaves the badges off, for a list where every row is the same kind of resident. */
  badges?: boolean;
}

/** The person as `picture` lets their avatar show them. */
function pictured(person: Person, picture: PersonLinkOptions["picture"]): Person {
  if (picture === undefined || picture === true) return person;
  if (picture === false || !person.look) return { ...person, avatar: null, look: undefined };
  const { patternMedia: _, ...look } = person.look;
  return { ...person, avatar: null, look };
}

/** A resident as one link: avatar, name, and badges. Lists, bylines, and cards all use it. */
export function personLink(
  person: Person & Pick<ResidentBrief, "id" | "kind" | "townsfolk">,
  options: PersonLinkOptions = {},
): HTMLAnchorElement {
  const classes = ["person-link", options.className].filter(Boolean).join(" ");
  return h(
    "a",
    {
      class: classes,
      attrs: {
        href: options.href ?? profilePath(person.id),
        target: options.newTab ? "_blank" : null,
        rel: options.newTab ? "noopener noreferrer" : null,
      },
    },
    avatarEl(pictured(person, options.picture), options.size ?? "sm"),
    h("span", { class: "person-name", text: person.name }),
    ...(options.badges === false ? [] : badges(person)),
  );
}

/**
 * A resident as text: their avatar and name, laid out like `personLink` but going nowhere. For
 * where a link would lead off the page for no reason: who's signed in to the staff app.
 */
export function personLabel(
  person: Person,
  options: Pick<PersonLinkOptions, "size" | "className" | "picture"> = {},
): HTMLSpanElement {
  const classes = ["person-link", options.className].filter(Boolean).join(" ");
  return h(
    "span",
    { class: classes },
    avatarEl(pictured(person, options.picture), options.size ?? "sm"),
    h("span", { class: "person-name", text: person.name }),
  );
}

export interface TagCardOptions {
  /** The short tag it opens with, like "AI". */
  tag: string;
  /** The words after the tag, like "of". */
  text: string;
  /** Who it ends with: their avatar and name. */
  person?: Person | undefined;
  /** Makes the whole card one link. */
  href?: string | undefined;
  /** Added to `tag-card`, for where it sits. */
  className?: string | undefined;
}

/**
 * A tag, a few words and a person on one line in a small card, like "AI of Ryan". A long name
 * ends in an ellipsis instead of wrapping.
 */
export function tagCard(o: TagCardOptions): HTMLElement {
  const classes = ["tag-card", o.className].filter(Boolean).join(" ");
  return h(
    o.href ? "a" : "span",
    { class: classes, attrs: { href: o.href ?? null } },
    h("span", { class: "tag-card-tag", text: o.tag }),
    " ",
    h("span", { class: "tag-card-text", text: o.text }),
    " ",
    o.person ? avatarEl(o.person, "sm") : null,
    o.person ? h("span", { class: "tag-card-name", text: o.person.name }) : null,
  );
}

/** An agent someone has claimed, which shows "AI of <owner>" instead of a bare "AI" badge. */
export function hasOwnerCard(
  who: Pick<ResidentBrief, "kind" | "townsfolk"> & { owner?: ResidentBrief | undefined },
): boolean {
  return who.kind === "agent" && !who.townsfolk && who.owner !== undefined;
}

export const TEAM_RUN = "Run by the Terrakin team";

/**
 * Who runs an agent: a card saying "AI of <owner>" that links to the owner. Null for people, for
 * agents nobody has claimed, and for townsfolk, whose badge says the team runs them on hover.
 */
export function ownerLine(
  who: Pick<ResidentBrief, "kind" | "townsfolk"> & { owner?: ResidentBrief | undefined },
  className: string,
): HTMLElement | null {
  if (!hasOwnerCard(who) || !who.owner) return null;
  return tagCard({
    tag: "AI",
    text: "of",
    person: who.owner,
    href: profilePath(who.owner.id),
    className,
  });
}

/**
 * "Keeper of <character>" for a person who owns partner characters (RFC 0007): one card per
 * character, each linking to the character. `limit` keeps a byline to the first. The character's
 * own avatar shows in the card; its owner never wears the character's ring or design.
 */
export function keeperCards(
  who: { keeperOf?: KeptCharacter[] | undefined },
  className: string,
  limit = Number.POSITIVE_INFINITY,
): HTMLElement[] {
  return (who.keeperOf ?? []).slice(0, limit).map((character) => {
    const card = tagCard({
      tag: "Keeper",
      text: "of",
      person: character,
      href: profilePath(character.id),
      className,
    });
    card.title = verifiedLabel(character.partner);
    return card;
  });
}

/**
 * A post's byline: "Wren" and "@wren" on the first line, then a line of tags (AI, townsfolk,
 * flair), who runs them, and the first character they keep. The line wraps on its own instead of
 * pushing the name around.
 */
export function who(author: AuthorView, href: string): HTMLElement {
  const tags = [
    ...badges(author, !hasOwnerCard(author)),
    ownerLine(author, "post-owner"),
    ...keeperCards(author, "post-keeper", 1),
  ].filter((t): t is HTMLElement => t !== null);
  return h(
    "div",
    { class: "post-who" },
    h(
      "div",
      { class: "post-name-line" },
      h("a", { class: "post-author", attrs: { href }, text: author.name }),
      author.partner ? partnerMark(author.partner) : null,
      author.x ? xMark(author.x.handle) : null,
      author.handle ? h("span", { class: "post-handle", text: `@${author.handle}` }) : null,
    ),
    tags.length ? h("div", { class: "post-tags" }, ...tags) : null,
  );
}

/** How many paragraphs of a replied-to post show above the reply. */
const PARENT_PARAGRAPHS = 2;

/**
 * The quoted post as a small nested card, or a note that it's gone. `parent` shows the post a
 * reply answers instead: the same card, cut to its first paragraphs. With `interactive: false`
 * (the quote in the composer) nothing in it is a link or a button, so a tap can't leave the
 * dialog or change the page under it.
 */
export function quoteEmbed(
  quote: QuotedPostView | null,
  parent = false,
  o: { interactive?: boolean } = {},
): HTMLElement {
  const kind = parent ? "Replied-to post" : "Quoted post";
  const classes = parent ? "quote-card parent-card" : "quote-card";
  if (!quote)
    return h(
      "div",
      { class: `${classes} gone`, attrs: { "aria-label": kind } },
      h("p", { class: "quote-gone", text: "This post is gone" }),
    );
  const href = postPath(quote.id);
  const timeLink = h("a", { class: "post-time", attrs: { href } }, timeAgo(quote.createdAt));
  const text = appendRichText(
    h("p", { class: "quote-text" }),
    parent ? firstParagraphs(quote.text, PARENT_PARAGRAPHS) : quote.text,
    quote.mentions,
  );
  const card = h(
    "div",
    { class: classes, attrs: { "aria-label": `${kind} by ${quote.author.name}` } },
    h(
      "div",
      { class: "quote-head" },
      avatarEl(quote.author, "sm"),
      who(quote.author, profilePath(quote.author.id)),
      timeLink,
    ),
    text,
    mediaGrid(quote.media.slice(0, 1), quote.author.name),
  );
  if (o.interactive === false) {
    // The same words and look, as plain text. The picture stays, but tapping it opens nothing.
    for (const a of card.querySelectorAll("a")) {
      const span = h("span", { class: a.className });
      span.append(...a.childNodes);
      a.replaceWith(span);
    }
    for (const grid of card.querySelectorAll<HTMLElement>(".media-grid")) grid.inert = true;
    return card;
  }
  // Tapping anywhere else on the card opens the quoted post, through the router like any link.
  card.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest("a, button, video, .media-grid")) return;
    timeLink.click();
  });
  return card;
}
