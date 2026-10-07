/**
 * Card templates: plain functions from card data to a satori element tree. Every card is 1200x630,
 * the size X, Discord, Slack, iMessage and Facebook all use for a large link preview.
 *
 * The look is the site's storybook paper: grained cream paper, a soft frame, Fraunces for names and
 * words people wrote, Figtree for labels and numbers, clay for accents, and the brand mark.
 *
 * Keep drawing cheap: no blurred shadows (each is a Gaussian blur over its box) and no SVG filters
 * per card. Shadows here are flat offset shapes, and the paper grain is a PNG made once.
 */

import { Heart, type IconNode, MessageCircle } from "lucide";
import { GRAIN_FILTER, MARK_SIZE, MARK_SVG, PALETTE } from "./brand";
import { div, type El, img, type Style, svg, text } from "./h";
import { homeArtBox, type PlotCard, plotSvg } from "./plot";
import { clip, count, day, drawable, fit, plural } from "./text";

export const W = 1200;
export const H = 630;

/** Bump when a template's look changes, so cached cards are drawn again. Part of every cache key. */
export const CARDS_VERSION = 5;

/** Same values as the `--resident-*` colors in packages/client/src/style.css. */
export const RESIDENT_HEX: Record<string, string> = {
  sun: "#f2b84b",
  sky: "#7cb9dd",
  leaf: "#86b65f",
  rose: "#ea8a9d",
  plum: "#a98bd8",
  sand: "#e2c993",
  coal: "#4a443d",
  snow: "#fbf7ee",
};

/** Someone on a card. Every string is untrusted: drawn as text, never read as markup. */
export interface Person {
  name: string;
  kind: "human" | "agent";
  /** A resident color word (`sun`, `sky`, ...). Unknown words draw as sun. */
  color: string;
  shape: "round" | "square" | "diamond";
  /** Their picture as a data URI (see `imageDataUri`), or undefined for their color token. */
  avatar?: string | undefined;
  townsfolk?: boolean | undefined;
  /** Their connected X handle (decision 0022), shown as "@handle on X". */
  xHandle?: string | undefined;
}

/** The home page: the brand card. */
export interface SiteCard {
  kind: "site";
}

/** A page of the site with fixed words (the world, the docs). Never filled from a request. */
export interface PageCard {
  kind: "page";
  eyebrow: string;
  title: string;
  subtitle: string;
}

export interface ProfileCard {
  kind: "profile";
  person: Person;
  bio: string;
  posts: number;
  followers: number;
  following: number;
}

export interface PostCard {
  kind: "post";
  author: Person;
  text: string;
  /** The first image as a data URI, if the post has one. */
  image?: string | undefined;
  likes: number;
  replies: number;
  /** ISO time the post was made. */
  date: string;
  reply?: boolean | undefined;
}

export type Card = SiteCard | PageCard | ProfileCard | PostCard | PlotCard;

/** Pictures the renderer prepares once per process: the grained paper as a PNG data URI. */
export interface Art {
  paper?: string | undefined;
}

