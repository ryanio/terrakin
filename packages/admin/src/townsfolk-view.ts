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
import { stateCard, whileBusy } from "@terrakin/ui/ui";
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
  saidLine,
  sinceWords,
  spendTodayWords,
  tipsLine,
  todayWords,
} from "./logic";
import { button, outLink, quoted, type View } from "./view";

type Data = TownsfolkActivityResponse;

export function townsfolkView(): View {
  const body = h("div", { class: "stack townsfolk" });
  const el = h(
    "div",
    { class: "stack townsfolk-page" },
    h(
      "section",
      { class: "paper card hero", attrs: { "aria-labelledby": "townsfolk-title" } },
      h("h1", { class: "state-title", attrs: { id: "townsfolk-title" }, text: "Townsfolk" }),
      h("p", {
        class: "hero-order",
        text: "The founding townsfolk post, answer, react, praise, admire plots, and wave on their own a few times a day. Their words are the model's; the posts they answer are residents' own.",
      }),
    ),
    body,
  );
  let destroyed = false;
  const site = mainSite(location.origin);

  async function load() {
    const res = await api.townsfolk();
    if (destroyed) return;
    if (!res.ok) {
      // A missing sign-in is handled app-wide (SIGNED_OUT_EVENT).
      if (res.code === "unauthorized") return;
      body.replaceChildren(
        stateCard({
          title: "Couldn't load the townsfolk",
          body: res.message,
          actions: [button("Try again", (b) => void whileBusy(b, load))],
        }),
      );
      return;
    }
    body.replaceChildren(...paint(res.data, site, load));
  }

  body.replaceChildren(
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

function paint(data: Data, site: string, reload: () => Promise<void>): HTMLElement[] {
  const now = Date.now();
  const { chatter } = data;
  const state = chatterState(chatter, now);
  const share = chatter.callsPerDay > 0 ? Math.min(1, chatter.callsToday / chatter.callsPerDay) : 0;
  const refresh = button("Refresh", (b) => void whileBusy(b, reload, "Refreshing…"));
  const status = h(
    "section",
    { class: "paper card stack tight townsfolk-status", attrs: { "aria-label": "Chatter today" } },
    h(
      "ul",
      { class: "cluster plain-list townsfolk-chips" },
      h("li", {
        class: `townsfolk-chip state-${state.toLowerCase().replace(" ", "-")}`,
        text: state,
      }),
      chatter.mode === "off"
        ? null
        : h("li", { class: "townsfolk-chip", text: gateWords(chatter) }),
      chatter.mode !== "off" && chatter.mentions
        ? h("li", { class: "townsfolk-chip", text: "Answers mentions" })
        : null,
      chatter.mode === "off"
        ? null
        : h("li", { class: "townsfolk-chip", text: modelName(chatter.model) }),
      chatter.lastRun
        ? h("li", {
            class: "townsfolk-chip",
            text: `Last run ${sinceWords(chatter.lastRun.at, now)}`,
            attrs: { title: chatter.lastRun.result },
          })
        : null,
    ),
    h(
      "div",
      { class: "townsfolk-meter" },
      h("span", {
        class: "townsfolk-meter-label",
        text: `${chatter.callsToday} of ${plural(chatter.callsPerDay, "call", "calls")} today`,
      }),
      h(
        "span",
        {
          class: "townsfolk-meter-track",
          attrs: {
            role: "meter",
            "aria-valuemin": "0",
            "aria-valuemax": String(chatter.callsPerDay),
            "aria-valuenow": String(chatter.callsToday),
            "aria-label": "Model calls today",
          },
        },
        meterFill(share),
      ),
    ),
    h("p", { class: "triage-status", text: `Spend: ${spendTodayWords(chatter)}.` }),
    h("p", { class: "triage-status", text: tipsLine(data.tips) }),
    ...[participationLine(chatter.participation, 30)].map((line) =>
      line ? h("p", { class: "triage-status", text: line }) : null,
    ),
    h("div", { class: "townsfolk-refresh" }, refresh),
  );

  const people = h(
    "section",
    { class: "stack townsfolk-section", attrs: { "aria-labelledby": "townsfolk-today" } },
    h("h2", { class: "section-title", attrs: { id: "townsfolk-today" }, text: "The townsfolk" }),
    data.townsfolk.length === 0
      ? h("p", {
          class: "field-hint",
          text: "No townsfolk are set up on this server (TERRAKIN_TOWNSFOLK).",
        })
      : h(
          "ul",
          { class: "plain-list townsfolk-grid" },
          ...data.townsfolk.map((t) =>
            h(
              "li",
              { class: "paper card townsfolk-person" },
              h(
                "div",
                { class: "townsfolk-person-text" },
                personLink(t.resident, {
                  href: site + profilePath(t.resident.id),
                  newTab: true,
                  picture: false,
                  size: "md",
                  className: "townsfolk-name",
                }),
                t.resident.handle
                  ? h("span", { class: "townsfolk-handle", text: `@${t.resident.handle}` })
                  : null,
                h("span", { class: "townsfolk-today", text: todayWords(t.today) }),
                h("span", {
                  class: "townsfolk-last",
                  text: t.lastAt ? `Last active ${sinceWords(t.lastAt, now)}` : "Quiet so far",
                }),
              ),
            ),
          ),
        ),
  );

  const latest = h(
    "section",
    { class: "stack townsfolk-section", attrs: { "aria-labelledby": "townsfolk-latest" } },
    h("h2", { class: "section-title", attrs: { id: "townsfolk-latest" }, text: "Latest" }),
    ...(data.activity.length === 0
      ? [
          h("p", {
            class: "field-hint",
            text: "Nothing yet. Townsfolk act on a cron every two hours while chatter is on.",
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
  const compare = compareSection(data, site, now);
  return compare ? [status, people, compare, latest] : [status, people, latest];
}

/**
 * The same prompt answered by the chatter model and the compare model, side by side, so staff can
 * judge whether the townsfolk sound right. Both models' words go in as text.
 */
function compareSection(data: Data, site: string, now: number): HTMLElement | null {
  const { chatter } = data;
  if ((chatter.mode === "off" || chatter.compare === 0) && data.compare.length === 0) return null;
  const first = data.compare[0];
  const title = first
    ? `${modelName(first.first.model)} and ${modelName(first.second.model)}`
    : "Side by side";
  return h(
    "section",
    { class: "stack townsfolk-section", attrs: { "aria-labelledby": "townsfolk-compare" } },
    h("h2", { class: "section-title", attrs: { id: "townsfolk-compare" }, text: title }),
    h("p", {
      class: "field-hint",
      text: `A few calls a day (${chatter.comparedToday} of ${chatter.compare} today) also ask a second model the same thing. Only the first one's answer goes out.`,
    }),
    data.compare.length === 0
      ? h("p", { class: "field-hint", text: "No pairs yet." })
      : h(
          "ol",
          { class: "plain-list stack townsfolk-feed" },
          ...data.compare.map((pair) =>
            h(
              "li",
              { class: "paper card stack tight townsfolk-pair-card" },
              h(
                "div",
                { class: "townsfolk-pair-head" },
                personLink(pair.by, {
                  href: site + profilePath(pair.by.id),
                  newTab: true,
                  picture: false,
                  badges: false,
                  className: "townsfolk-by",
                }),
                pair.kind === "mention" ? h("span", { class: "item-chip", text: "Mention" }) : null,
                h("span", { class: "townsfolk-time", text: sinceWords(pair.at, now) }),
              ),
              h(
                "div",
                { class: "townsfolk-pair" },
                saidCard(pair.first, "Went out", site),
                saidCard(pair.second, "Draft only", site),
              ),
            ),
          ),
        ),
  );
}

function saidCard(
  said: Data["compare"][number]["first"],
  label: string,
  site: string,
): HTMLElement {
  const named = said.post
    ? outLink(`${site}${postPath(said.post.id)}`, "Open the post it named")
    : said.resident
      ? outLink(`${site}${profilePath(said.resident.id)}`, `Open ${said.resident.name}'s profile`)
      : null;
  return h(
    "div",
    { class: "stack tight townsfolk-said" },
    h(
      "p",
      { class: "townsfolk-said-head" },
      h("strong", { text: modelName(said.model) }),
      h("span", { class: "townsfolk-said-label", text: label }),
    ),
    h("p", { class: "townsfolk-line", text: saidLine(said) }),
    said.text ? h("p", { class: "townsfolk-words", text: said.text }) : null,
    named ? h("p", { class: "townsfolk-link" }, named) : null,
  );
}

/** The meter's fill, sized with a class per tenth, since the admin host allows no inline styles. */
function meterFill(share: number): HTMLElement {
  return h("span", { class: `townsfolk-meter-fill fill-${Math.round(share * 10)}` });
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
      e.live ? null : h("span", { class: "item-chip", text: "Draft" }),
      e.mention ? h("span", { class: "item-chip", text: "Mention" }) : null,
    ),
    e.text ? h("p", { class: "townsfolk-words", text: e.text }) : null,
    answered ? quoted(answered.text) : null,
    link ? h("p", { class: "townsfolk-link" }, link) : null,
  );
}
