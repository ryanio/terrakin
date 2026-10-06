/**
 * The cards that make the home wall feel lived in: the town's numbers, who's around, the sky over
 * the world, the Town Hall, recent pictures, and the two rollups (one resident's run of posts, and
 * the townsfolk's notes). Every number comes from the server; names and words go in as text.
 */
import type { PostView, TownResponse, WorldSnapshot } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { compactCount, plural } from "@terrakin/ui/format";
import { countTo, replay } from "@terrakin/ui/motion";
import { profilePath } from "@terrakin/ui/paths";
import {
  avatarEl,
  avatarPlaceholder,
  type Person,
  residentPerson,
  TEAM_RUN,
  TOWNSFOLK_ABOUT,
  townsfolkBadge,
} from "@terrakin/ui/people";
import { everyVisible } from "@terrakin/ui/poll";
import { timeAgo } from "@terrakin/ui/when";
import { type PulseStats, phaseName, type WallItem } from "./pulse";
import { dayPhase, nightAmount } from "./time";
import { closesIn, tallyBar } from "./town-format";

type Resident = WorldSnapshot["residents"][number];
type CardFn = (post: PostView, variant?: "compact") => HTMLElement;

/** Show `to` in `el`, counting from what's there, with a flash when it changes. */
function countStat(el: HTMLElement, to: number) {
  if (countTo(el, to)) replay(el, "bump");
}

/** A home wall card: hidden until it has something to show. */
export function pulseShell(cls: string, label: string, ...children: (Node | null)[]): HTMLElement {
  return h(
    "article",
    { class: `pulse paper card ${cls}`, attrs: { "aria-label": label, hidden: true } },
    ...children,
  );
}

// ---------- the town's numbers ----------

export function statsCard() {
  const num = (label: string) => {
    const n = h("span", { class: "stat-n", text: "0" });
    return {
      n,
      el: h("div", { class: "stat" }, n, h("span", { class: "stat-label", text: label })),
    };
  };
  const residents = num("residents");
  const online = num("online now");
  const homes = num("homes built");
  const blocks = num("blocks placed");
  const bars = h("div", { class: "spark-bars", attrs: { "aria-hidden": "true" } });
  const barsLabel = h("p", { class: "spark-label" });
  const fill = h("p", { class: "pulse-foot", attrs: { hidden: true } });
  const el = pulseShell(
    "pulse-stats",
    "Terrakin right now",
    h(
      "p",
      { class: "eyebrow pulse-eyebrow" },
      h("span", { class: "live-dot", attrs: { "aria-hidden": "true" } }),
      "Right now",
    ),
    h("h2", { class: "pulse-title", text: "The town's pulse" }),
    h("div", { class: "stat-grid" }, residents.el, online.el, homes.el, blocks.el),
    h("div", { class: "spark" }, bars, barsLabel),
    fill,
  );
  return {
    el,
    update(stats: PulseStats, hourly: (number | null)[], partial: boolean) {
      el.hidden = false;
      countStat(residents.n, stats.residents);
      countStat(online.n, stats.online);
      countStat(homes.n, stats.homes);
      countStat(blocks.n, stats.blocks);
      const top = Math.max(1, ...hourly.map((c) => c ?? 0));
      bars.replaceChildren(
        ...hourly.map((c) => {
          const b = h("span", { class: c === null ? "bar unknown" : "bar" });
          b.style.setProperty("--h", c === null ? "0.08" : String(Math.max(0.08, c / top)));
          return b;
        }),
      );
      const total = hourly.reduce<number>((a, b) => a + (b ?? 0), 0);
      // With more pages unread, what we counted is a floor.
      barsLabel.textContent = `${compactCount(total)}${partial ? "+" : ""} ${
        total === 1 && !partial ? "post" : "posts"
      } in the last ${hourly.length} hours`;
      // Say so plainly while townsfolk are doing a lot of the talking.
      fill.hidden = !(stats.townsfolk > 0 && stats.online < 6);
      fill.textContent = `Plus ${stats.townsfolk} townsfolk, run by the Terrakin team, who keep the place warm until more neighbors arrive.`;
    },
  };
}

// ---------- live activity ----------

/** A placeholder avatar with an icon inside, for entries about the town itself. */
const withIcon = (el: HTMLElement, mark: SVGSVGElement) => {
  el.append(mark);
  return el;
};

