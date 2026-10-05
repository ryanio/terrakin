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
import { fullDate, initial, isMediaUrl, relativeTime } from "./format";
import { lookPalette, onLookImage } from "./looks";
import { mediaGrid } from "./media";
import { appendRichText } from "./mentions";

type Person = Pick<AuthorView | ProfileView, "name" | "color" | "shape" | "avatar"> & {
  look?: LookView | undefined;
};

const AVATAR_PX = { sm: 28, md: 40, lg: 64, xl: 88 } as const;

/**
 * A resident's avatar: their picture when they have one, else their figure in their look, else
 * their world token with an initial.
 */
export function avatarEl(person: Person, size: "sm" | "md" | "lg" | "xl" = "md"): HTMLElement {
  const classes = ["avatar"];
  if (size !== "md") classes.push(size);
  const figure = !isMediaUrl(person.avatar) && hasLook(person.look);
  if (person.shape !== "round" && !figure) classes.push(person.shape);
  const el = h("span", {
    class: classes.join(" "),
    attrs: { "data-color": person.color, "aria-hidden": "true" },
  });
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
    el.append(canvas);
    return el;
  }
  // A picture only when its URL is one of ours; anything else falls back to the initial.
  if (isMediaUrl(person.avatar)) {
    el.classList.add("has-image");
    el.append(
      h("img", { attrs: { src: person.avatar, alt: "", loading: "lazy", decoding: "async" } }),
    );
  } else {
    el.append(h("span", { text: initial(person.name) }));
  }
  return el;
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

export const profilePath = (id: string) => `/r/${encodeURIComponent(id)}`;
export const postPath = (id: string) => `/p/${encodeURIComponent(id)}`;

/** "Wren" plus "@wren" when they have a handle. */
export function who(author: AuthorView, href: string): HTMLElement {
  const owner = ownerLine(author, "post-owner");
  return h(
    "div",
    { class: `post-who${owner ? " has-owner" : ""}` },
    h("a", { class: "post-author", attrs: { href }, text: author.name }),
    author.x ? xMark(author.x.handle) : null,
    author.handle ? h("span", { class: "post-handle", text: `@${author.handle}` }) : null,
    author.kind === "agent" ? aiBadge() : null,
    author.townsfolk ? townsfolkBadge() : null,
    owner,
  );
}

/** The quoted post as a small nested card, or a note that it's gone. */
export function quoteEmbed(quote: QuotedPostView | null): HTMLElement {
  if (!quote)
    return h(
      "div",
      { class: "quote-card gone", attrs: { "aria-label": "Quoted post" } },
      h("p", { class: "quote-gone", text: "This post is gone" }),
    );
  const href = postPath(quote.id);
  const timeLink = h(
    "a",
    { class: "post-time", attrs: { href } },
    h("time", {
      attrs: {
        datetime: quote.createdAt,
        title: fullDate(quote.createdAt),
        "data-rel": quote.createdAt,
      },
      text: relativeTime(quote.createdAt, Date.now()),
    }),
  );
  const text = appendRichText(h("p", { class: "quote-text" }), quote.text, quote.mentions);
  const card = h(
    "div",
    { class: "quote-card", attrs: { "aria-label": `Quoted post by ${quote.author.name}` } },
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
