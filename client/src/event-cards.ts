/**
 * Hosted events on the page (RFC 0010): one row per event (on the Town Hall board and the home
 * wall), the Happening now card, and the Schedule sheet. Titles, texts, and names are other
 * residents' words: textContent only. The server decides what can be scheduled, joined, or called
 * off; these send its actions and show its answers.
 */
import type { EventsResponse, EventView } from "@terrakin/protocol";
import { EVENT_KINDS, type EventKind } from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { personLink } from "@terrakin/ui/people";
import {
  chips,
  closeOverlay,
  confirmTwice,
  errorLine,
  kindPill,
  openOverlay,
  overlayShowing,
  sheet,
  toast,
  whileBusy,
} from "@terrakin/ui/ui";
import { actProblem, api } from "./api";
import {
  defaultStart,
  fromLocalInput,
  KIND_WORDS,
  LENGTHS,
  lengthWords,
  placeWords,
  soonWords,
  toLocalInput,
  whenWords,
} from "./event-format";
import { coins } from "./purse";
import { reportMenu } from "./report-sheet";

const MINUTE = 60_000;

export interface EventRowOptions {
  /** The server's time, from the answer the event came in. */
  now: number;
  /** The viewer, when signed in. */
  me: string | undefined;
  navigate: (path: string) => void;
  /** After a change the server accepted: going, or calling one off. */
  changed: () => void;
  /** Leave out the text, for the home wall. */
  compact?: boolean;
}

/** Go to an event that's on: one `join_event`, then the world. */
async function goTo(e: EventView, button: HTMLButtonElement, o: EventRowOptions) {
  const r = await whileBusy(button, () => api.act({ type: "join_event", event: e.id }));
  const problem = actProblem(r);
  if (problem) return toast(problem);
  o.navigate("/world");
}

/** One event: what, when, where, who's hosting, and what you can do about it. */
export function eventRow(e: EventView, o: EventRowOptions): HTMLLIElement {
  const live = e.status === "live";
  const when = live
    ? h(
        "span",
        { class: "event-live" },
        h("span", { class: "live-dot", attrs: { "aria-hidden": "true" } }),
        soonWords(e, o.now),
      )
    : h("span", { class: "event-when", text: whenWords(e.startsAt, o.now) });
  const host = e.host
    ? personLink(e.host)
    : h("span", { class: "event-town" }, icon("town"), h("span", { text: "The town" }));
  const actions = h("div", { class: "cluster event-actions" });
  if (o.me && e.moves.includes("join_event")) {
    const go = h(
      "button",
      { class: "btn-primary small event-go", attrs: { type: "button" } },
      h("span", { text: "Go" }),
      icon("arrow"),
    );
    go.addEventListener("click", () => void goTo(e, go, o));
    actions.append(go);
  }
  if (o.me && e.status === "scheduled" && e.host?.id !== o.me) {
    const label = e.youreGoing ? "Going" : "I'm going";
    const going = h(
      "button",
      {
        class: "pill-button small event-going-toggle",
        attrs: { type: "button", "aria-pressed": String(e.youreGoing) },
      },
      ...(e.youreGoing ? [icon("check")] : []),
      h("span", { text: label }),
    );
    going.addEventListener("click", async () => {
      const r = await whileBusy(going, () => api.going(e.id, !e.youreGoing));
      if (!r.ok) return toast(r.message);
      o.changed();
    });
    actions.append(going);
  }
  if (e.going > 0) {
    actions.append(h("span", { class: "event-count", text: `${e.going} going` }));
  }
  if (o.me && e.moves.includes("cancel_event")) {
    const label = "Call it off";
    const off = h("button", { class: "text-button", attrs: { type: "button" }, text: label });
    confirmTwice(off, "Tap again to call it off", async () => {
      const r = await whileBusy(off, () => api.act({ type: "cancel_event", event: e.id }));
      off.textContent = label;
      const problem = actProblem(r);
      if (problem) return toast(problem);
      toast("Called off");
      o.changed();
    });
    actions.append(off);
  }
  if (o.me && e.host && e.host.id !== o.me) {
    actions.append(
      reportMenu(
        { kind: "event", id: e.id, label: "event" },
        { id: `event-more-${e.id}`, text: "Report this event" },
      ),
    );
  }
  return h(
    "li",
    { class: `stack tight event-row${live ? " is-live" : ""}`, attrs: { "data-event": e.id } },
    h(
      "p",
      { class: "cluster event-meta" },
      kindPill(KIND_WORDS[e.kind], "sun", "event-kind"),
      when,
    ),
    h("p", { class: "event-title", text: e.title }),
    o.compact || !e.text ? null : h("p", { class: "event-text", text: e.text }),
    h(
      "p",
      { class: "cluster event-by" },
      host,
      h("span", { text: `${placeWords(e)} · ${lengthWords(e.minutes)}` }),
    ),
    actions.childElementCount > 0 ? actions : null,
  );
}

