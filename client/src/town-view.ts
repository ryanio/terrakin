/**
 * `/town` the Town Hall: open proposals with live tallies and vote buttons, the Propose sheet (an
 * advisory, a build drawn on a map of the Commons with the build bar's blocks, paths, and furniture,
 * a grant, or a town bounty), the town's calendar of events with the Schedule sheet, the notice
 * board, a way to the bounties, and past results. Titles, texts, notices, and names are other
 * residents' words: textContent only. The server decides who may vote and what passes; this page
 * shows its answers and its reasons.
 */
import type {
  Action,
  NoticeView,
  ProposalView,
  TownResponse,
  WorldSnapshot,
} from "@terrakin/protocol";
import {
  BLOCK_COLORS,
  type BlockKind,
  BUILDING_BLOCKS,
  type GroundKind,
  isHeldBlock,
} from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { listOf, plural } from "@terrakin/ui/format";
import { groundArt } from "@terrakin/ui/ground-art";
import { itemArt } from "@terrakin/ui/item-art";
import { personLink } from "@terrakin/ui/people";
import { everyVisible } from "@terrakin/ui/poll";
import {
  chips,
  closeOverlay,
  confirmTwice,
  emptyNote,
  errorLine,
  kindPill,
  linkTabs,
  moreButton,
  openOverlay,
  overlayShowing,
  sheet,
  toast,
  whileBusy,
} from "@terrakin/ui/ui";
import { timeAgo } from "@terrakin/ui/when";
import { actProblem, api } from "./api";
import {
  HELD_KINDS,
  PALETTE_TAB_WORDS,
  PALETTE_TABS,
  type PaletteTab,
  paintBlockRow,
  paintGroundRow,
  paintHeldRow,
  tabOf,
} from "./build-palette";
import { eventRow, openScheduleSheet } from "./event-cards";
import { savedResidentId, savedToken } from "./net";
import { skeletonCards } from "./post-card";
import { coins } from "./purse";
import {
  type CommonsPick,
  closedQuorum,
  closesIn,
  grantHandle,
  kindLabel,
  type PlanTile,
  pickLine,
  pickName,
  planChanges,
  planLists,
  planWords,
  proposalPlan,
  statusWord,
  tallyBar,
  tapPlan,
  townPaintKey,
} from "./town-format";
import { errorCard, type View, type ViewContext } from "./view";

/** How often the page asks for fresh tallies while it's on screen. */
const REFRESH_MS = 15_000;

interface Commons {
  x0: number;
  y0: number;
  size: number;
  hall: Set<string>;
  shop: Set<string>;
  blocks: Map<string, BlockKind>;
  ground: Map<string, GroundKind>;
}

const key = (x: number, y: number) => `${x},${y}`;

function commonsOf(world: WorldSnapshot): Commons {
  const size = world.config.plotSize;
  return {
    x0: world.commons.px * size,
    y0: world.commons.py * size,
    size,
    hall: new Set((world.townHall ?? []).map((t) => key(t.x, t.y))),
    shop: new Set((world.shop ?? []).map((t) => key(t.x, t.y))),
    blocks: new Map(world.blocks.map((b) => [key(b.x, b.y), b.block])),
    ground: new Map((world.ground ?? []).map((g) => [key(g.x, g.y), g.ground])),
  };
}

