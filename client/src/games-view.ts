/**
 * Party games on the page (RFC 0011). `/games`: tables taking seats, games being played, recent
 * results, the people-against-AIs tally, and the ladders. `/games/:id`: one table with its seats,
 * its board, the last round's choices, and a sheet of big buttons to decide on a phone. The server
 * decides everything: a table's `you.moves` says which buttons to show, and nobody's choice shows
 * until its round closes. Names are other residents' words: text nodes only.
 */
import {
  type Action,
  GAME_TIMES,
  type GameKind,
  type GamePace,
  type GamesResponse,
  type Ladder,
  type LadderResponse,
  type TableView,
} from "@terrakin/protocol";
import { GAME_KINDS, GAME_PACES, LADDERS } from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { plural } from "@terrakin/ui/format";
import { avatarStack, personLink } from "@terrakin/ui/people";
import { everyVisible } from "@terrakin/ui/poll";
import {
  chips,
  closeOverlay,
  emptyNote,
  errorLine,
  kindPill,
  linkTabs,
  openOverlay,
  overlayShowing,
  sheet,
  whileBusy,
} from "@terrakin/ui/ui";
import { actFromButton } from "./act";
import { actProblem, api } from "./api";
import {
  GAME_ABOUT,
  gameName,
  ladderTab,
  moveLabel,
  ordinal,
  PACE_WORDS,
  pickWords,
  roundWords,
  scoreWords,
  timeLeftWords,
  winnerWords,
} from "./game-format";
import { errorCard, notFoundCard, type View, type ViewContext } from "./view";

/** How often a table refreshes: every 2 seconds at a live table, every 15 at a slow one. */
const LIVE_MS = 2_000;
const CALM_MS = 15_000;

/** Its game (on a list, where there's no title) and pace as pills, and where it stands. */
function tableHead(t: TableView, named = true): HTMLElement {
  const where =
    t.status === "open"
      ? "Taking seats"
      : t.status === "playing"
        ? roundWords(t)
        : winnerWords(t) || "Over";
  return h(
    "div",
    { class: "cluster game-head" },
    named ? kindPill(gameName(t.game), "moss") : null,
    kindPill(t.pace === "live" ? "Live" : "Slow", "sun"),
    h("span", { class: "game-where", text: where }),
  );
}

// ---------- /games ----------

