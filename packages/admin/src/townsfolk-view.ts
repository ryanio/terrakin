/**
 * What the townsfolk are doing (decision 0114): chatter's state and today's calls, each townsfolk
 * resident's day, and the latest things they did, newest first, with the posts and residents they
 * touched. The model wrote the townsfolk's words and residents wrote the posts they answered, so
 * both go in as text.
 */
import type { TownsfolkActivityResponse } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { plural } from "@terrakin/ui/format";
import { postPath, profilePath } from "@terrakin/ui/paths";
import { personLink } from "@terrakin/ui/people";
import {
  itemRow,
  itemRows,
  kindPill,
  pageLayout,
  progressBar,
  stateCard,
  whileBusy,
} from "@terrakin/ui/ui";
import { timeAgo } from "@terrakin/ui/when";
import { api } from "./api";
import {
  ACTION_ICONS,
  activityLine,
  chatterState,
  dayLabel,
  gateWords,
  mainSite,
  modelName,
  participationLine,
  sinceWords,
  spendTodayWords,
  tipsLine,
  todayWords,
} from "./logic";
import { button, outLink, pageHead, quoted, statePill, type View } from "./view";

type Data = TownsfolkActivityResponse;

export function townsfolkView(): View {
  // How chatter is doing and each townsfolk resident beside what they said and did lately.
  const { el, head, main, side } = pageLayout("townsfolk-page", "Chatter today and the townsfolk");
  head.append(
    pageHead({
      id: "townsfolk-title",
      title: "Townsfolk",
      lede: "The founding townsfolk post, answer, react, praise, admire plots, and wave on their own a few times a day. Their words are the model's; the posts they answer are residents' own.",
    }),
  );
  let destroyed = false;
  const site = mainSite(location.origin);

  async function load() {
    const res = await api.townsfolk();
    if (destroyed) return;
    if (!res.ok) {
      // A missing sign-in is handled app-wide (SIGNED_OUT_EVENT).
      if (res.code === "unauthorized") return;
      side.replaceChildren();
      main.replaceChildren(
        stateCard({
          title: "Couldn't load the townsfolk",
          body: res.message,
          actions: [button("Try again", (b) => void whileBusy(b, load))],
        }),
      );
      return;
    }
    const painted = paint(res.data, site, load);
    side.replaceChildren(...painted.side);
    main.replaceChildren(...painted.main);
  }

  main.replaceChildren(
    h("p", { class: "field-hint", attrs: { role: "status" }, text: "Loading the townsfolk…" }),
  );
  void load();
  return {
    el,
    destroy() {
      destroyed = true;
    },
  };
}

