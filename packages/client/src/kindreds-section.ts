/**
 * The Town Hall's Kindreds section (RFC 0033), at `/town#kindreds`: yours first, the invites you
 * hold, then the formed kindreds as rows that open each one's page, and a way to found one. Nothing
 * shows until the server says kindreds are open in this world. Names are residents' words: text
 * nodes only.
 */
import type { KindredSummary, KindredsResponse } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import {
  disclosure,
  emptyNote,
  errorLine,
  itemRow,
  itemRows,
  kindPill,
  toast,
  whileBusy,
} from "@terrakin/ui/ui";
import { kindredsApi } from "./api/kindreds";
import { actProblem, worldApi } from "./api/world";
import { repaintKeepingFocus } from "./job-parts";
import { foundingLine, inviteLine, inviteOpenLine, statusWords, summaryLine } from "./kindreds";
import { coins } from "./purse";

export interface KindredsSection {
  /** The section's heading and its card, for the page's main column once kindreds are open. */
  els: HTMLElement[];
  /** Read the kindreds and draw them again if anything changed. */
  refresh(): Promise<void>;
}

/** A kindred as a row that opens its page. */
function kindredRow(k: KindredSummary, mine: boolean): HTMLLIElement {
  return itemRow({
    className: "kindred-row",
    attrs: { "data-kindred": k.id },
    lead: h("span", { class: "purse-line-mark", attrs: { "aria-hidden": "true" } }, icon("follow")),
    name: k.name,
    lines: [summaryLine(k)],
    trail: h(
      "a",
      { class: "pill-button small", attrs: { href: `/k/${k.id}` } },
      h("span", { text: mine ? "Yours" : "Open" }),
      ...(mine ? [] : [icon("arrow")]),
    ),
  });
}

export function kindredsSection(o: {
  gone: () => boolean;
  navigate: (path: string) => void;
}): KindredsSection {
  const title = h("h2", {
    class: "section-title",
    attrs: { id: "kindreds", hidden: true },
    text: "Kindreds",
  });
  const card = h("section", {
    class: "stack paper card kindreds-card",
    attrs: { "aria-labelledby": "kindreds", hidden: true, tabindex: -1 },
  });
  let painted = "";
  let landed = false;

  async function refresh() {
    const r = await kindredsApi.kindreds();
    if (o.gone() || !r.ok) return;
    title.hidden = !r.data.open;
    card.hidden = !r.data.open;
    if (!r.data.open) return;
    // Only a change is drawn again, and never over a Found form someone has open, so a name being
    // typed stays put; the next read after it closes catches up.
    const next = JSON.stringify(r.data);
    const founding = card.querySelector("#kindred-found-form:not([hidden])") !== null;
    if (next !== painted && !founding) {
      painted = next;
      repaintKeepingFocus(card, () => paint(r.data));
    }
    // A link to the section lands on it once.
    if (!landed && location.hash === "#kindreds") {
      landed = true;
      requestAnimationFrame(() => title.scrollIntoView({ block: "start" }));
    }
  }

  function foundForm(data: KindredsResponse): HTMLElement | null {
    const you = data.you;
    if (!you || you.kindred) return null;
    if (!you.canFound) {
      // Short of coins only: say the cost against the purse and the way there (issue #69).
      const short = you.whyCode === "not_enough_coins";
      const text = short
        ? foundingLine(data.rules, you.balance)
        : (you.why ?? "You can't found one yet.");
      return h("p", { class: "hint kindred-why", text });
    }
    const open = h(
      "button",
      { class: "pill-button", attrs: { type: "button", id: "kindred-found-open" } },
      icon("follow"),
      h("span", { text: "Found a kindred" }),
    );
    const name = h("input", {
      class: "field-input",
      attrs: {
        id: "kindred-found-name",
        maxlength: data.rules.nameMax,
        placeholder: "Lantern Row",
        autocomplete: "off",
      },
    });
    const submit = h("button", {
      class: "btn-primary small",
      attrs: { type: "submit", id: "kindred-found" },
      text: `Found it for ${coins(data.rules.fee)}`,
    });
    const problem = errorLine("kindred-found-error");
    const panel = h(
      "form",
      { class: "stack tight", attrs: { hidden: true, novalidate: true, id: "kindred-found-form" } },
      h("label", { class: "field-label", attrs: { for: "kindred-found-name" }, text: "Its name" }),
      name,
      h("p", {
        class: "hint",
        text: `${foundingLine(data.rules, you.balance)} It forms once its members come from ${data.rules.formHouseholds} households. Found one with neighbors you already know.`,
      }),
      problem,
      submit,
    );
    disclosure(open, panel, name);
    panel.addEventListener("submit", async (e) => {
      e.preventDefault();
      const words = name.value.trim();
      if (!words) return name.focus();
      const r = await whileBusy(submit, () => worldApi.act({ type: "found_kindred", name: words }));
      if (o.gone()) return;
      const refused = actProblem(r);
      if (refused) {
        problem.textContent = refused;
        return;
      }
      toast("Founded. Invite neighbors from its page.");
      const made =
        r.ok && r.data.ok ? r.data.events.find((ev) => ev.type === "kindred_founded") : undefined;
      if (made && made.type === "kindred_founded") o.navigate(`/k/${made.kindred}`);
      else await refresh();
    });
    return h("div", { class: "stack tight" }, open, panel);
  }

  function paint(data: KindredsResponse) {
    const mine = data.you?.kindred ?? null;
    const others = data.kindreds.filter((k) => k.id !== mine?.id);
    const invites = data.you?.invites ?? [];
    card.replaceChildren(
      h("p", {
        class: "town-lede",
        text: "A kindred is a small group that meets once a week for a kindred night at one member's plot.",
      }),
      ...(mine
        ? [
            h(
              "p",
              { class: "cluster" },
              kindPill(statusWords(mine.status), mine.status === "formed" ? "moss" : "sun"),
              h("span", { text: "Your kindred" }),
            ),
            itemRows([kindredRow(mine, true)], { className: "kindred-rows mine" }),
          ]
        : []),
      ...(invites.length > 0
        ? [
            itemRows(
              invites.map((i) =>
                itemRow({
                  className: "kindred-invite-row",
                  attrs: { "data-kindred": i.kindred.id },
                  name: i.kindred.name,
                  // A note is said to be there, never quoted here: the kindred's page has it
                  // whole, beside what it's for and when the invite lapses (issue #73).
                  lines: [
                    inviteLine(i),
                    i.note === null
                      ? inviteOpenLine(i)
                      : `${inviteOpenLine(i)} · They wrote you a note.`,
                  ],
                  trail: h("a", {
                    class: "btn-primary small",
                    attrs: { href: `/k/${i.kindred.id}` },
                    text: "See it",
                  }),
                }),
              ),
              { className: "kindred-invites" },
            ),
          ]
        : []),
      others.length > 0
        ? itemRows(
            others.map((k) => kindredRow(k, false)),
            { className: "kindred-rows" },
          )
        : emptyNote("No kindreds yet", "Found the first with neighbors you know."),
      ...[foundForm(data)].filter((x): x is HTMLElement => x !== null),
    );
  }

  return { els: [title, card], refresh };
}