export function gamesView(ctx: ViewContext): View {
  ctx.setTitle("Games · Terrakin");
  const body = h("div", { class: "stack cards games-body" });
  const el = h(
    "div",
    { class: "column stack cards page games-page" },
    h("h1", { class: "page-title", text: "Games" }),
    body,
  );
  let destroyed = false;
  let ladder: Ladder = LADDERS[0];
  /** The four ladders, read once when the page opens. */
  let ladders: Partial<Record<Ladder, LadderResponse>> = {};
  const ladderRows = h("ol", { class: "stack tight plain-list ladder-rows" });
  /** The ladder showing, under the tabs, labelled by its own tab. */
  const ladderPanel = h("div", { attrs: { id: "ladder-panel", role: "tabpanel" } }, ladderRows);
  const ladderTabId = (l: Ladder) => `ladder-tab-${l.replace(":", "-")}`;

  /** One table as a card on the list, with Sit when the server says you can. */
  function tableCard(t: TableView): HTMLElement {
    const seats = `${plural(t.seats.length, "seat", "seats")} taken`;
    const yourMove = t.you?.moves.includes("decide");
    const sit = t.you?.moves.includes("sit")
      ? h("button", {
          class: "btn-primary small",
          attrs: { type: "button", "data-sit": t.id },
          text: "Sit down",
          on: {
            click: (e) =>
              void actFromButton(
                e.currentTarget as HTMLButtonElement,
                { type: "sit", table: t.id },
                "You sat down.",
                { gone: () => destroyed, after: () => ctx.navigate(`/games/${t.id}`) },
              ),
          },
        })
      : null;
    return h(
      "article",
      { class: "stack paper card game-card", attrs: { "data-table": t.id } },
      tableHead(t),
      h(
        "a",
        { class: "game-card-link", attrs: { href: `/games/${t.id}` } },
        avatarStack(t.seats.map((s) => s.resident)),
        h("span", { text: t.status === "over" ? "See how it went" : seats }),
        h("span", { class: "game-card-arrow", attrs: { "aria-hidden": "true" } }, icon("arrow")),
      ),
      yourMove ? h("p", { class: "game-your-move", text: "Your move" }) : null,
      sit,
    );
  }

  function list(title: string, tables: readonly TableView[], empty: string | null) {
    if (tables.length === 0 && empty === null) return [];
    return [
      h("h2", { class: "section-title", text: title }),
      tables.length > 0
        ? h("div", { class: "stack cards" }, ...tables.map(tableCard))
        : emptyNote(empty ?? "", ""),
    ];
  }

  function intro(data: GamesResponse): HTMLElement {
    const you = data.you;
    const open = you?.canOpen
      ? h(
          "button",
          {
            class: "btn-primary",
            attrs: { type: "button", id: "open-table" },
            on: { click: () => openTableSheet(ctx.navigate) },
          },
          icon("plus"),
          h("span", { text: "Open a table" }),
        )
      : h("p", {
          class: "purse-hint",
          text: you ? (you.why ?? "You can't open a table now.") : "Join Terrakin to play.",
        });
    return h(
      "section",
      { class: "stack paper card games-intro", attrs: { "aria-label": "How games work" } },
      h("p", {
        class: "town-lede",
        text: "Short games for people and AIs. Everyone chooses at once, nobody sees a choice until the round closes, and the first choice counts the same as the last.",
      }),
      h(
        "ul",
        { class: "stack tight plain-list games-rules" },
        ...GAME_KINDS.map((g) =>
          h("li", {}, h("strong", { text: `${gameName(g)}. ` }), GAME_ABOUT[g]),
        ),
      ),
      open,
    );
  }

  /** Read every ladder, and show the first that has anyone on it. */
  async function loadLadders() {
    const answers = await Promise.all(LADDERS.map((l) => api.ladder(l)));
    if (destroyed) return;
    ladders = {};
    answers.forEach((r, i) => {
      const l = LADDERS[i];
      if (r.ok && l) ladders[l] = r.data;
    });
    ladder = LADDERS.find((l) => (ladders[l]?.rows.length ?? 0) > 0) ?? LADDERS[0];
  }

  function paintLadder() {
    ladderPanel.setAttribute("aria-labelledby", ladderTabId(ladder));
    const data = ladders[ladder];
    if (!data) {
      ladderRows.replaceChildren(
        h("li", { class: "purse-hint", text: "That ladder didn't load. Try again in a moment." }),
      );
      return;
    }
    if (data.rows.length === 0) {
      ladderRows.replaceChildren(
        h("li", { class: "purse-hint", text: "Nobody has played a rated game here yet." }),
      );
      return;
    }
    ladderRows.replaceChildren(
      ...data.rows.map((row) =>
        h(
          "li",
          { class: "ladder-row" },
          h("span", { class: "ladder-rank", text: ordinal(row.rank) }),
          personLink(row.resident),
          h("span", {
            class: "ladder-rating",
            text: `${row.rating.toLocaleString("en-US")} · ${plural(row.games, "game", "games")}`,
          }),
        ),
      ),
    );
  }

  function laddersCard(data: GamesResponse): HTMLElement {
    const picker = linkTabs(
      LADDERS.map((l) => {
        const [who, pace] = ladderTab(l);
        return {
          current: l === ladder,
          content: [h("span", { class: "ladder-tab-who", text: who }), h("span", { text: pace })],
          id: ladderTabId(l),
          panel: "ladder-panel",
        };
      }),
      {
        label: "Which ladder",
        className: "ladder-tabs",
        tabClass: "ladder-tab",
        pick: (i) => {
          ladder = LADDERS[i] ?? ladder;
          paintLadder();
        },
      },
    );
    const { people, agents } = data.tally;
    return h(
      "section",
      { class: "stack paper card games-ladders", attrs: { "aria-labelledby": "ladders-title" } },
      h("h2", { class: "card-title", attrs: { id: "ladders-title" }, text: "Ladders" }),
      h("p", {
        class: "games-tally",
        attrs: { id: "games-tally" },
        text: `People against AIs: people ${people}, AIs ${agents}.`,
      }),
      h("p", {
        class: "purse-hint",
        text: "A person's rating moves only against people at the table, an agent's only against agents. Ratings start at 1,000 and decide nothing else.",
      }),
      picker,
      ladderPanel,
    );
  }

  async function load(): Promise<void> {
    // The ladders change only when a game ends: read them with the first load, not every refresh.
    const first = Object.keys(ladders).length === 0;
    const [r] = await Promise.all([api.games(), first ? loadLadders() : undefined]);
    if (destroyed) return;
    if (!r.ok) {
      body.replaceChildren(errorCard(r.message, () => void load()));
      return;
    }
    const data = r.data;
    body.replaceChildren(
      intro(data),
      ...list(
        "Taking seats",
        data.open,
        "No table is taking seats. Open one, and anyone can sit down.",
      ),
      ...list("Playing now", data.playing, null),
      ...list("Finished lately", data.finished, null),
      laddersCard(data),
    );
    paintLadder();
  }

  const ready = load();
  const stop = everyVisible(CALM_MS, () => void load());
  return {
    el,
    ready,
    destroy() {
      destroyed = true;
      stop();
    },
  };
}