// ---------- the home wall ----------

/**
 * The home wall's events card: what's on now, each with a Go button, or, when nothing is, the
 * next few to come. Hidden while the calendar is empty.
 */
export function happeningCard(navigate: (path: string) => void, me: () => string | undefined) {
  const eyebrow = h("p", { class: "eyebrow pulse-eyebrow" });
  const title = h("h2", { class: "pulse-title" });
  const list = h("ol", { class: "stack plain-list event-list" });
  const el = h(
    "article",
    {
      class: "pulse paper card pulse-events",
      attrs: { "aria-label": "Events", hidden: true, id: "happening-now" },
    },
    eyebrow,
    title,
    list,
    h(
      "a",
      { class: "text-link", attrs: { href: "/town#events" } },
      h("span", { text: "See the calendar" }),
      icon("arrow"),
    ),
  );
  let last: { events: { live: EventView[]; upcoming: EventView[] }; now: number } | undefined;
  const paint = () => {
    if (!last) return;
    const { live, upcoming } = last.events;
    const shown = live.length > 0 ? live : upcoming.slice(0, 2);
    el.hidden = shown.length === 0;
    el.classList.toggle("is-live", live.length > 0);
    eyebrow.replaceChildren(
      live.length > 0
        ? h("span", { class: "live-dot", attrs: { "aria-hidden": "true" } })
        : icon("calendar", "icon pulse-icon"),
      live.length > 0 ? "Happening now" : "Coming up",
    );
    title.textContent =
      live.length > 0
        ? live.length === 1
          ? "An event is on"
          : `${live.length} events are on`
        : "On the calendar";
    list.replaceChildren(
      ...shown.map((e) =>
        eventRow(e, {
          now: last?.now ?? Date.now(),
          me: me(),
          navigate,
          compact: true,
          changed: () => void refresh(),
        }),
      ),
    );
  };
  async function refresh() {
    const r = await api.events();
    if (!r.ok) return;
    last = { events: r.data, now: Date.parse(r.data.now) };
    paint();
  }
  return {
    el,
    /** From the Town Hall's answer, which the wall already polls. */
    update(events: { live: EventView[]; upcoming: EventView[] }, now: number) {
      last = { events, now };
      paint();
    },
  };
}

// ---------- the Schedule sheet ----------

export interface ScheduleOptions {
  /** `GET /v1/events`, read just now: the server's time, the rules, and where you can host. */
  events: EventsResponse;
  /** Where the Commons is, from the world. */
  commons: { px: number; py: number };
  /** After the server put it on the calendar. */
  done: () => void;
  /** However the sheet closed. */
  closed?: () => void;
}

/** "Your plot", or the plot's place for a second one, for the Where chips. */
const plotWords = (i: number) => (i === 0 ? "Your plot" : `Your plot ${i + 1}`);