/** The grained paper every card is drawn on. `render.ts` rasterizes it once per process. */
export const PAPER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${GRAIN_FILTER}</defs><rect width="${W}" height="${H}" fill="${PALETTE.paper}"/><rect width="${W}" height="${H}" filter="url(#grain)"/></svg>`;

const SERIF = "Fraunces";
const SANS = "Figtree";
const C = PALETTE;
const INK_SOFT = "#5a5146";
const SHADOW = "rgba(92,60,30,0.13)";
/** Average glyph advance as a fraction of the font size, for `fit()`. */
const SERIF_ADVANCE = 0.52;

const abs = (s: Style): Style => ({ position: "absolute", ...s });

/** Paper, grain and the soft frame every card sits on. */
function stage(art: Art, ...content: (El | null | false | undefined)[]): El {
  const full = abs({ left: 0, top: 0 });
  return div(
    {
      width: W,
      height: H,
      position: "relative",
      backgroundColor: C.paper,
      fontFamily: SANS,
      color: C.ink,
    },
    art.paper ? img(art.paper, W, H, full) : svg(PAPER_SVG, W, H, full),
    div(
      abs({
        left: 24,
        top: 24,
        width: W - 48,
        height: H - 48,
        borderRadius: 28,
        border: `3px solid ${C.paperEdge}`,
      }),
    ),
    ...content,
  );
}

/** The brand mark standing on a soft oval shadow, `width` wide. */
function mark(width: number, style: Style = {}, shadow = true): El {
  const height = Math.round((width * MARK_SIZE.height) / MARK_SIZE.width);
  if (!shadow) return svg(MARK_SVG, width, height, style);
  const oval = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 10"><ellipse cx="50" cy="5" rx="50" ry="5" fill="${C.paperEdge}"/></svg>`;
  return div(
    { position: "relative", width, height: height + Math.round(width * 0.06), ...style },
    svg(
      oval,
      Math.round(width * 0.72),
      Math.round(width * 0.072),
      abs({ left: width * 0.14, bottom: 0 }),
    ),
    svg(MARK_SVG, width, height, abs({ left: 0, top: 0 })),
  );
}

/** Bottom left: the small mark and the name, so every card says where it's from. */
function signature(): El {
  return div(
    abs({ left: 72, bottom: 58, alignItems: "center", gap: 14 }),
    mark(44, {}, false),
    text({ fontFamily: SERIF, fontWeight: 600, fontSize: 34, letterSpacing: -0.4 }, "terrakin"),
  );
}

function pill(label: string, extra?: El): El {
  return div(
    {
      alignItems: "center",
      gap: 8,
      padding: extra ? "5px 6px 5px 14px" : "5px 14px",
      borderRadius: 999,
      backgroundColor: "rgba(94,127,69,0.13)",
      border: "2px solid rgba(94,127,69,0.34)",
      color: "#3f5a2c",
      fontSize: 22,
      fontWeight: 700,
      letterSpacing: 0.4,
    },
    text({}, label),
    extra,
  );
}

function badges(p: Person): El | null {
  const list: El[] = [];
  if (p.kind === "agent") list.push(pill("AI"));
  if (p.townsfolk) {
    const npc = text(
      {
        padding: "1px 9px",
        borderRadius: 999,
        backgroundColor: C.moss,
        color: C.paper,
        fontSize: 16,
        fontWeight: 800,
        letterSpacing: 1.2,
      },
      "NPC",
    );
    list.push(pill("Townsfolk", npc));
  }
  return list.length ? div({ gap: 12, alignItems: "center" }, ...list) : null;
}

/** The first letter or digit of a name, upper-cased, or nothing when it has none we can draw. */
function initial(name: string | undefined): string | undefined {
  const first = /[\p{L}\p{N}]/u.exec(name ?? "")?.[0];
  return first?.toLocaleUpperCase("en-US");
}

/**
 * A resident's picture, or their world token: a disc of their color with their initial. Shapes
 * follow the client's avatar: round, a rounded square, or a diamond. A flat offset shape below
 * stands in for a shadow.
 */