export interface ActivityEntry {
  /** Stable, so the same event never shows twice. */
  key: string;
  /** Who it's about. Left out for the town itself (the treasury), which shows a coin. */
  who?: Person;
  /** Shown in gradient, usually the name. */
  lead: string;
  rest: string;
  href: string;
  at: string;
  tone: "join" | "home" | "town" | "coins";
}

const ACTIVITY_MAX = 8;

/** A running timeline of what just happened in town, newest on top. */
export function activityCard() {
  const list = h("ol", { class: "activity-list" });
  const seen = new Set<string>();
  const el = pulseShell(
    "pulse-activity",
    "Live activity",
    h(
      "p",
      { class: "eyebrow pulse-eyebrow" },
      h("span", { class: "live-dot", attrs: { "aria-hidden": "true" } }),
      "Live",
    ),
    h("h2", { class: "pulse-title", text: "Happening now" }),
    list,
  );
  const row = (e: ActivityEntry, fresh: boolean) =>
    h(
      "li",
      { class: `activity-row tone-${e.tone}${fresh ? " arrive" : ""}` },
      h(
        "a",
        { class: "activity-link", attrs: { href: e.href } },
        e.who
          ? avatarEl(e.who, "sm")
          : withIcon(avatarPlaceholder("sm", "activity-coin"), icon("coin")),
        h(
          "span",
          { class: "activity-text" },
          h("span", { class: "activity-lead", text: e.lead }),
          ` ${e.rest}`,
        ),
        timeAgo(e.at, { className: "activity-time" }),
      ),
    );
  return {
    el,
    /** Add entries, newest first. `fresh` ones arrive with a glow. */
    add(entries: ActivityEntry[], fresh = false) {
      const added = entries.filter((e) => !seen.has(e.key));
      if (added.length === 0) return;
      for (const e of added) seen.add(e.key);
      if (fresh) list.prepend(...added.map((e) => row(e, true)));
      else list.append(...added.map((e) => row(e, false)));
      while (list.children.length > ACTIVITY_MAX) list.lastElementChild?.remove();
      el.hidden = false;
    },
  };
}

// ---------- who's around ----------

export function aroundCard() {
  const faces = h("ul", { class: "around-faces" });
  const more = h("p", { class: "pulse-foot" });
  const el = pulseShell(
    "pulse-around",
    "Around now",
    h(
      "p",
      { class: "eyebrow pulse-eyebrow" },
      h("span", { class: "live-dot", attrs: { "aria-hidden": "true" } }),
      "Around now",
    ),
    h("h2", { class: "pulse-title", text: "Out in the world" }),
    faces,
    more,
    h(
      "a",
      { class: "text-link", attrs: { href: "/world" } },
      h("span", { text: "Go say hi" }),
      icon("arrow"),
    ),
  );
  return {
    el,
    update(shown: Resident[], extra: number, townsfolk: ReadonlySet<string>) {
      el.hidden = shown.length === 0;
      faces.replaceChildren(
        ...shown.map((r, i) => {
          const face = h(
            "a",
            { class: "around-face", attrs: { href: profilePath(r.id) } },
            avatarEl(residentPerson(r), "md"),
            h("span", { class: "around-name", text: r.name }),
            townsfolk.has(r.id)
              ? h("span", { class: "around-npc", attrs: { title: TOWNSFOLK_ABOUT }, text: "NPC" })
              : null,
          );
          face.style.setProperty("--i", String(i));
          return h("li", {}, face);
        }),
      );
      more.hidden = extra <= 0;
      more.textContent = `and ${extra} more`;
    },
  };
}

// ---------- the sky over the world ----------

const DAY_TOP = [142, 201, 234];
const DAY_LOW = [253, 243, 220];
const NIGHT_TOP = [29, 33, 64];
const NIGHT_LOW = [70, 58, 107];
const GLOW = [242, 166, 90];

const mix = (a: number[], b: number[], k: number) => a.map((v, i) => v + ((b[i] ?? v) - v) * k);
const rgb = (c: number[]) => `rgb(${c.map(Math.round).join(" ")})`;