/** The Schedule sheet: kind, words, when, how long, and where. */
export function openScheduleSheet(o: ScheduleOptions) {
  const { rules, you } = o.events;
  const now = Date.parse(o.events.now);
  let kind: EventKind = "listening";
  let minutes: number = LENGTHS[1];
  const places = [
    ...(you?.plots ?? []).map((p, i) => ({ key: `${p.px},${p.py}`, label: plotWords(i), ...p })),
    { key: "commons", label: "The Commons", ...o.commons },
  ];
  let place = places[0]?.key ?? "commons";

  const titleInput = h("input", {
    class: "sheet-input",
    attrs: {
      id: "event-title",
      maxlength: rules.titleMax,
      placeholder: "Sunday records",
      autocomplete: "off",
      enterkeyhint: "next",
    },
  });
  const textInput = h("textarea", {
    class: "sheet-input sheet-text",
    attrs: {
      id: "event-text",
      maxlength: rules.textMax,
      rows: 3,
      placeholder: "What's happening, and what to bring",
    },
  });
  const startInput = h("input", {
    class: "sheet-input",
    attrs: {
      id: "event-start",
      type: "datetime-local",
      min: toLocalInput(now + rules.leadMinutes * MINUTE),
      max: toLocalInput(now + rules.aheadDays * 24 * 60 * MINUTE),
      step: 60,
    },
  });
  startInput.value = toLocalInput(defaultStart(now));
  const deposit = h("p", {
    class: "sheet-note event-deposit",
    text: `The Commons holds a ${rules.deposit}-coin deposit until it's over. It comes back when ${rules.refundAt} or more come, or if you call it off before its day.${typeof you?.balance === "number" ? ` You have ${coins(you.balance)}.` : ""}`,
  });
  deposit.hidden = place !== "commons";
  const error = errorLine();

  const kinds = chips<EventKind>(
    EVENT_KINDS,
    kind,
    (v) => [h("span", { text: KIND_WORDS[v] })],
    (v) => {
      kind = v;
    },
    h("div", { class: "kind-row", attrs: { "aria-label": "Kind of event" } }),
  ).row;
  const lengths = chips<string>(
    LENGTHS.map(String),
    String(minutes),
    (v) => [h("span", { text: lengthWords(Number(v)) })],
    (v) => {
      minutes = Number(v);
    },
    h("div", { class: "kind-row event-lengths", attrs: { "aria-label": "How long" } }),
  ).row;
  const where = chips<string>(
    places.map((p) => p.key),
    place,
    (v) => [h("span", { text: places.find((p) => p.key === v)?.label ?? v })],
    (v) => {
      place = v;
      deposit.hidden = place !== "commons";
    },
    h("div", { class: "kind-row event-places", attrs: { "aria-label": "Where" } }),
  ).row;

  const submit = h(
    "button",
    { class: "btn-primary", attrs: { type: "submit", id: "event-submit" } },
    icon("calendar"),
    h("span", { text: "Put it on the calendar" }),
  );
  const form = h(
    "form",
    { class: "sheet-body", attrs: { novalidate: true } },
    kinds,
    h("label", { class: "field-label", attrs: { for: "event-title" }, text: "Title" }),
    titleInput,
    h("label", { class: "field-label", attrs: { for: "event-text" }, text: "Details" }),
    textInput,
    h("label", { class: "field-label", attrs: { for: "event-start" }, text: "Starts" }),
    startInput,
    h("p", {
      class: "sheet-note",
      text: `Your own time. At least an hour from now, up to ${rules.aheadDays} days ahead.`,
    }),
    h("p", { class: "field-label", text: "How long" }),
    lengths,
    h("p", { class: "field-label", text: "Where" }),
    where,
    deposit,
    h("p", {
      class: "sheet-note",
      text: "It goes on the Town Hall board. While it's on, people come with one tap, and those who stay a while count as your guests.",
    }),
    error,
    submit,
  );
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      error.textContent = "Give it a title.";
      titleInput.focus();
      return;
    }
    const startsAt = fromLocalInput(startInput.value);
    if (!Number.isFinite(startsAt)) {
      error.textContent = "Pick a day and a time.";
      startInput.focus();
      return;
    }
    const at = places.find((p) => p.key === place) ?? places[0];
    if (!at) return;
    const r = await whileBusy(submit, () =>
      api.act({
        type: "schedule_event",
        kind,
        title,
        ...(textInput.value.trim() ? { text: textInput.value.trim() } : {}),
        px: at.px,
        py: at.py,
        startsAt: new Date(startsAt).toISOString(),
        minutes,
      }),
    );
    const problem = actProblem(r);
    if (problem) {
      if (overlayShowing(dialog)) error.textContent = problem;
      else toast(problem);
      return;
    }
    closeOverlay(dialog);
    toast("It's on the calendar");
    o.done();
  });
  const { dialog } = sheet(
    {
      id: "schedule-sheet-title",
      title: "Host an event",
      className: "schedule-sheet",
      lede: "A show, a class, a market, a listening session, or a gathering. The town sees it on the board.",
      closeOnBackdrop: true,
    },
    form,
  );
  openOverlay(dialog, () => o.closed?.());
  titleInput.focus();
}
