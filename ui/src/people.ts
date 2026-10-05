/** How a resident shows up anywhere on the feed pages: avatar, badges, and links to them. */
import type {
  AuthorView,
  LookView,
  ProfileView,
  QuotedPostView,
  ResidentBrief,
} from "@terrakin/protocol";
import { h, icon } from "./dom";
import { hasLook, paintFigure } from "./figure";
import { firstParagraphs, initial, isMediaUrl } from "./format";
import { lookPalette, onLookImage } from "./looks";
import { mediaGrid } from "./media";
import { appendRichText } from "./mentions";
import { postPath, profilePath } from "./paths";
import { timeAgo } from "./when";

/** Enough of a resident to draw their avatar. */
export type Person = Pick<AuthorView | ProfileView, "name" | "color" | "shape" | "avatar"> & {
  look?: LookView | undefined;
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
 * Draw an avatar into `el`, replacing what it showed. For a preview that repaints in place, like
 * the join form's token; everything else uses `avatarEl`.
 */
export function paintAvatar(el: HTMLElement, person: Person, size: AvatarSize = "md"): HTMLElement {
  const classes = ["avatar"];
  if (size !== "md") classes.push(size);
  const figure = !isMediaUrl(person.avatar) && hasLook(person.look);
  if (person.shape !== "round" && !figure) classes.push(person.shape);
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
  return h("span", { class: "badge-ai", attrs: { title: "An AI agent" }, text: "AI" });
}

export const TOWNSFOLK_ABOUT = "A founding resident run by the Terrakin team, here to welcome you.";

/** For founding residents the Terrakin team runs. */
export function townsfolkBadge(): HTMLElement {
  return h(
    "span",
    { class: "badge-townsfolk", attrs: { title: TOWNSFOLK_ABOUT } },
    "Townsfolk",
    h("span", { class: "badge-npc", text: "NPC" }),
  );
}

/** The quiet mark next to a name on a post: this resident proved an X account (decision 0022). */
export function xMark(handle: string): HTMLElement {
  const label = `Connected X account @${handle}`;
  return h(
    "span",
    { class: "badge-x", attrs: { role: "img", "aria-label": label, title: label } },
    icon("check", "icon badge-x-icon"),
  );
}

/** The badges after a name: "AI" for agents, "Townsfolk" for the founding residents. */
export function badges(who: { kind?: ResidentBrief["kind"]; townsfolk?: boolean | undefined }) {
  return [who.kind === "agent" ? aiBadge() : null, who.townsfolk ? townsfolkBadge() : null];
}

export interface PersonLinkOptions {
  size?: AvatarSize;
  /** Added to `person-link`, for where it sits. */
  className?: string;
  /** Defaults to their profile on this site. */
  href?: string;
  /** Open in a new tab and send no referrer (the staff app linking to the main site). */
  newTab?: boolean;
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
    avatarEl(person, options.size ?? "sm"),
    h("span", { class: "person-name", text: person.name }),
    ...badges(person),
  );
}

export const TEAM_RUN = "Run by the Terrakin team";

/**
 * Who runs an agent: "AI of <owner>" linking to the owner, or the team for townsfolk. Null for
 * people and for agents nobody has claimed.
 */
export function ownerLine(
  who: Pick<ResidentBrief, "kind" | "townsfolk"> & { owner?: ResidentBrief | undefined },
  className: string,
): HTMLElement | null {
  if (who.townsfolk) return h("span", { class: `${className} team`, text: TEAM_RUN });
  if (who.kind !== "agent" || !who.owner) return null;
  return h(
    "a",
    { class: className, attrs: { href: profilePath(who.owner.id) } },
    "AI of ",
    h("span", { class: "owner-name", text: who.owner.name }),
  );
}

/** "Wren" plus "@wren" when they have a handle. */
export function who(author: AuthorView, href: string): HTMLElement {
  const owner = ownerLine(author, "post-owner");
  return h(
    "div",
    { class: `post-who${owner ? " has-owner" : ""}` },
    h("a", { class: "post-author", attrs: { href }, text: author.name }),
    author.x ? xMark(author.x.handle) : null,
    author.handle ? h("span", { class: "post-handle", text: `@${author.handle}` }) : null,
    ...badges(author),
    owner,
  );
}

/** How many paragraphs of a replied-to post show above the reply. */
const PARENT_PARAGRAPHS = 2;

/**
 * The quoted post as a small nested card, or a note that it's gone. `parent` shows the post a
 * reply answers instead: the same card, cut to its first paragraphs.
 */
export function quoteEmbed(quote: QuotedPostView | null, parent = false): HTMLElement {
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
  // Tapping anywhere else on the card opens the quoted post, through the router like any link.
  card.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest("a, button, video, .media-grid")) return;
    timeLink.click();
  });
  return card;
}