export function townView(ctx: ViewContext): View {
  ctx.setTitle("Town Hall · Terrakin");
  const el = h("div", { class: "column stack cards page town-page" });
  let destroyed = false;
  let town: TownResponse | undefined;
  let commons: Commons | undefined;
  let sheetOpen = false;
  let busy = false;
  /** The server's clock from the last world snapshot, and when it came, to read it forward. */
  let clock: { ms: number; at: number } | undefined;
  const serverNow = () => (clock ? clock.ms + (Date.now() - clock.at) : Date.now());

  const hero = h("section", {
    class: "stack start paper card town-hero",
    attrs: { "aria-labelledby": "town-title" },
  });
  const openList = h("div", { class: "stack proposal-list" });
  const queuedTitle = h("h2", { class: "section-title", text: "Waiting in line" });
  const queuedList = h("div", { class: "stack proposal-list" });
  const board = h("section", {
    class: "stack paper card board",
    attrs: { "aria-labelledby": "board-title" },
  });
  const calendar = h("section", {
    class: "stack paper card events-board",
    attrs: { "aria-labelledby": "events-title", id: "events" },
  });
  const archiveList = h("div", { class: "stack archive-list" });
  const more = moreButton("Show more results", async () => {
    if (!archiveNext) return;
    const r = await api.archive(archiveNext);
    if (destroyed) return;
    if (!r.ok) return r.message;
    addArchive(r.data.proposals, r.data.next);
  });
  let archiveNext: string | null = null;

  const ready = load();
  const stopRefresh = everyVisible(REFRESH_MS, () => {
    if (!sheetOpen && !busy) void refresh();
  });

  async function load(): Promise<void> {
    el.replaceChildren(...skeletonCards(2));
    const [t, w, past] = await Promise.all([api.town(), api.world(), api.archive()]);
    if (destroyed) return;
    if (!t.ok) {
      el.replaceChildren(errorCard(t.message, () => void load()));
      return;
    }
    town = t.data;
    if (w.ok) {
      commons = commonsOf(w.data);
      if (w.data.time) clock = { ms: w.data.time.nowMs, at: Date.now() };
    }
    el.replaceChildren(
      hero,
      h("h2", { class: "section-title", text: "Open proposals" }),
      openList,
      queuedTitle,
      queuedList,
      h("h2", { class: "section-title", attrs: { id: "events-title" }, text: "Coming up" }),
      calendar,
      h("h2", { class: "section-title", attrs: { id: "board-title" }, text: "Notice board" }),
      board,
      ...(town.shop ? [shopCard(town.shop)] : []),
      ...(town.treasury ? [bountiesCard()] : []),
      visitCard(),
      galleriesCard(),
      gamesCard(),
      h("h2", { class: "section-title", text: "Past results" }),
      archiveList,
      h("div", { class: "feed-foot" }, more.el),
    );
    paint();
    paintEvents();
    paintBoard(true);
    archiveList.replaceChildren();
    if (past.ok) addArchive(past.data.proposals, past.data.next);
    else archiveList.append(errorCard(past.message, () => void load()));
  }

  async function refresh() {
    const [t, w] = await Promise.all([api.town(), api.world()]);
    if (destroyed || !t.ok) return;
    town = t.data;
    if (w.ok) {
      commons = commonsOf(w.data);
      if (w.data.time) clock = { ms: w.data.time.nowMs, at: Date.now() };
    }
    // Only what changed gets drawn again, so a vote you're about to tap stays put.
    paint();
    paintEvents();
    const board = JSON.stringify(town.board);
    if (board !== paintedBoard) paintBoard(false);
  }

  // ---------- the calendar (RFC 0010) ----------

  /** What the calendar last showed, so a refresh with nothing new leaves it alone. */
  let paintedEvents = "";

  function paintEvents() {
    if (!town) return;
    const { live, upcoming } = town.events;
    const next = JSON.stringify(town.events);
    if (next === paintedEvents) return;
    paintedEvents = next;
    const now = serverNow();
    const rows = [...live, ...upcoming].map((e) =>
      eventRow(e, {
        now,
        me: savedResidentId() ?? undefined,
        navigate: ctx.navigate,
        changed: () => void refresh(),
      }),
    );
    const host = savedToken()
      ? h(
          "button",
          { class: "pill-button", attrs: { type: "button", id: "event-host" } },
          icon("calendar"),
          h("span", { text: "Host an event" }),
        )
      : null;
    host?.addEventListener("click", () => void openHost(host));
    calendar.replaceChildren(
      h("p", {
        class: "town-lede",
        text: "Shows, classes, markets, listening sessions, and gatherings around town. While one is on, Go takes you there.",
      }),
      rows.length > 0
        ? h("ol", { class: "stack plain-list event-list" }, ...rows)
        : emptyNote(
            "Nothing on the calendar yet",
            "Host something at your place: a few friends and a playlist is plenty.",
          ),
      ...(host ? [host] : []),
    );
  }

  /** The Schedule sheet, with where you can host read fresh, or why you can't yet. */
  async function openHost(button: HTMLButtonElement) {
    const [r, w] = await whileBusy(button, () => Promise.all([api.events(), api.world()]));
    if (destroyed) return;
    if (!r.ok) return toast(r.message);
    // The sheet places a Commons booking from the world's own answer, never a guess.
    if (!w.ok) return toast(w.message);
    const you = r.data.you;
    if (!you?.canHost) return toast(you?.why ?? "Step into the world once to host here.");
    sheetOpen = true;
    openScheduleSheet({
      events: r.data,
      commons: w.data.commons,
      done: () => void refresh(),
      closed: () => {
        sheetOpen = false;
      },
    });
  }

  // ---------- hero and proposals ----------

  /** What the top card and proposals last showed, and the notice board. */
  let painted = "";
  let paintedBoard = "";

  function paint() {
    if (!town) return;
    const mapKey = commons
      ? JSON.stringify([
          commons.x0,
          commons.y0,
          commons.size,
          [...commons.blocks],
          [...commons.ground],
          [...commons.shop],
        ])
      : "";
    const next = townPaintKey(town, Date.now(), mapKey);
    if (next === painted) return;
    painted = next;
    const you = town.you;
    const status = h("p", { class: "town-you" });
    let action: HTMLElement | null = null;
    if (!savedToken()) {
      status.append(
        "Residents with a plot and a hearth propose and vote here. ",
        h("a", { attrs: { href: "/world" }, text: "Join the world" }),
        " to take part.",
      );
    } else if (you?.eligible) {
      status.textContent =
        you.votes > 0
          ? `You can propose and vote. You've voted ${plural(you.votes, "time", "times")}.`
          : "You can propose and vote.";
      action = h(
        "button",
        {
          class: "btn-primary",
          attrs: { type: "button", id: "town-propose" },
          on: { click: () => openSheet() },
        },
        icon("plus"),
        h("span", { text: "Propose" }),
      );
    } else {
      status.textContent = you?.message ?? "Step into the world once to take part here.";
    }
    hero.replaceChildren(
      h("p", { class: "eyebrow", text: "Town Hall" }),
      h("h1", {
        class: "state-title town-title",
        attrs: { id: "town-title" },
        text: "Have a say in the Commons",
      }),
      h("p", {
        class: "town-lede",
        text: "Residents propose changes to the shared land and vote on them. A passed build goes up in the Commons: paths, benches, lamp posts, and blocks.",
      }),
      status,
      ...(action ? [action] : []),
      ...(town.nextClose
        ? [
            h("p", {
              class: "town-next",
              text: `Next vote ${closesIn(town.nextClose, Date.now()).toLowerCase()}.`,
            }),
          ]
        : []),
    );

    openList.replaceChildren(
      ...(town.open.length > 0
        ? town.open.map((p) => proposalCard(p))
        : [
            emptyNote(
              "Nothing on the table",
              you?.eligible
                ? "Have an idea for the Commons? Propose it."
                : "When someone proposes something, it shows up here.",
            ),
          ]),
    );
    queuedTitle.hidden = town.queued.length === 0;
    queuedList.replaceChildren(...town.queued.map((p) => proposalCard(p)));
  }

  function proposalCard(p: ProposalView, compact = false): HTMLElement {
    const you = town?.you;
    const head = h(
      "div",
      { class: "proposal-head" },
      kindPill(kindLabel(p.kind), p.kind === "advisory" ? "moss" : "sun"),
      h("span", {
        class: `proposal-status s-${p.status}`,
        text:
          p.status === "open" && p.closesAt
            ? closesIn(p.closesAt, Date.now())
            : statusWord(p.status),
      }),
    );
    const byline = h("p", { class: "proposal-by" }, personLink(p.author));
    const card = h(
      "article",
      {
        class: `stack paper card proposal${compact ? " compact" : ""}`,
        attrs: { "data-proposal": p.id },
      },
      head,
      h("h3", { class: "proposal-title", text: p.title }),
      p.text && !compact ? h("p", { class: "proposal-text", text: p.text }) : null,
      p.kind === "commons_build" && commons && planChanges(proposalPlan(p)) > 0 ? planMap(p) : null,
      p.amount !== undefined
        ? h(
            "p",
            { class: "proposal-by proposal-money" },
            icon("coin"),
            p.kind === "grant" && p.to
              ? h("span", {}, `${coins(p.amount)} from the treasury for `, personLink(p.to))
              : h("span", { text: `${coins(p.amount)} from the treasury for whoever does it` }),
          )
        : null,
      byline,
    );
    if (p.status !== "queued") card.append(tallyEl(p));
    if (p.answer) {
      card.append(
        h(
          "div",
          { class: "proposal-answer" },
          h("p", { class: "eyebrow", text: `Answer from ${p.answer.by.name}` }),
          h("p", { text: p.answer.text }),
        ),
      );
    }
    if (p.status === "open") {
      if (p.canVote) card.append(voteButtons(p));
      else if (savedToken() && you) {
        card.append(
          h("p", {
            class: "proposal-why",
            text: you.eligible
              ? "Only residents who could take part when this opened can vote on it."
              : (you.message ?? ""),
          }),
        );
      }
    }
    if (you && p.author.id === you.residentId && (p.status === "open" || p.status === "queued")) {
      const label = "Withdraw my proposal";
      const withdraw = h("button", {
        class: "text-button",
        attrs: { type: "button" },
        text: label,
      });
      confirmTwice(withdraw, "Tap again to withdraw", async () => {
        await whileBusy(withdraw, () => send({ type: "withdraw", proposal: p.id }, "Withdrawn"));
        withdraw.textContent = label;
      });
      card.append(withdraw);
    }
    return card;
  }

  function tallyEl(p: ProposalView): HTMLElement {
    const bar = tallyBar(p.tally);
    const seg = (cls: string, pct: number) => {
      const s = h("span", { class: `tally-${cls}` });
      s.style.width = `${pct}%`;
      return s;
    };
    return h(
      "div",
      { class: "tally" },
      h(
        "div",
        {
          class: "tally-bar",
          attrs: {
            role: "img",
            "aria-label": `${p.tally.yes} yes, ${p.tally.no} no, ${p.tally.abstain} abstain`,
          },
        },
        seg("yes", bar.yes),
        seg("no", bar.no),
        seg("abstain", bar.abstain),
      ),
      h(
        "p",
        { class: "tally-counts" },
        h("span", { class: "dot yes", text: `${p.tally.yes} yes` }),
        h("span", { class: "dot no", text: `${p.tally.no} no` }),
        h("span", { class: "dot abstain", text: `${p.tally.abstain} abstain` }),
        h("span", {
          class: `tally-quorum${bar.quorumMet ? " met" : ""}`,
          text: p.status === "open" ? bar.label : closedQuorum(p.tally),
        }),
      ),
    );
  }

  function voteButtons(p: ProposalView): HTMLElement {
    const row = h("div", {
      class: "vote-row",
      attrs: { role: "group", "aria-label": "Your vote" },
    });
    for (const choice of ["yes", "no", "abstain"] as const) {
      const on = p.yourVote === choice;
      const button = h("button", {
        class: `vote-button v-${choice}${on ? " on" : ""}`,
        attrs: { type: "button", "data-choice": choice, "aria-pressed": String(on) },
        text: choice === "yes" ? "Yes" : choice === "no" ? "No" : "Abstain",
        on: {
          click: () => {
            if (on || busy) return;
            button.setAttribute("aria-busy", "true");
            void send({ type: "vote", proposal: p.id, choice }, "Vote counted").finally(() =>
              button.removeAttribute("aria-busy"),
            );
          },
        },
      });
      row.append(button);
    }
    return row;
  }

  /** A small map of the Commons with a build's plan drawn on it. */
  function planMap(p: ProposalView): HTMLElement {
    const c = commons as Commons;
    const plan = proposalPlan(p);
    const grid = h("div", {
      class: "commons-map small",
      attrs: { role: "img", "aria-label": `${planWords(p)} in the Commons` },
    });
    grid.style.setProperty("--n", String(c.size));
    for (let y = c.y0; y < c.y0 + c.size; y++) {
      for (let x = c.x0; x < c.x0 + c.size; x++) {
        grid.append(tileEl(c, x, y, plan.get(key(x, y)) ?? {}, "span"));
      }
    }
    return grid;
  }

  async function send(action: Action, done: string) {
    if (busy) return;
    busy = true;
    const r = await api.act(action);
    busy = false;
    if (destroyed) return;
    const problem = actProblem(r);
    if (problem) return toast(problem);
    toast(done);
    await refresh();
  }

  // ---------- propose sheet ----------

  async function openSheet() {
    if (!town) return;
    const w = await api.world();
    if (destroyed) return;
    if (w.ok) commons = commonsOf(w.data);
    const c = commons;
    const limits = town.limits;
    type Kind = "advisory" | "commons_build" | "grant" | "bounty";
    let kind: Kind = "advisory";
    const plan = new Map<string, PlanTile>();

    const titleInput = h("input", {
      class: "sheet-input",
      attrs: {
        id: "propose-title",
        maxlength: limits.titleMax,
        placeholder: "A short title",
        autocomplete: "off",
        enterkeyhint: "next",
      },
    });
    const textInput = h("textarea", {
      class: "sheet-input sheet-text",
      attrs: {
        id: "propose-text",
        maxlength: limits.textMax,
        rows: 4,
        placeholder: "What should change, and why?",
      },
    });
    const count = h("p", { class: "plan-count", attrs: { "aria-live": "polite" } });
    const error = errorLine();
    const paintCount = () => {
      count.textContent = `${planChanges(plan)} of ${limits.buildMax} changes. It costs nobody anything: the town builds it.`;
    };

    // The build bar's tabs and rows, with nothing dimmed: the town pays for nothing.
    let pick: CommonsPick = "wood";
    const row = (tab: PaletteTab) =>
      h("div", {
        class: "palette-row",
        attrs: {
          id: `commons-${tab}`,
          role: "tabpanel",
          "aria-labelledby": `commons-tab-${tab}`,
          hidden: tab !== "blocks",
        },
      });
    const rows: Record<PaletteTab, HTMLElement> = {
      blocks: row("blocks"),
      ground: row("ground"),
      furniture: row("furniture"),
    };
    const pickWords = h("p", { class: "palette-line", attrs: { "aria-live": "polite" } });
    const paintPicks = () => {
      paintBlockRow(rows.blocks, BUILDING_BLOCKS, pick);
      paintGroundRow(rows.ground, null, pick);
      paintHeldRow(rows.furniture, null, pick);
      pickWords.textContent = pickLine(pick);
    };
    const tabs = linkTabs(
      PALETTE_TABS.map((tab) => ({
        current: tab === "blocks",
        content: [PALETTE_TAB_WORDS[tab]],
        id: `commons-tab-${tab}`,
        panel: `commons-${tab}`,
      })),
      {
        label: "What to build",
        className: "palette-tabs",
        pick: (i) => {
          const tab = PALETTE_TABS[i] ?? "blocks";
          for (const [name, el] of Object.entries(rows)) el.hidden = name !== tab;
          if (tabOf(pick) !== tab) {
            pick =
              tab === "blocks" ? "wood" : tab === "ground" ? "cobble" : (HELD_KINDS[0] ?? "bench");
          }
          paintPicks();
        },
      },
    );
    const palette = h(
      "div",
      { class: "stack tight commons-palette", attrs: { "aria-label": "Pick what to build" } },
      tabs,
      ...PALETTE_TABS.map((tab) => rows[tab]),
      pickWords,
    );
    palette.addEventListener("click", (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>(
        "button[data-block], button[data-ground]",
      );
      if (!button) return;
      pick = (button.dataset.ground ?? button.dataset.block) as CommonsPick;
      paintPicks();
    });
    paintPicks();

    const grid = h("div", {
      class: "commons-map editor",
      attrs: { "aria-label": "Map of the Commons" },
    });
    if (c) {
      grid.style.setProperty("--n", String(c.size));
      for (let y = c.y0; y < c.y0 + c.size; y++) {
        for (let x = c.x0; x < c.x0 + c.size; x++) {
          const k = key(x, y);
          const cell = tileEl(c, x, y, {}, "button");
          if (c.hall.has(k) || c.shop.has(k)) cell.setAttribute("disabled", "");
          cell.addEventListener("click", () => {
            const was = plan.get(k) ?? {};
            const next = tapPlan(was, pick, { block: c.blocks.get(k), ground: c.ground.get(k) });
            const parts = (t: PlanTile) => (t.block ? 1 : 0) + (t.ground ? 1 : 0);
            if (parts(next) > parts(was) && planChanges(plan) >= limits.buildMax) {
              error.textContent = `A build can make at most ${limits.buildMax} changes.`;
              return;
            }
            error.textContent = "";
            if (parts(next) > 0) plan.set(k, next);
            else plan.delete(k);
            retile(c, x, y, next, cell);
            paintCount();
          });
          grid.append(cell);
        }
      }
    }
    paintCount();
    const buildPart = h(
      "div",
      { class: "stack tight plan-part" },
      h("p", { class: "field-label", text: "Draw it on the Commons" }),
      palette,
      grid,
      count,
    );
    buildPart.hidden = true;

    // A grant or a town bounty pays from the treasury, so it needs coins open.
    const treasury = town.treasury?.balance;
    const amountInput = h("input", {
      class: "sheet-input coin-amount",
      attrs: {
        id: "propose-amount",
        type: "number",
        inputmode: "numeric",
        min: 1,
        max: Math.min(1_000, treasury ?? 0),
        step: 1,
      },
    });
    const toInput = h("input", {
      class: "sheet-input",
      attrs: {
        id: "propose-to",
        placeholder: "@handle",
        autocomplete: "off",
        autocapitalize: "none",
        spellcheck: "false",
      },
    });
    const toPart = h(
      "div",
      { class: "stack tight" },
      h("label", { class: "field-label", attrs: { for: "propose-to" }, text: "Who it's for" }),
      toInput,
    );
    const moneyPart = h(
      "div",
      { class: "stack tight money-part" },
      toPart,
      h("label", {
        class: "field-label",
        attrs: { for: "propose-amount" },
        text: "Coins from the treasury",
      }),
      amountInput,
      h("p", {
        class: "sheet-note",
        text: `Up to 1,000. The treasury holds ${coins(treasury ?? 0)}. A town bounty pays whoever does the job, once a maintainer checks it.`,
      }),
    );
    moneyPart.hidden = true;
    const kindWords: Record<Kind, string> = {
      advisory: "An idea",
      commons_build: "A build",
      grant: "A grant",
      bounty: "A job",
    };
    const offered: Kind[] = [
      "advisory",
      ...(c ? (["commons_build"] as const) : []),
      ...(treasury !== undefined ? (["grant", "bounty"] as const) : []),
    ];
    const kinds = chips<Kind>(
      offered,
      kind,
      (v) => [h("span", { text: kindWords[v] })],
      (v) => {
        kind = v;
        buildPart.hidden = kind !== "commons_build";
        moneyPart.hidden = kind !== "grant" && kind !== "bounty";
        toPart.hidden = kind !== "grant";
      },
      h("div", { class: "kind-row", attrs: { "aria-label": "Kind of proposal" } }),
    ).row;

    const submit = h(
      "button",
      { class: "btn-primary", attrs: { type: "submit", id: "propose-submit" } },
      h("span", { text: "Put it to the town" }),
    );
    const form = h(
      "form",
      { class: "sheet-body", attrs: { novalidate: true } },
      kinds,
      h("label", { class: "field-label", attrs: { for: "propose-title" }, text: "Title" }),
      titleInput,
      h("label", { class: "field-label", attrs: { for: "propose-text" }, text: "Details" }),
      textInput,
      buildPart,
      moneyPart,
      h("p", {
        class: "sheet-note",
        text: "Voting closes at midnight UTC, two nights after it opens. Everyone can see who voted which way.",
      }),
      error,
      submit,
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = titleInput.value.trim();
      if (!title) {
        error.textContent = "Give it a title.";
        titleInput.focus();
        return;
      }
      if (kind === "commons_build" && planChanges(plan) === 0) {
        error.textContent = "Tap some tiles on the map first.";
        return;
      }
      const money = kind === "grant" || kind === "bounty";
      const amount = Number(amountInput.value);
      if (money && (!Number.isInteger(amount) || amount < 1)) {
        error.textContent = "Say how many coins, a whole number.";
        amountInput.focus();
        return;
      }
      let to: string | undefined;
      if (kind === "grant") {
        const handle = grantHandle(toInput.value);
        const found = handle ? await api.byHandle(handle) : null;
        if (!found?.ok) {
          error.textContent = "Nobody has that handle. Check it on their profile.";
          toInput.focus();
          return;
        }
        to = found.data.resident.id;
      }
      const r = await whileBusy(submit, () =>
        api.act({
          type: "propose",
          kind,
          title,
          text: textInput.value.trim(),
          ...(kind === "commons_build" ? planLists(plan) : {}),
          ...(money ? { amount } : {}),
          ...(to ? { to } : {}),
        }),
      );
      const problem = actProblem(r);
      if (problem) {
        // Closed while it sent: the error line is gone with it.
        if (overlayShowing(dialog)) error.textContent = problem;
        else toast(problem);
        return;
      }
      closeOverlay(dialog);
      toast("Your proposal is up");
      void refresh();
    });

    const { dialog } = sheet({ id: "propose-sheet-title", title: "Propose" }, form);
    sheetOpen = true;
    openOverlay(dialog, () => {
      sheetOpen = false;
    });
    titleInput.focus();
  }

  // ---------- the town shop ----------

  /** Across the Commons from the hall: what the town buys today, and the way in. */
  function shopCard(shop: NonNullable<TownResponse["shop"]>): HTMLElement {
    return h(
      "section",
      { class: "stack start paper card town-shop", attrs: { "aria-label": "The town shop" } },
      h("h2", { class: "card-title", text: "The town shop" }),
      h("p", {
        class: "town-lede",
        text: `Across the Commons. Today the town buys ${listOf(shop.buying.map((b) => b.name.toLowerCase()))}.`,
      }),
      h(
        "a",
        { class: "pill-button", attrs: { href: "/shop" } },
        h("span", { text: "Visit the shop" }),
        icon("arrow"),
      ),
    );
  }

  // ---------- bounties ----------

  /** A card that points somewhere else in town: a title, a line, and a link. */
  function wayCard(o: {
    title: string;
    text: string;
    href: string;
    link: string;
    className: string;
  }): HTMLElement {
    return h(
      "section",
      { class: `stack start paper card ${o.className}`, attrs: { "aria-label": o.title } },
      h("h2", { class: "card-title", text: o.title }),
      h("p", { class: "town-lede", text: o.text }),
      h(
        "a",
        { class: "pill-button", attrs: { href: o.href } },
        h("span", { text: o.link }),
        icon("arrow"),
      ),
    );
  }

  /** The way to the bounties: jobs the town and residents pay coins for. */
  function bountiesCard(): HTMLElement {
    return wayCard({
      title: "Bounties",
      text: "Jobs the town and your neighbors pay coins for. A passed job proposal goes up there, paid from the treasury.",
      href: "/bounties",
      link: "See the bounties",
      className: "town-bounties",
    });
  }

  /** The way to plots to visit (RFC 0020): every home in town, newest change first. */
  function visitCard(): HTMLElement {
    return wayCard({
      title: "Plots to visit",
      text: "Every home in town, drawn from above, newest change first. Visit one, look around, and admire it.",
      href: "/visit",
      link: "See the plots",
      className: "town-visit",
    });
  }

  /** The way to the galleries: plots their residents opened to show what they made. */
  function galleriesCard(): HTMLElement {
    return wayCard({
      title: "Galleries",
      text: "Residents open their plots as galleries and show what they grew, made, and painted. Admire what you like.",
      href: "/galleries",
      link: "Visit the galleries",
      className: "town-galleries",
    });
  }

  /** The way to the games: tables in the Commons where people and AIs play together. */
  function gamesCard(): HTMLElement {
    return wayCard({
      title: "Games",
      text: "Tables in the Commons where people and AIs play short games together. Everyone chooses at once, and nobody sees a choice until the round closes.",
      href: "/games",
      link: "Find a table",
      className: "town-games",
    });
  }

  // ---------- notice board ----------

  function paintBoard(withComposer: boolean) {
    if (!town) return;
    let list = board.querySelector<HTMLElement>(".notice-list");
    if (withComposer || !list) {
      list = h("ol", { class: "stack plain-list notice-list" });
      board.replaceChildren(savedToken() ? noticeComposer() : boardHint(), list);
    }
    const notices = town.board;
    paintedBoard = JSON.stringify(notices);
    list.replaceChildren(
      ...(notices.length > 0
        ? notices.map(noticeEl)
        : [
            h("li", {
              class: "notice-empty",
              text: "The board is empty. Pin a notice for the town.",
            }),
          ]),
    );
  }

  function boardHint(): HTMLElement {
    return h(
      "p",
      { class: "board-hint" },
      "Notices stay up for two days. ",
      h("a", { attrs: { href: "/world" }, text: "Join the world" }),
      " to pin one.",
    );
  }

  function noticeComposer(): HTMLElement {
    const max = town?.limits.noticeMax ?? 280;
    const input = h("textarea", {
      class: "sheet-input notice-input",
      attrs: {
        id: "notice-text",
        "aria-label": "A notice for the town",
        maxlength: max,
        rows: 2,
        placeholder: "Pin a notice for the town",
      },
    });
    const pin = h(
      "button",
      { class: "btn-primary small", attrs: { type: "submit", id: "notice-pin" } },
      icon("pin"),
      h("span", { text: "Pin" }),
    );
    const form = h("form", { class: "notice-form" }, input, pin);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const r = await whileBusy(pin, () => api.pinNotice(text));
      if (destroyed) return;
      if (!r.ok) return toast(r.message);
      input.value = "";
      town?.board.unshift(r.data.notice);
      paintBoard(false);
    });
    return form;
  }

  function noticeEl(n: NoticeView): HTMLElement {
    let takeDown: HTMLButtonElement | null = null;
    if (n.canRemove) {
      const button = h("button", {
        class: "text-button",
        attrs: { type: "button" },
        text: "Take down",
      });
      confirmTwice(button, "Tap again to take down", async () => {
        const r = await whileBusy(button, () => api.removeNotice(n.id));
        if (destroyed) return;
        if (!r.ok) {
          button.textContent = "Take down";
          return toast(r.message);
        }
        if (town) town.board = town.board.filter((b) => b.id !== n.id);
        paintBoard(false);
      });
      takeDown = button;
    }
    return h(
      "li",
      { class: "notice", attrs: { "data-notice": n.id } },
      h("p", { class: "notice-by" }, personLink(n.author), timeAgo(n.createdAt)),
      h("p", { class: "notice-text", text: n.text }),
      takeDown,
    );
  }

  // ---------- archive ----------

  function addArchive(proposals: ProposalView[], next: string | null) {
    archiveNext = next;
    if (proposals.length === 0 && archiveList.childElementCount === 0) {
      archiveList.append(
        h("p", { class: "replies-empty", text: "No results yet. Closed proposals land here." }),
      );
    }
    archiveList.append(...proposals.map((p) => proposalCard(p, true)));
    more.el.hidden = archiveNext === null;
  }

  return {
    el,
    ready,
    destroy() {
      destroyed = true;
      stopRefresh();
    },
  };
}