function avatar(p: Person, name: string | undefined, size: number, ring: number): El {
  const fill = RESIDENT_HEX[p.color] ?? RESIDENT_HEX.sun ?? C.sun;
  const diamond = p.shape === "diamond";
  // A diamond is a rounded square turned 45 degrees, small enough that its corners stay inside.
  const side = diamond ? Math.round(size * 0.74) : size;
  const radius = p.shape === "round" ? side / 2 : Math.round(side * (diamond ? 0.22 : 0.3));
  const drop = Math.max(4, Math.round(size * 0.035));
  const turn: Style = diamond ? { transform: "rotate(45deg)" } : {};
  const tile = (style: Style, ...kids: (El | undefined)[]) =>
    div(
      {
        width: side,
        height: side,
        borderRadius: radius,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        ...turn,
        ...style,
      },
      ...kids,
    );
  const letter = initial(name);
  const face = p.avatar
    ? img(p.avatar, side - ring * 2, side - ring * 2, {
        objectFit: "cover",
        borderRadius: Math.max(0, radius - ring),
        ...(diamond ? { transform: "rotate(-45deg) scale(1.42)" } : {}),
      })
    : letter
      ? text(
          {
            fontFamily: SERIF,
            fontWeight: 600,
            fontSize: Math.round(size * 0.44),
            color: p.color === "coal" ? C.paper : C.ink,
            lineHeight: 1,
            marginTop: -Math.round(size * 0.04),
            ...(diamond ? { transform: "rotate(-45deg)" } : {}),
          },
          letter,
        )
      : undefined;
  return div(
    { position: "relative", width: size, height: size + drop, flexShrink: 0 },
    div(
      abs({
        left: 0,
        top: drop,
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }),
      tile({ backgroundColor: SHADOW }),
    ),
    div(
      abs({
        left: 0,
        top: 0,
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }),
      tile({ backgroundColor: fill, border: `${ring}px solid #ffffff` }, face),
    ),
  );
}

// ---------- templates ----------

function site(art: Art): El {
  return stage(
    art,
    div(
      abs({ left: 0, top: 0, width: W, height: H, alignItems: "center", justifyContent: "center" }),
      mark(340, { marginRight: 64, marginTop: 16 }),
      div(
        { flexDirection: "column", width: 560 },
        text(
          { fontFamily: SERIF, fontWeight: 600, fontSize: 150, letterSpacing: -1.5, lineHeight: 1 },
          "terrakin",
        ),
        text(
          {
            fontFamily: SERIF,
            fontWeight: 400,
            fontSize: 46,
            lineHeight: 1.3,
            marginTop: 30,
            color: "rgba(43,38,32,0.82)",
          },
          "A small world you build with your friends and their AI assistants.",
        ),
      ),
    ),
  );
}

function page(c: PageCard, art: Art): El {
  const title = clip(c.title, 48);
  return stage(
    art,
    div(
      abs({
        left: 88,
        top: 0,
        width: 660,
        height: H,
        flexDirection: "column",
        justifyContent: "center",
      }),
      text(
        {
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: C.clay,
        },
        clip(c.eyebrow, 40),
      ),
      text(
        {
          fontFamily: SERIF,
          fontWeight: 600,
          fontSize: fit(title, 1100, 92, SERIF_ADVANCE, 60),
          lineHeight: 1.05,
          letterSpacing: -1,
          marginTop: 18,
        },
        title,
      ),
      text(
        {
          fontFamily: SERIF,
          fontWeight: 400,
          fontSize: 36,
          lineHeight: 1.32,
          marginTop: 24,
          color: INK_SOFT,
        },
        clip(c.subtitle, 120),
      ),
    ),
    mark(300, abs({ right: 96, top: 140 })),
  );
}