function paint(
  data: Data,
  site: string,
  reload: () => Promise<void>,
): { side: HTMLElement[]; main: HTMLElement[] } {
  const now = Date.now();
  const { chatter } = data;
  const state = chatterState(chatter, now);
  const refresh = button("Refresh", (b) => void whileBusy(b, reload, "Refreshing…"));
  const chip = (text: string, title?: string) => {
    const pill = statePill(text);
    if (title) pill.title = title;
    return h("li", {}, pill);
  };
  const status = h(
    "section",
    {
      class: "paper card stack townsfolk-status",
      attrs: { "aria-labelledby": "townsfolk-status-title" },
    },
    h("h2", {
      class: "card-title",
      attrs: { id: "townsfolk-status-title" },
      text: "Chatter today",
    }),
    h(
      "ul",
      { class: "cluster plain-list" },
      chip(state),
      chatter.mode === "off" ? null : chip(gateWords(chatter)),
      chatter.mode !== "off" && chatter.mentions ? chip("Answers mentions") : null,
      chatter.mode === "off" ? null : chip(modelName(chatter.model)),
      chatter.lastRun
        ? chip(`Last run ${sinceWords(chatter.lastRun.at, now)}`, chatter.lastRun.result)
        : null,
    ),
    h(
      "div",
      { class: "stack tight" },
      h("p", {
        class: "field-hint townsfolk-calls",
        text: `${chatter.callsToday} of ${plural(chatter.callsPerDay, "call", "calls")} today`,
      }),
      progressBar(chatter.callsToday, chatter.callsPerDay, "Model calls today"),
    ),
    h(
      "div",
      { class: "stack tight" },
      h("p", { class: "field-hint", text: `Spend: ${spendTodayWords(chatter)}.` }),
      h("p", { class: "field-hint", text: tipsLine(data.tips) }),
      ...[participationLine(chatter.participation, 30)].map((line) =>
        line ? h("p", { class: "field-hint", text: line }) : null,
      ),
    ),
    h("div", { class: "cluster" }, refresh),
  );

  const people = h(
    "section",
    { class: "paper card stack townsfolk-people", attrs: { "aria-labelledby": "townsfolk-today" } },
    h("h2", { class: "card-title", attrs: { id: "townsfolk-today" }, text: "The townsfolk" }),
    data.townsfolk.length === 0
      ? h("p", {
          class: "field-hint",
          text: "No townsfolk are set up on this server (TERRAKIN_TOWNSFOLK).",
        })
      : itemRows(
          data.townsfolk.map((t) =>
            itemRow({
              plain: true,
              className: "townsfolk-person",
              name: personLink(t.resident, {
                href: site + profilePath(t.resident.id),
                newTab: true,
                picture: false,
                className: "townsfolk-name",
              }),
              lines: [
                t.resident.handle ? `@${t.resident.handle}` : null,
                h("span", { class: "townsfolk-today", text: todayWords(t.today) }),
                t.lastAt ? `Last active ${sinceWords(t.lastAt, now)}` : "Quiet so far",
              ],
            }),
          ),
          { className: "townsfolk-rows" },
        ),
  );

  const latest = h(
    "section",
    { class: "stack townsfolk-section", attrs: { "aria-labelledby": "townsfolk-latest" } },
    h("h2", { class: "section-title", attrs: { id: "townsfolk-latest" }, text: "Latest" }),
    ...(data.activity.length === 0
      ? [
          stateCard({
            title: "Nothing yet",
            body: "Townsfolk act on a cron every two hours while chatter is on.",
          }),
        ]
      : byDay(data.activity, now).map(({ day, entries }) =>
          h(
            "div",
            { class: "stack townsfolk-day" },
            h("h3", { class: "log-day", text: day }),
            h(
              "ol",
              { class: "plain-list stack townsfolk-feed" },
              ...entries.map((e) => entry(e, site)),
            ),
          ),
        )),
  );
  return { side: [status, people], main: [latest] };
}

function byDay(activity: Data["activity"], now: number) {
  const out: { day: string; entries: Data["activity"] }[] = [];
  for (const e of activity) {
    const day = dayLabel(e.at, now);
    const last = out.at(-1);
    if (last?.day === day) last.entries.push(e);
    else out.push({ day, entries: [e] });
  }
  return out;
}

function entry(e: Data["activity"][number], site: string): HTMLElement {
  const answered = e.action !== "post" ? e.post : null;
  const link = e.post
    ? outLink(
        `${site}${postPath(e.post.id)}`,
        e.action === "post" ? "Open the post" : "Open what they answered",
      )
    : e.resident
      ? outLink(`${site}${profilePath(e.resident.id)}`, `Open ${e.resident.name}'s profile`)
      : null;
  return h(
    "li",
    { class: `paper card stack tight townsfolk-entry action-${e.action}` },
    h(
      "div",
      { class: "townsfolk-entry-head" },
      h("span", { class: `townsfolk-icon action-${e.action}` }, icon(ACTION_ICONS[e.action])),
      h(
        "p",
        { class: "townsfolk-line" },
        personLink(e.by, {
          href: site + profilePath(e.by.id),
          newTab: true,
          picture: false,
          badges: false,
          className: "townsfolk-by",
        }),
        " ",
        activityLine(e),
      ),
      timeAgo(e.at, { className: "townsfolk-time" }),
      e.live || e.mention
        ? h(
            "span",
            { class: "cluster townsfolk-tags" },
            e.live ? null : kindPill("Draft", "sun"),
            e.mention ? kindPill("Mention", "ink") : null,
          )
        : null,
    ),
    e.text ? h("p", { class: "townsfolk-words", text: e.text }) : null,
    answered ? quoted(answered.text) : null,
    link ? h("p", { class: "townsfolk-link" }, link) : null,
  );
}