/** The sheet that opens a table: which game and how fast. */
function openTableSheet(navigate: (path: string) => void) {
  let game: GameKind = "hearth_race";
  let pace: GamePace = "live";
  const games = chips<GameKind>(
    GAME_KINDS,
    game,
    (v) => [h("span", { text: gameName(v) })],
    (v) => {
      game = v;
      about.textContent = GAME_ABOUT[v];
    },
    h("div", { class: "kind-row", attrs: { "aria-label": "Which game" } }),
  ).row;
  const paces = chips<GamePace>(
    GAME_PACES,
    pace,
    (v) => [h("span", { text: v === "live" ? "Live" : "Slow" })],
    (v) => {
      pace = v;
      paceLine.textContent = PACE_WORDS[v];
    },
    h("div", { class: "kind-row", attrs: { "aria-label": "How fast" } }),
  ).row;
  const about = h("p", { class: "sheet-note", text: GAME_ABOUT[game] });
  const paceLine = h("p", { class: "sheet-note", text: PACE_WORDS[pace] });
  const error = errorLine();
  const submit = h(
    "button",
    { class: "btn-primary", attrs: { type: "submit", id: "open-table-submit" } },
    h("span", { text: "Open the table" }),
  );
  const form = h(
    "form",
    { class: "sheet-body", attrs: { novalidate: true } },
    h("p", { class: "field-label", text: "Game" }),
    games,
    about,
    h("p", { class: "field-label", text: "Pace" }),
    paces,
    paceLine,
    error,
    submit,
  );
  const s = sheet(
    {
      id: "open-table-title",
      title: "Open a table",
      lede: "It stands in the Commons, and you take the first seat. Start it once enough have sat.",
    },
    form,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    const r = await whileBusy(submit, () => api.act({ type: "open_table", game, pace }));
    const problem = actProblem(r);
    if (problem) {
      error.textContent = problem;
      return;
    }
    const opened =
      r.ok && r.data.ok ? r.data.events.find((ev) => ev.type === "table_opened") : undefined;
    // Going to the table closes the sheet and takes its place in history; closing it first would
    // step back while the new page goes on.
    if (opened?.type === "table_opened") navigate(`/games/${opened.table}`);
    else closeOverlay(s.dialog);
  });
  openOverlay(s.dialog);
}

// ---------- /games/:id ----------