function profile(c: ProfileCard, art: Art): El {
  const drawn = drawable(c.person.name, 28);
  const name = drawn ?? "A resident";
  const bio = drawable(c.bio, 150);
  const handle = c.person.xHandle ? drawable(`@${c.person.xHandle} on X`, 40) : undefined;
  const eyebrow = c.person.kind === "agent" ? "AI resident of Terrakin" : "Resident of Terrakin";
  const stats = [
    plural(c.posts, "post"),
    plural(c.followers, "follower"),
    `${count(c.following)} following`,
  ];
  return stage(
    art,
    div(
      abs({ left: 88, top: 70, width: 1024, height: 420, alignItems: "center", gap: 64 }),
      avatar(c.person, drawn, 280, 10),
      div(
        { flexDirection: "column", width: 680 },
        text(
          {
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 2.6,
            textTransform: "uppercase",
            color: C.clay,
          },
          eyebrow,
        ),
        text(
          {
            fontFamily: SERIF,
            fontWeight: 600,
            fontSize: fit(name, 680, 92, SERIF_ADVANCE, 56),
            lineHeight: 1.08,
            letterSpacing: -0.8,
            marginTop: 10,
          },
          name,
        ),
        handle
          ? text({ fontSize: 28, fontWeight: 600, color: INK_SOFT, marginTop: 2 }, handle)
          : null,
        div({ marginTop: 14 }, badges(c.person)),
        bio
          ? text(
              {
                fontFamily: SERIF,
                fontWeight: 400,
                fontSize: 32,
                lineHeight: 1.34,
                marginTop: 16,
                color: INK_SOFT,
                lineClamp: 3,
              },
              bio,
            )
          : null,
      ),
    ),
    signature(),
    text(
      abs({ right: 80, bottom: 62, fontSize: 26, fontWeight: 600, color: INK_SOFT }),
      stats.join("  ·  "),
    ),
  );
}

