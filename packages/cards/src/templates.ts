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
import { type LookCard, lookSvg, type NearCard, nearSvg } from "./pictures";
import { homeArtBox, type PlotCard, plotSvg } from "./plot";
import { nightWash } from "./sky";
import { clip, count, day, drawable, fit, plural } from "./text";

export const W = 1200;
export const H = 630;

/**
 * A posted plot photo is its own picture, not a link card: the instant photo fills a 4:5 sheet with
 * a thin clear margin for its tilt and shadow, so a chat or a feed shows it with no bands at its sides. It is laid out at
 * this size and drawn at `scale`, so the picture is 1080x1350.
 */
export const POSTED = { width: 540, height: 675, scale: 2 } as const;

/** A card's size as laid out, and how many times over it is drawn. Link cards are 1200x630. */
export function cardSize(card: Card): { width: number; height: number; scale: number } {
  return card.kind === "plot" && card.posted === true ? POSTED : { width: W, height: H, scale: 1 };
}

/** Bump when a template's look changes, so cached cards are drawn again. Part of every cache key. */
export const CARDS_VERSION = 16;

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
  /** That image's width over its height, when known. A tall one is shown whole, not cropped. */
  imageAspect?: number | undefined;
  /**
   * The image is a posted plot photo, which carries its own frame on its own paper: it is drawn bare
   * at the card's height, with no second border round it.
   */
  imageFramed?: boolean | undefined;
  likes: number;
  replies: number;
  /** ISO time the post was made. */
  date: string;
  reply?: boolean | undefined;
}

export type Card = SiteCard | PageCard | ProfileCard | PostCard | PlotCard | NearCard | LookCard;

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
/** The same for the semibold sans of a caption, with room for its dots. */
const SANS_ADVANCE = 0.44;

const abs = (s: Style): Style => ({ position: "absolute", ...s });

type Content = (El | null | false | undefined)[];

/** Paper and grain, edge to edge. */
function sheet(art: Art, ...content: Content): El {
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
    ...content,
  );
}

/**
 * A clear sheet for a picture of its own size: whatever shows it (a post's card, the app, a chat)
 * is the paper, so its margin never sits on it as a second, slightly different paper.
 */
function clear(size: { width: number; height: number }, ...content: Content): El {
  return div(
    {
      width: size.width,
      height: size.height,
      position: "relative",
      fontFamily: SANS,
      color: C.ink,
    },
    ...content,
  );
}