export function skyCard() {
  const orb = h("span", { class: "sky-orb", attrs: { "aria-hidden": "true" } });
  const name = h("h2", { class: "pulse-title sky-name" });
  const line = h("p", { class: "sky-line" });
  // The sun and moon arc across their own strip, so they never cross the words.
  const scene = h(
    "div",
    { class: "sky-scene", attrs: { "aria-hidden": "true" } },
    h("span", { class: "sky-stars" }),
    orb,
    h("span", { class: "sky-hill" }),
  );
  const el = pulseShell(
    "pulse-sky",
    "The sky over Terrakin",
    scene,
    h("p", { class: "eyebrow pulse-eyebrow sky-eyebrow", text: "In the world" }),
    name,
    line,
    h(
      "a",
      { class: "pill-button small sky-go", attrs: { href: "/world" } },
      h("span", { text: "Step outside" }),
    ),
  );
  let anchor: { serverMs: number; at: number; dayMs: number } | undefined;
  let online = 0;
  const paint = () => {
    if (!anchor) return;
    const phase = dayPhase(anchor.serverMs + (performance.now() - anchor.at), anchor.dayMs);
    const night = nightAmount(phase);
    const edge = Math.min(Math.abs(phase), Math.abs(1 - phase), Math.abs(phase - 0.5));
    const glow = Math.max(0, 1 - edge / 0.09);
    el.style.setProperty("--sky-top", rgb(mix(DAY_TOP, NIGHT_TOP, night)));
    el.style.setProperty("--sky-low", rgb(mix(mix(DAY_LOW, NIGHT_LOW, night), GLOW, glow * 0.7)));
    el.style.setProperty("--night", night.toFixed(3));
    const up = phase < 0.5;
    const x = (up ? phase : phase - 0.5) / 0.5;
    orb.classList.toggle("moon", !up);
    orb.style.left = `${10 + x * 80}%`;
    orb.style.bottom = `${18 + Math.sin(Math.PI * x) * 50}%`;
    el.classList.toggle("is-night", night > 0.55);
    name.textContent = `${phaseName(phase)} in Terrakin`;
    const minutes = Math.round(anchor.dayMs / 60_000);
    const length = minutes < 120 ? `${minutes} minutes` : `${Math.round(minutes / 30) / 2} hours`;
    line.textContent = `A whole day here takes ${length}. ${
      online === 0
        ? "Nobody is out right now."
        : `${plural(online, "resident is", "residents are")} out right now.`
    }`;
  };
  const stop = everyVisible(2_000, paint);
  return {
    el,
    update(snapshot: WorldSnapshot, onlineNow: number) {
      if (!snapshot.time) return;
      anchor = {
        serverMs: snapshot.time.nowMs,
        at: performance.now(),
        dayMs: snapshot.time.dayLengthMs,
      };
      online = onlineNow;
      el.hidden = false;
      paint();
    },
    destroy() {
      stop();
    },
  };
}

// ---------- Town Hall ----------

export function townCard() {
  const body = h("div", { class: "stack town-pulse-body" });
  const el = pulseShell(
    "pulse-town",
    "At the Town Hall",
    h("p", { class: "eyebrow pulse-eyebrow" }, icon("town", "icon pulse-icon"), "Town Hall"),
    body,
    h(
      "a",
      { class: "text-link", attrs: { href: "/town" } },
      h("span", { text: "Visit the Town Hall" }),
      icon("arrow"),
    ),
  );
  return {
    el,
    update(town: TownResponse) {
      const open = [...town.open].sort(
        (a, b) => Date.parse(a.closesAt ?? "") - Date.parse(b.closesAt ?? ""),
      )[0];
      const notice = town.board[0];
      el.hidden = !open && !notice;
      if (open) {
        const bar = tallyBar(open.tally);
        const seg = (cls: string, pct: number) => {
          const s = h("span", { class: `tally-${cls}` });
          s.style.width = `${pct}%`;
          return s;
        };
        body.replaceChildren(
          h("p", { class: "town-pulse-kicker", text: "Voting now" }),
          h("h2", { class: "pulse-title town-pulse-title", text: open.title }),
          h(
            "div",
            {
              class: "tally-bar",
              attrs: {
                role: "img",
                "aria-label": `${open.tally.yes} yes, ${open.tally.no} no, ${open.tally.abstain} abstain`,
              },
            },
            seg("yes", bar.yes),
            seg("no", bar.no),
            seg("abstain", bar.abstain),
          ),
          h("p", {
            class: "pulse-foot",
            text: `${bar.label}. ${open.closesAt ? closesIn(open.closesAt, Date.now()) : ""}`.trim(),
          }),
        );
      } else if (notice) {
        body.replaceChildren(
          h("p", { class: "town-pulse-kicker", text: "On the notice board" }),
          h("p", { class: "town-pulse-notice", text: notice.text }),
          h("p", { class: "pulse-foot", text: `Pinned by ${notice.author.name}` }),
        );
      }
    },
  };
}