/**
 * One tile of a Commons map: the hall or the shop, or the path and the block on it as they are, or
 * as the plan leaves them, with what the plan adds ringed and what it takes away faded.
 */
function tileEl(c: Commons, x: number, y: number, planned: PlanTile, tag: "span" | "button") {
  const el = h(tag, { class: "tile", attrs: { "data-tile": key(x, y) } });
  if (tag === "button") el.setAttribute("type", "button");
  return retile(c, x, y, planned, el);
}

function retile<T extends HTMLElement>(
  c: Commons,
  x: number,
  y: number,
  planned: PlanTile,
  el: T,
): T {
  const k = key(x, y);
  const now = { block: c.blocks.get(k), ground: c.ground.get(k) };
  const adds = {
    block: planned.block === "remove" ? undefined : planned.block,
    ground: planned.ground === "lift" ? undefined : planned.ground,
  };
  const block = adds.block ?? now.block;
  const ground = adds.ground ?? now.ground;
  const building = c.hall.has(k) ? "Town Hall" : c.shop.has(k) ? "the shop" : null;
  el.className = "tile";
  el.removeAttribute("data-block");
  el.removeAttribute("data-ground");
  el.classList.toggle("hall", c.hall.has(k));
  el.classList.toggle("shop", !c.hall.has(k) && c.shop.has(k));
  el.classList.toggle("planned", adds.block !== undefined || adds.ground !== undefined);
  el.classList.toggle("removing", planned.block === "remove");
  el.classList.toggle("lifting", planned.ground === "lift");
  if (block) el.dataset.block = block;
  if (ground) el.dataset.ground = ground;
  const layers: Element[] = [];
  if (!building && ground) layers.push(groundArt(ground, { size: 40 }));
  if (!building && block) {
    if (isHeldBlock(block)) layers.push(itemArt(block, { size: 28 }));
    else {
      const face = h("span", { class: "tile-block" });
      face.style.background = BLOCK_COLORS[block];
      layers.push(face);
    }
  }
  el.replaceChildren(...layers);
  const words = (kind: BlockKind | GroundKind | undefined, change: string) =>
    kind ? [`${pickName(kind)}${change}`] : [];
  const what =
    building ??
    ([
      ...(planned.block === "remove"
        ? words(now.block, ", taken away")
        : words(block, adds.block ? ", planned" : "")),
      ...(planned.ground === "lift"
        ? words(now.ground, ", lifted")
        : words(ground, adds.ground ? ", planned" : "")),
    ].join("; ") ||
      "empty");
  el.setAttribute("aria-label", `(${x}, ${y}) ${what}`);
  el.title = what;
  return el;
}