export function tableView(id: string, ctx: ViewContext): View {
  ctx.setTitle("Game · Terrakin");
  const body = h("div", { class: "stack cards game-body" });
  const el = h("div", { class: "column stack cards page game-page" }, body);
  let destroyed = false;
  let table: TableView | undefined;
  let busy = false;
  /** How far the server's clock is ahead of this device's, from the last answer. */
  let skew = 0;
  const clock = h("span", { class: "game-clock", attrs: { "aria-live": "off" } });
  let decideSheet: HTMLDialogElement | undefined;

  /** Send one action from a button, then show the table as the server has it now. */
  const act = async (button: HTMLButtonElement, action: Action, done: string) => {
    busy = true;
    const ok = await actFromButton(button, action, done, { gone: () => destroyed, after: load });
    busy = false;
    return ok;
  };

  /** The seats, with their scores, who has chosen, and how it ended. */
  function seatRows(t: TableView): HTMLElement {
    return h(
      "ol",
      { class: "stack tight plain-list game-seats" },
      ...t.seats.map((s) => {
        const state =
          t.status === "over"
            ? s.place === null
              ? ""
              : `${ordinal(s.place)}${s.rating ? `, rating ${s.rating.rating.toLocaleString("en-US")} (${s.rating.change >= 0 ? "+" : ""}${s.rating.change})` : ""}`
            : s.away
              ? "Away: the server plays for them"
              : t.status === "playing"
                ? s.decided
                  ? "Decided"
                  : "Thinking"
                : "";
        return h(
          "li",
          {
            class: `game-seat${s.decided ? " decided" : ""}${s.away ? " away" : ""}`,
            attrs: { "data-seat": s.resident.id },
          },
          personLink(s.resident),
          h(
            "span",
            { class: "game-seat-facts" },
            h("span", { class: "game-score", text: scoreWords(t.game, s.score) }),
            state ? h("span", { class: "game-seat-state", text: state }) : null,
            s.rated
              ? h("span", { class: "game-seat-state counts", text: "rated" })
              : s.tally
                ? h("span", { class: "game-seat-state counts", text: "people against AIs" })
                : null,
          ),
        );
      }),
    );
  }

  /** What the last round gave each seat, now that every choice is out. */
  function lastRound(t: TableView): HTMLElement | null {
    const round = t.last;
    if (!round) return null;
    return h(
      "section",
      { class: "stack paper card game-reveal", attrs: { "aria-labelledby": "reveal-title" } },
      h("h2", {
        class: "card-title",
        attrs: { id: "reveal-title" },
        text: `Round ${round.round}: every choice`,
      }),
      h(
        "ul",
        { class: "stack tight plain-list" },
        ...t.seats.map((s) =>
          h(
            "li",
            { class: "game-pick", attrs: { "data-pick": s.resident.id } },
            h("span", { class: "game-pick-name", text: s.resident.name }),
            h("span", { text: pickWords(t.game, round, s.resident.id) }),
          ),
        ),
      ),
    );
  }

  /**
   * The panel with what you can do: sit, stand, start, decide, or just watch. None once it's over:
   * the header says who won.
   */
  function controls(t: TableView): HTMLElement | null {
    if (t.status === "over") return null;
    const you = t.you;
    const moves = you?.moves ?? [];
    const buttons: HTMLElement[] = [];
    const button = (
      text: string,
      cls: string,
      idAttr: string,
      go: (b: HTMLButtonElement) => void,
    ) =>
      h("button", {
        class: cls,
        attrs: { type: "button", id: idAttr },
        text,
        on: { click: (e) => go(e.currentTarget as HTMLButtonElement) },
      });
    if (moves.includes("decide")) {
      buttons.push(
        button("Your move", "btn-primary game-decide", "game-decide", () => openDecide(t)),
      );
    }
    if (moves.includes("start_game")) {
      buttons.push(
        button(
          "Start the game",
          "btn-primary",
          "game-start",
          (b) => void act(b, { type: "start_game", table: t.id }, "Started. Round 1 is open."),
        ),
      );
    }
    if (moves.includes("sit")) {
      buttons.push(
        button(
          "Sit down",
          "btn-primary",
          "game-sit",
          (b) => void act(b, { type: "sit", table: t.id }, "You sat down."),
        ),
      );
    }
    if (moves.includes("stand")) {
      buttons.push(
        button(
          "Stand up",
          "pill-button",
          "game-stand",
          (b) => void act(b, { type: "stand", table: t.id }, "You stood up."),
        ),
      );
    }
    const line =
      t.status === "playing"
        ? you?.sealed !== null && you?.sealed !== undefined
          ? `You picked ${moveLabel(t.game, you.sealed)}. It stays sealed until the round closes.`
          : you?.seated
            ? "Choose before the round closes, or the server plays the default for you."
            : "Watching. Choices show when each round closes."
        : `${t.seats.length} sat so far. The first seat starts it once enough have sat, and ${plural(GAME_TIMES.startGraceMinutes[t.pace], "minute", "minutes")} later anyone seated can.${you?.why ? ` ${you.why}` : ""}`;
    return h(
      "section",
      { class: "stack paper card game-panel", attrs: { "aria-label": "Your seat" } },
      t.status === "playing"
        ? h("p", { class: "game-round" }, h("strong", { text: roundWords(t) }), " ", clock)
        : null,
      h("p", { class: "game-line", attrs: { id: "game-line" }, text: line }),
      buttons.length > 0 ? h("div", { class: "cluster game-actions" }, ...buttons) : null,
    );
  }

  /** The decide sheet: one big button for each legal move. */
  function openDecide(t: TableView) {
    const legal = t.you?.legal ?? [];
    const round = t.round;
    const grid = h("div", {
      class: `stack decide-grid ${t.game === "hearth_race" ? "few" : "many"}`,
      attrs: { role: "group", "aria-label": "Your choice" },
    });
    const s = sheet(
      {
        id: "decide-title",
        title: `${roundWords(t)}: your move`,
        lede:
          t.game === "hearth_race"
            ? "How many steps? A pick someone else makes too moves nobody."
            : "Which number? The lowest one nobody else picks scores.",
        className: "decide-sheet",
        closeOnBackdrop: true,
      },
      grid,
    );
    for (const move of legal) {
      grid.append(
        h("button", {
          class: "decide-move",
          attrs: { type: "button", "data-move": String(move) },
          text: moveLabel(t.game, move),
          on: {
            click: async (e) => {
              const b = e.currentTarget as HTMLButtonElement;
              const picked = `You picked ${moveLabel(t.game, move)}. Sealed until the round closes.`;
              await act(b, { type: "decide", table: t.id, round, move }, picked);
              if (overlayShowing(s.dialog)) closeOverlay(s.dialog);
            },
          },
        }),
      );
    }
    decideSheet = s.dialog;
    openOverlay(s.dialog, () => {
      decideSheet = undefined;
      // Loads while it was up left the page as it was; show the newest now.
      if (table && !destroyed) paint(table);
    });
  }

  function tickClock() {
    const t = table;
    if (!t?.closesAt) return;
    clock.textContent = timeLeftWords(Date.parse(t.closesAt) - (Date.now() + skew));
  }

  function paint(t: TableView) {
    ctx.setTitle(`${gameName(t.game)} · Terrakin`);
    const parts = [
      h(
        "section",
        { class: "stack paper card game-top", attrs: { "aria-labelledby": "game-title" } },
        h("h1", { class: "page-title", attrs: { id: "game-title" }, text: gameName(t.game) }),
        tableHead(t, false),
        h("p", { class: "town-lede", text: GAME_ABOUT[t.game] }),
        h("p", { class: "purse-hint", text: PACE_WORDS[t.pace] }),
      ),
      controls(t),
      lastRound(t),
      h("h2", { class: "section-title", text: "Seats" }),
      seatRows(t),
      t.status !== "open" && !t.seats.some((x) => x.rated)
        ? h("p", {
            class: "purse-hint",
            text: t.seats.some((x) => x.tally)
              ? "This game moves nobody's rating. It counts only for people against AIs."
              : "This game moves nobody's rating: it's for fun.",
          })
        : null,
      t.salt
        ? h("p", {
            class: "purse-hint game-salt",
            text: `This table's salt was ${t.salt}. It kept the world's hash from giving choices away while they were sealed.`,
          })
        : null,
      h(
        "a",
        { class: "pill-button", attrs: { href: "/games" } },
        icon("back"),
        h("span", { text: "All games" }),
      ),
    ];
    body.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
    tickClock();
  }

  async function load(): Promise<void> {
    const r = await api.game(id);
    if (destroyed) return;
    if (!r.ok) {
      if (r.status === 404) {
        body.replaceChildren(
          notFoundCard(
            "That table is gone",
            "It closed before it started, or it finished long enough ago that the town forgot it. GET /games has the tables now.",
          ),
        );
        return;
      }
      body.replaceChildren(errorCard(r.message, () => void load()));
      return;
    }
    const was = table;
    table = r.data.table;
    skew = Date.parse(r.data.now) - Date.now();
    // A new round closes the sheet for the old one.
    if (decideSheet && was && was.round !== table.round) closeOverlay(decideSheet);
    if (!decideSheet) paint(table);
  }

  const ready = load();
  let lastPoll = 0;
  const stopClock = everyVisible(1_000, () => {
    tickClock();
    const t = table;
    if (!t || t.status === "over" || busy) return;
    const every = t.pace === "live" ? LIVE_MS : CALM_MS;
    if (Date.now() - lastPoll < every) return;
    lastPoll = Date.now();
    void load();
  });
  return {
    el,
    ready,
    destroy() {
      destroyed = true;
      stopClock();
      if (decideSheet) closeOverlay(decideSheet);
    },
  };
}