// ---------- rollups ----------

/** How long a run of posts took, in plain words: "in an hour", "in 3 hours", "just now". */
function spanWords(posts: PostView[]): string {
  const times = posts.map((p) => Date.parse(p.createdAt));
  const ms = Math.max(...times) - Math.min(...times);
  const minutes = Math.round(ms / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `in ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "in an hour" : `in ${hours} hours`;
}

/** The first few rows, with a button for the rest. `add` puts more behind the button. */
function rows(posts: PostView[], card: CardFn, first: number) {
  const list = h(
    "div",
    { class: "roll-rows" },
    ...posts.slice(0, first).map((p) => card(p, "compact")),
  );
  const rest = posts.slice(first);
  const more = h("button", {
    class: "pill-button small roll-more",
    attrs: { type: "button" },
    on: {
      click: () => {
        list.append(...rest.splice(0).map((p) => card(p, "compact")));
        paint();
      },
    },
  });
  const paint = () => {
    more.hidden = rest.length === 0;
    more.textContent = `Show ${rest.length} more`;
  };
  paint();
  return {
    els: [list, more],
    /** Older posts, from a later page: behind the button. */
    add(posts: PostView[]) {
      rest.push(...posts);
      paint();
    },
    /** Newer posts, from a poll: on top, where they're seen. */
    prepend(posts: PostView[]) {
      list.prepend(...posts.map((p) => card(p, "compact")));
    },
  };
}

export function burstCard(item: Extract<WallItem, { kind: "burst" }>, card: CardFn): HTMLElement {
  const { author, posts } = item;
  const el = h(
    "section",
    {
      class: "roll burst paper card",
      attrs: { "aria-label": `${posts.length} posts by ${author.name}` },
    },
    h(
      "header",
      { class: "roll-head" },
      h(
        "a",
        { attrs: { href: profilePath(author.id), tabindex: -1, "aria-hidden": "true" } },
        avatarEl(author),
      ),
      h(
        "div",
        {},
        h(
          "p",
          { class: "roll-title" },
          h("span", { class: "roll-name", text: author.name }),
          " is on a roll",
        ),
        h("p", { class: "roll-sub", text: `${posts.length} posts ${spanWords(posts)}` }),
      ),
    ),
    ...rows(posts, card, 4).els,
  );
  el.style.setProperty("--avatar", `var(--resident-${author.color})`);
  return el;
}

/**
 * Townsfolk posts, folded into one quiet card. Later pages add to the same card (behind its
 * button) instead of making another.
 */
export function townsfolkCard(item: Extract<WallItem, { kind: "townsfolk" }>, card: CardFn) {
  const names = new Set(item.posts.map((p) => p.author.name));
  const sub = h("p", { class: "roll-sub" });
  const paintNames = () => {
    sub.textContent = `${[...names].slice(0, 4).join(", ")}. ${TEAM_RUN}.`;
  };
  paintNames();
  const list = rows(item.posts, card, 2);
  const el = h(
    "section",
    {
      class: "roll townsfolk-roll paper card",
      attrs: { "aria-label": "Notes from the townsfolk" },
    },
    h(
      "header",
      { class: "roll-head" },
      h("div", {}, h("p", { class: "roll-title", text: "Notes from the townsfolk" }), sub),
      townsfolkBadge(),
    ),
    ...list.els,
  );
  return {
    el,
    add(posts: PostView[]) {
      for (const p of posts) names.add(p.author.name);
      paintNames();
      list.add(posts);
    },
    prepend(posts: PostView[]) {
      for (const p of posts) names.add(p.author.name);
      paintNames();
      list.prepend(posts);
    },
  };
}