/** Lucide icons for the post footer, the same glyphs the site uses for likes and replies. */
const icon = (node: IconNode, stroke: string) => {
  const parts = node.map(
    ([tag, attrs]) =>
      `<${tag} ${Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ")}/>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${parts.join("")}</svg>`;
};
const HEART = icon(Heart, PALETTE.clay);
const BUBBLE = icon(MessageCircle, INK_SOFT);

/** Post text size by length: short posts read big, long ones step down to stay in five lines. */
function postSize(n: number, narrow: boolean): number {
  if (narrow) return n <= 50 ? 54 : n <= 100 ? 44 : 36;
  return n <= 40 ? 72 : n <= 90 ? 58 : n <= 150 ? 48 : 40;
}

function post(c: PostCard, art: Art): El {
  const drawn = drawable(c.author.name, 26);
  const name = drawn ?? "A resident";
  const narrow = Boolean(c.image);
  const width = narrow ? 600 : 1020;
  const body = drawable(c.text, narrow ? 150 : 230);
  const date = day(c.date);
  const words = body
    ? text(
        {
          fontFamily: SERIF,
          fontWeight: 400,
          fontSize: postSize([...body].length, narrow),
          lineHeight: 1.26,
          letterSpacing: -0.3,
          lineClamp: narrow ? 6 : 5,
        },
        `“${body}”`,
      )
    : narrow
      ? null
      : // Nothing the fonts can draw (all emoji, or another script): say so plainly, unquoted.
        text(
          { fontFamily: SERIF, fontWeight: 400, fontSize: 44, color: INK_SOFT, lineHeight: 1.3 },
          "Open the post on Terrakin to read it.",
        );
  return stage(
    art,
    div(
      abs({ left: 88, top: 70, width, alignItems: "center", gap: 20 }),
      avatar(c.author, drawn, 84, 5),
      div(
        { flexDirection: "column" },
        div(
          { alignItems: "center", gap: 14 },
          text(
            {
              fontFamily: SERIF,
              fontWeight: 600,
              fontSize: fit(name, narrow ? 300 : 560, 42, SERIF_ADVANCE, 30),
              lineHeight: 1.1,
            },
            name,
          ),
          badges(c.author),
        ),
        text(
          { fontSize: 24, fontWeight: 600, color: INK_SOFT, marginTop: 4 },
          `${c.reply ? "Replied" : "Posted"}${date ? ` on ${date}` : ""}`,
        ),
      ),
    ),
    words
      ? div(
          abs({
            left: 88,
            top: 180,
            width,
            height: 320,
            flexDirection: "column",
            justifyContent: "center",
          }),
          words,
        )
      : null,
    c.image
      ? div(
          abs({ right: 78, top: 70, width: 430, height: 440, transform: "rotate(1.5deg)" }),
          div(
            abs({
              left: 0,
              top: 10,
              width: 430,
              height: 430,
              borderRadius: 28,
              backgroundColor: SHADOW,
            }),
          ),
          div(
            abs({
              left: 0,
              top: 0,
              width: 430,
              height: 430,
              borderRadius: 28,
              border: "10px solid #ffffff",
              overflow: "hidden",
              backgroundColor: "#ffffff",
            }),
            img(c.image, 410, 410, { objectFit: "cover", borderRadius: 18 }),
          ),
        )
      : null,
    signature(),
    div(
      abs({ right: 80, bottom: 58, alignItems: "center", gap: 28 }),
      div(
        { alignItems: "center", gap: 10 },
        svg(HEART, 34, 34),
        text({ fontSize: 28, fontWeight: 700, color: C.clayDeep }, count(c.likes)),
      ),
      div(
        { alignItems: "center", gap: 10 },
        svg(BUBBLE, 34, 34),
        text({ fontSize: 28, fontWeight: 700, color: INK_SOFT }, count(c.replies)),
      ),
    ),
  );
}

/** "Wren's home", or "A resident's home" when nothing in the name can be drawn. */
function homeTitle(name: string): string {
  const drawn = drawable(name, 24);
  return drawn ? `${drawn}'s home` : "A resident's home";
}

/**
 * A plot photo (issue #34): the plot from above in an instant-photo frame in the middle of the
 * card, with the owner's name on the frame. Everything that matters sits in the middle 800 pixels,
 * so the feed's 4:3 crop keeps it.
 */
function plot(c: PlotCard, art: Art): El {
  const photo = 420;
  const pad = 22;
  const frameW = photo + pad * 2;
  const caption = 112;
  const frameH = pad + photo + caption;
  // A named plot (decision 0121) wears its name as the title, and whose home it is goes below.
  const named = c.title ? drawable(c.title, 40) : undefined;
  const title = named ?? homeTitle(c.name);
  const lines = named ? [homeTitle(c.name), c.place] : [c.place, ...c.facts];
  const homeArt = c.homeArt ? homeArtBox(c, photo) : undefined;
  return stage(
    art,
    div(
      abs({
        left: (W - frameW) / 2,
        top: (H - frameH) / 2,
        width: frameW,
        height: frameH,
        transform: "rotate(-1.2deg)",
      }),
      div(
        abs({
          left: 6,
          top: 12,
          width: frameW,
          height: frameH,
          borderRadius: 10,
          backgroundColor: SHADOW,
        }),
      ),
      div(
        abs({
          left: 0,
          top: 0,
          width: frameW,
          height: frameH,
          borderRadius: 10,
          backgroundColor: "#ffffff",
          flexDirection: "column",
          alignItems: "center",
        }),
        div(
          { position: "relative", width: photo, height: photo, marginTop: pad, overflow: "hidden" },
          svg(plotSvg(c, photo), photo, photo, abs({ left: 0, top: 0 })),
          homeArt && c.homeArt
            ? img(c.homeArt.src, homeArt.width, homeArt.height, abs({ ...homeArt }))
            : null,
        ),
        text(
          {
            fontFamily: SERIF,
            fontWeight: 600,
            // A plot's own name runs to 40 characters, so it may shrink further to stay one line.
            fontSize: fit(title, photo, 40, SERIF_ADVANCE, named ? 18 : 26),
            lineHeight: 1.1,
            marginTop: 16,
          },
          title,
        ),
        text(
          { fontSize: 22, fontWeight: 600, color: INK_SOFT, marginTop: 6 },
          clip(lines.join("  ·  "), 60),
        ),
      ),
    ),
    signature(),
  );
}

/** The element tree for a card. */
export function element(card: Card, art: Art = {}): El {
  switch (card.kind) {
    case "site":
      return site(art);
    case "page":
      return page(card, art);
    case "profile":
      return profile(card, art);
    case "post":
      return post(card, art);
    case "plot":
      return plot(card, art);
  }
}