/** Paper, grain and the soft frame every card sits on. */
function stage(art: Art, ...content: Content): El {
  return sheet(
    art,
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

/** The same, small, at the foot of a photo's frame: it stays whole however the picture is cropped. */
function frameSignature(): El {
  return div(
    abs({ left: 0, right: 0, bottom: 12, justifyContent: "center", alignItems: "center", gap: 7 }),
    mark(22, {}, false),
    text({ fontFamily: SERIF, fontWeight: 600, fontSize: 18, letterSpacing: -0.2 }, "terrakin"),
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
  // A tall picture (a posted plot photo) is shown whole at its own shape; a wide one is cropped square.
  const tall = c.imageAspect !== undefined && c.imageAspect < 1 ? c.imageAspect : 1;
  const across = Math.round(410 * Math.max(tall, 0.6)) + 20;
  // A plot photo stands on the card's paper as it is, inside the card's soft frame.
  const bareHeight = H - 72;
  const bare = c.image && c.imageFramed && tall < 1 ? Math.round(bareHeight * tall) : 0;
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
    bare && c.image
      ? img(c.image, bare, bareHeight, abs({ right: 40, top: 36 }))
      : c.image
        ? div(
            abs({ right: 78, top: 70, width: across, height: 440, transform: "rotate(1.5deg)" }),
            div(
              abs({
                left: 0,
                top: 10,
                width: across,
                height: 430,
                borderRadius: 28,
                backgroundColor: SHADOW,
              }),
            ),
            div(
              abs({
                left: 0,
                top: 0,
                width: across,
                height: 430,
                borderRadius: 28,
                border: "10px solid #ffffff",
                overflow: "hidden",
                backgroundColor: "#ffffff",
              }),
              img(c.image, across - 20, 410, { objectFit: "cover", borderRadius: 18 }),
            ),
          )
        : null,
    signature(),
    div(
      abs({ right: bare ? 40 + bare + 16 : 80, bottom: 58, alignItems: "center", gap: 28 }),
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
 * The photo's frame: the plot, the owner's home picture over the hearth, and a white border with a
 * deeper lip at its foot, tilted on its soft shadow. `lip` is the room under the picture, for a
 * caption or the brand.
 */
function photoFrame(
  c: PlotCard,
  photo: number,
  pad: number,
  lip: number,
  turn: number,
  place: Style,
  ...caption: Content
): El {
  const frameW = photo + pad * 2;
  const frameH = pad + photo + lip;
  const homeArt = c.homeArt ? homeArtBox(c, photo) : undefined;
  const wash = nightWash(c.sky);
  return div(
    abs({ width: frameW, height: frameH, transform: `rotate(${turn}deg)`, ...place }),
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
        // The drawing darkens from inside (`skyParts`); the home picture is laid over it here, so
        // the same night falls on it as a flat wash.
        homeArt && wash ? div(abs({ ...homeArt, backgroundColor: wash })) : null,
      ),
      ...caption,
    ),
  );
}

/** How far apart a stamp's capitals stand, and the average advance of one at its own size. */
const STAMP_TRACKING = 1.4;
const STAMP_ADVANCE = 0.57;

/**
 * The stamp under a photo: the day, the season and the sky it was taken in, in our own words, set
 * small and wide the way a photo lab prints a date. Nothing here is a resident's text.
 *
 * It has to stay one line: on a posted photo a second line would land on the brand under it. The
 * tracking is a flat cost per character, so it comes out of the width before `fit` divides the
 * rest, and the advance is a capital's, not the mixed-case `SANS_ADVANCE`.
 */
function stamp(words: string[], width: number, align: "center" | "flex-start"): El | null {
  const line = clip(words.join("  ·  "), 52);
  if (!line) return null;
  const room = width - STAMP_TRACKING * [...line].length;
  return div(
    { flexDirection: "column", alignItems: align, width, gap: 7, marginTop: 12 },
    div({ width: align === "center" ? 54 : 44, height: 2, backgroundColor: "#dcc8a4" }),
    text(
      {
        fontSize: fit(line, room, 19, STAMP_ADVANCE, 12),
        fontWeight: 700,
        letterSpacing: STAMP_TRACKING,
        color: "#8a7f70",
        textTransform: "uppercase",
      },
      line,
    ),
  );
}

/**
 * A plot photo (issue #34). A photo taken to post (`posted`) is a tall instant photo filling a 4:5
 * sheet of its own (`POSTED`), with its caption, stamp and brand on the frame. The card for a link
 * has the photo on the left and its caption beside it, so the picture is as big as the card is tall
 * and no band of empty paper is left over (issue #80).
 */
function plot(c: PlotCard, art: Art): El {
  const named = c.title ? drawable(c.title, 40) : undefined;
  const title = named ?? homeTitle(c.name);
  const facts = clip([c.place, ...c.facts].join("  ·  "), 60);
  const marks = c.stamp ?? [];
  const told = c.story ? clip(c.story, 58) : "";
  if (c.posted === true) {
    // The frame fills the sheet but for a margin that keeps its tilt and shadow on the paper. A
    // story line needs its own room under the caption, so the photo gives up what the lip takes.
    const margin = 22;
    const pad = 20;
    const lip = told ? 194 : 170;
    const photo = POSTED.height - margin * 2 - pad - lip;
    const caption = clip(named ? [homeTitle(c.name), c.place].join("  ·  ") : facts, 60);
    return clear(
      POSTED,
      photoFrame(
        c,
        photo,
        pad,
        lip,
        -1.2,
        { left: (POSTED.width - (photo + pad * 2)) / 2, top: margin },
        text(
          {
            fontFamily: SERIF,
            fontWeight: 600,
            // A plot's own name runs to 40 characters, so it may shrink further to stay one line.
            fontSize: fit(title, photo, 36, SERIF_ADVANCE, named ? 18 : 26),
            lineHeight: 1.1,
            marginTop: 13,
          },
          title,
        ),
        text(
          {
            // A longer line of facts ("2 floors") shrinks to stay one line in the frame.
            fontSize: fit(caption, photo + pad, 20, SANS_ADVANCE, 16),
            fontWeight: 600,
            color: INK_SOFT,
            marginTop: 5,
          },
          caption,
        ),
        // What is new since the last photo, so photos of one home read as a progression.
        told
          ? text(
              {
                fontSize: fit(told, photo + pad, 18, SANS_ADVANCE, 14),
                fontWeight: 600,
                color: C.clayDeep,
                marginTop: 4,
              },
              told,
            )
          : null,
        marks.length ? stamp(marks, photo, "center") : null,
        frameSignature(),
      ),
    );
  }
  const line = clip(c.facts.join("  ·  "), 46);
  const photo = 452;
  const pad = 18;
  const column = 452;
  const left = 66;
  const beside = left + photo + pad * 2 + 66;
  return stage(
    art,
    photoFrame(c, photo, pad, 46, -1.4, { left, top: (H - (pad + photo + 46)) / 2 }),
    div(
      abs({
        left: beside,
        top: 80,
        bottom: 150,
        width: column,
        flexDirection: "column",
        justifyContent: "center",
      }),
      text(
        { fontSize: 20, fontWeight: 800, letterSpacing: 2.2, color: C.clayDeep },
        clip(c.place.toUpperCase(), 28),
      ),
      text(
        {
          fontFamily: SERIF,
          fontWeight: 600,
          fontSize: fit(title, column, 58, SERIF_ADVANCE, 30),
          lineHeight: 1.08,
          letterSpacing: -0.6,
          marginTop: 12,
        },
        title,
      ),
      named
        ? text(
            { fontSize: 26, fontWeight: 600, color: INK_SOFT, marginTop: 12 },
            clip(homeTitle(c.name), 40),
          )
        : null,
      text(
        {
          fontSize: fit(line, column, 23, SANS_ADVANCE, 17),
          fontWeight: 600,
          color: "#7b7265",
          marginTop: named ? 8 : 12,
        },
        line,
      ),
      marks.length ? stamp(marks, column, "flex-start") : null,
    ),
    div(
      abs({ left: beside, bottom: 76, alignItems: "center", gap: 12 }),
      mark(38, {}, false),
      text({ fontFamily: SERIF, fontWeight: 600, fontSize: 30, letterSpacing: -0.4 }, "terrakin"),
    ),
  );
}

/**
 * Where a resident is right now (decision 0160): the map around them in a wide photo, with their
 * name and the time and sky under it.
 */
function near(c: NearCard, art: Art): El {
  const photoW = 1040;
  const photoH = 430;
  const pad = 16;
  const frameW = photoW + pad * 2;
  const caption = 88;
  const frameH = pad + photoH + caption;
  const drawn = drawable(c.name, 28);
  const title = drawn ? `${drawn} is here` : "A resident is here";
  return stage(
    art,
    div(
      abs({
        left: (W - frameW) / 2,
        top: 38,
        width: frameW,
        height: frameH,
      }),
      div(
        abs({
          left: 5,
          top: 9,
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
          {
            position: "relative",
            width: photoW,
            height: photoH,
            marginTop: pad,
            overflow: "hidden",
          },
          svg(nearSvg(c, photoW, photoH), photoW, photoH, abs({ left: 0, top: 0 })),
        ),
        div(
          { width: photoW, alignItems: "baseline", justifyContent: "space-between", marginTop: 14 },
          text(
            {
              fontFamily: SERIF,
              fontWeight: 600,
              fontSize: fit(title, 560, 40, SERIF_ADVANCE, 26),
              lineHeight: 1.1,
            },
            title,
          ),
          text(
            { fontSize: 22, fontWeight: 600, color: INK_SOFT },
            clip([c.place, ...c.facts].join("  ·  "), 64),
          ),
        ),
      ),
    ),
  );
}

/** A resident in their look (decision 0160): the figure large on the right, their name and look in words. */
function look(c: LookCard, art: Art): El {
  const drawn = drawable(c.name, 28);
  const name = drawn ?? "A resident";
  const eyebrow = c.agent ? "AI resident of Terrakin" : "Resident of Terrakin";
  const person: Person = {
    name,
    kind: c.agent ? "agent" : "human",
    color: "sun",
    shape: "round",
    townsfolk: c.townsfolk === true,
  };
  const pictureW = 500;
  const pictureH = 470;
  return stage(
    art,
    div(
      abs({
        left: 88,
        top: 0,
        width: 560,
        height: H,
        flexDirection: "column",
        justifyContent: "center",
      }),
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
          fontSize: fit(name, 560, 84, SERIF_ADVANCE, 52),
          lineHeight: 1.08,
          letterSpacing: -0.8,
          marginTop: 10,
        },
        name,
      ),
      div({ marginTop: 14 }, badges(person)),
      ...c.facts
        .slice(0, 4)
        .map((line) =>
          text(
            { fontFamily: SERIF, fontSize: 30, lineHeight: 1.3, marginTop: 12, color: INK_SOFT },
            clip(line, 40),
          ),
        ),
    ),
    div(
      abs({
        right: 70,
        top: (H - pictureH) / 2 - 10,
        width: pictureW,
        height: pictureH,
        borderRadius: 28,
        backgroundColor: "rgba(255,255,255,0.55)",
        border: `3px solid ${C.paperEdge}`,
        alignItems: "center",
        justifyContent: "center",
      }),
      svg(lookSvg(c, pictureW - 40, pictureH - 40), pictureW - 40, pictureH - 40),
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
    case "near":
      return near(card, art);
    case "look":
      return look(card, art);
  }
}
