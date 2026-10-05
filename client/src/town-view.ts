/**
 * `/town` the Town Hall: open proposals with live tallies and vote buttons, the Propose sheet (an
 * advisory, or a build drawn on a map of the Commons), the notice board, and past results.
 * Titles, texts, notices, and names are other residents' words: textContent only. The server
 * decides who may vote and what passes; this page shows its answers and its reasons.
 */
import type {
  Action,
  NoticeView,
  ProposalView,
  TownResponse,
  WorldSnapshot,
} from "@terrakin/protocol";
import type { BlockKind, BuildingBlock } from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { listOf, plural } from "@terrakin/ui/format";
import { personLink } from "@terrakin/ui/people";
import { everyVisible } from "@terrakin/ui/poll";
import {
  chips,
  closeOverlay,
  confirmTwice,
  emptyNote,
  errorLine,
  moreButton,
  openOverlay,
  overlayShowing,
  sheet,
  toast,
  whileBusy,
} from "@terrakin/ui/ui";
import { timeAgo } from "@terrakin/ui/when";
import { actProblem, api } from "./api";
import { savedToken } from "./net";
import { skeletonCards } from "./post-card";
import {
  closedQuorum,
  closesIn,
  nextCell,
  type PlanCell,
  statusWord,
  tallyBar,
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
  blocks: Map<string, BlockKind>;
}

const key = (x: number, y: number) => `${x},${y}`;

function commonsOf(world: WorldSnapshot): Commons {
  const size = world.config.plotSize;
  return {
    x0: world.commons.px * size,
    y0: world.commons.py * size,
    size,
    hall: new Set((world.townHall ?? []).map((t) => key(t.x, t.y))),
    blocks: new Map(world.blocks.map((b) => [key(b.x, b.y), b.block])),
  };
}

export function townView(ctx: ViewContext): View {
  ctx.setTitle("Town Hall · Terrakin");
  const el = h("div", { class: "column page town-page" });
  let destroyed = false;
  let town: TownResponse | undefined;
  let commons: Commons | undefined;
  let sheetOpen = false;
  let busy = false;

  const hero = h("section", {
    class: "paper card town-hero",
    attrs: { "aria-labelledby": "town-title" },
  });
  const openList = h("div", { class: "proposal-list" });
  const queuedTitle = h("h2", { class: "section-title", text: "Waiting in line" });
  const queuedList = h("div", { class: "proposal-list" });
  const board = h("section", {
    class: "paper card board",
    attrs: { "aria-labelledby": "board-title" },
  });
  const archiveList = h("div", { class: "archive-list" });
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
    if (w.ok) commons = commonsOf(w.data);
    el.replaceChildren(
      hero,
      h("h2", { class: "section-title", text: "Open proposals" }),
      openList,
      queuedTitle,
      queuedList,
      h("h2", { class: "section-title", attrs: { id: "board-title" }, text: "Notice board" }),
      board,
      ...(town.shop ? [shopCard(town.shop)] : []),
      h("h2", { class: "section-title", text: "Past results" }),
      archiveList,
      h("div", { class: "feed-foot" }, more.el),
    );
    paint();
    paintBoard(true);
    archiveList.replaceChildren();
    if (past.ok) addArchive(past.data.proposals, past.data.next);
    else archiveList.append(errorCard(past.message, () => void load()));
  }

  async function refresh() {
    const [t, w] = await Promise.all([api.town(), api.world()]);
    if (destroyed || !t.ok) return;
    town = t.data;
    if (w.ok) commons = commonsOf(w.data);
    // Only what changed gets drawn again, so a vote you're about to tap stays put.
    paint();
    const board = JSON.stringify(town.board);
    if (board !== paintedBoard) paintBoard(false);
  }

  // ---------- hero and proposals ----------

  /** What the top card and proposals last showed, and the notice board. */
  let painted = "";
  let paintedBoard = "";

  function paint() {
    if (!town) return;
    const mapKey = commons
      ? JSON.stringify([commons.x0, commons.y0, commons.size, [...commons.blocks]])
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
        text: "Residents propose changes to the shared land and vote on them. A passed build goes up in the Commons, block by block.",
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
      h("span", {
        class: `proposal-kind ${p.kind === "commons_build" ? "build" : "advisory"}`,
        text: p.kind === "commons_build" ? "Build" : "Advisory",
      }),
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
        class: `paper card proposal${compact ? " compact" : ""}`,
        attrs: { "data-proposal": p.id },
      },
      head,
      h("h3", { class: "proposal-title", text: p.title }),
      p.text && !compact ? h("p", { class: "proposal-text", text: p.text }) : null,
      p.kind === "commons_build" && commons && (p.blocks.length > 0 || p.remove.length > 0)
        ? planMap(p)
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

  /** A small map of the Commons with a build's blocks on it. */
  function planMap(p: ProposalView): HTMLElement {
    const c = commons as Commons;
    const plan = new Map<string, PlanCell>();
    for (const b of p.blocks) plan.set(key(b.x, b.y), b.block);
    for (const t of p.remove) plan.set(key(t.x, t.y), "remove");
    const grid = h("div", {
      class: "commons-map small",
      attrs: {
        role: "img",
        "aria-label": `${plural(p.blocks.length, "block", "blocks")} in the Commons`,
      },
    });
    grid.style.setProperty("--n", String(c.size));
    for (let y = c.y0; y < c.y0 + c.size; y++) {
      for (let x = c.x0; x < c.x0 + c.size; x++) {
        grid.append(tileEl(c, x, y, plan.get(key(x, y)) ?? null, "span"));
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
    let kind: "advisory" | "commons_build" = "advisory";
    const plan = new Map<string, PlanCell>();

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
    const grid = h("div", {
      class: "commons-map editor",
      attrs: { "aria-label": "Map of the Commons" },
    });
    const paintCount = () => {
      count.textContent = `${plan.size} of ${limits.buildMax} blocks. Tap a tile to cycle wood, stone, glass, leaf. Tap a block to take it away.`;
    };
    if (c) {
      grid.style.setProperty("--n", String(c.size));
      for (let y = c.y0; y < c.y0 + c.size; y++) {
        for (let x = c.x0; x < c.x0 + c.size; x++) {
          const k = key(x, y);
          const cell = tileEl(c, x, y, null, "button");
          if (c.hall.has(k)) cell.setAttribute("disabled", "");
          cell.addEventListener("click", () => {
            const next = nextCell(plan.get(k) ?? null, c.blocks.has(k));
            if (next !== null && !plan.has(k) && plan.size >= limits.buildMax) {
              error.textContent = `A build can change at most ${limits.buildMax} blocks.`;
              return;
            }
            error.textContent = "";
            if (next === null) plan.delete(k);
            else plan.set(k, next);
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
      { class: "plan-part" },
      h("p", { class: "field-label", text: "Draw it on the Commons" }),
      grid,
      count,
    );
    buildPart.hidden = true;

    const kinds = chips<"advisory" | "commons_build">(
      c ? ["advisory", "commons_build"] : ["advisory"],
      kind,
      (v) => [h("span", { text: v === "advisory" ? "An idea" : "A build" })],
      (v) => {
        kind = v;
        buildPart.hidden = kind !== "commons_build";
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
      const blocks: { x: number; y: number; block: BuildingBlock }[] = [];
      const remove: { x: number; y: number }[] = [];
      for (const [k, cell] of plan) {
        const [x, y] = k.split(",").map(Number) as [number, number];
        if (cell === "remove") remove.push({ x, y });
        else if (cell) blocks.push({ x, y, block: cell });
      }
      if (kind === "commons_build" && blocks.length + remove.length === 0) {
        error.textContent = "Tap some tiles on the map first.";
        return;
      }
      const r = await whileBusy(submit, () =>
        api.act({
          type: "propose",
          kind,
          title,
          text: textInput.value.trim(),
          ...(kind === "commons_build" ? { blocks, remove } : {}),
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
      { class: "paper card town-shop", attrs: { "aria-label": "The town shop" } },
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

  // ---------- notice board ----------

  function paintBoard(withComposer: boolean) {
    if (!town) return;
    let list = board.querySelector<HTMLElement>(".notice-list");
    if (withComposer || !list) {
      list = h("ol", { class: "notice-list" });
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

/** One tile of a Commons map: the hall, a block, a planned block, or a block marked to go. */
function tileEl(c: Commons, x: number, y: number, planned: PlanCell, tag: "span" | "button") {
  const el = h(tag, { class: "tile", attrs: { "data-tile": key(x, y) } });
  if (tag === "button") el.setAttribute("type", "button");
  return retile(c, x, y, planned, el);
}

function retile<T extends HTMLElement>(
  c: Commons,
  x: number,
  y: number,
  planned: PlanCell,
  el: T,
): T {
  const k = key(x, y);
  const existing = c.blocks.get(k);
  el.className = "tile";
  el.removeAttribute("data-block");
  if (c.hall.has(k)) el.classList.add("hall");
  if (existing) el.dataset.block = existing;
  if (planned === "remove") el.classList.add("removing");
  else if (planned) {
    el.dataset.block = planned;
    el.classList.add("planned");
  }
  const what = c.hall.has(k)
    ? "Town Hall"
    : planned === "remove"
      ? `${existing ?? "block"}, taken away`
      : planned
        ? `${planned}, planned`
        : (existing ?? "empty");
  el.setAttribute("aria-label", `(${x}, ${y}) ${what}`);
  el.title = what;
  return el;
}
