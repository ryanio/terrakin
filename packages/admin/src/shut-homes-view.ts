/**
 * The queue's Shut homes card (decision 0343): every hearth with no walk to its shop counter, its
 * resident, and the blocks whose clearing alone would open a way, the cheapest to their owner
 * first (`freesByCost`). Every staff role sees the list. A maintainer's Clear on a block sends a
 * dry run and shows its answer (`clearWords`); Clear it, with a reason and two taps, takes the
 * block off for real. Names are residents' words, so they go in as text.
 */
import type { ShutHomesResponse, StaffRole } from "@terrakin/protocol";
import { clearCost } from "@terrakin/ui/blocks";
import { h } from "@terrakin/ui/dom";
import { profilePath } from "@terrakin/ui/paths";
import { personLink } from "@terrakin/ui/people";
import {
  confirmTwice,
  itemRow,
  itemRows,
  kindPill,
  type PillTone,
  toast,
  whileBusy,
  whileBusyAll,
} from "@terrakin/ui/ui";
import { api } from "./api";
import {
  CLEAR_CHECK_REASON,
  CLEAR_COST_WORDS,
  clearWords,
  freeLine,
  freesByCost,
  mainSite,
  reasonProblem,
} from "./logic";
import { button } from "./view";

type Home = ShutHomesResponse["homes"][number];

const COST_TONES: readonly PillTone[] = ["moss", "sun", "clay"];

export function shutHomesCard(role: StaffRole, isGone: () => boolean): HTMLElement {
  const site = mainSite(location.origin);
  const maintainer = role === "maintainer";
  const list = h(
    "div",
    { class: "stack shut-homes-list" },
    h("p", { class: "field-hint", attrs: { role: "status" }, text: "Looking for shut homes…" }),
  );
  const card = h(
    "section",
    { class: "paper card stack shut-homes", attrs: { "aria-labelledby": "shut-homes-title" } },
    h("h2", { class: "card-title", attrs: { id: "shut-homes-title" }, text: "Shut homes" }),
    h("p", {
      class: "field-hint",
      text: "Hearths with no walk to the shop counter, so their resident can't buy, sell, or file a proposal. Clearing any one block under a home opens a way. The cheapest to its owner comes first: pick that one.",
    }),
    list,
  );
  const link = (person: Home["resident"]) =>
    personLink(person, { href: site + profilePath(person.id), newTab: true, picture: false });

  async function load() {
    const res = await api.shutHomes();
    if (isGone()) return;
    if (!res.ok) {
      if (res.code === "unauthorized") return;
      list.replaceChildren(
        h("p", { class: "field-hint", attrs: { role: "status" }, text: res.message }),
        button("Try again", (b) => void whileBusy(b, load)),
      );
      return;
    }
    list.replaceChildren(
      ...(res.data.homes.length === 0
        ? [
            h("p", {
              class: "field-hint",
              text: "None right now. Every hearth walks out to the town.",
            }),
          ]
        : res.data.homes.map(homeCard)),
    );
  }

  function homeCard(home: Home): HTMLElement {
    const result = h("p", { class: "state-body", attrs: { "aria-live": "polite" } });
    const status = h("p", { class: "field-hint item-status", attrs: { role: "status" } });
    const reasonId = `shut-reason-${home.resident.id}`;
    const reason = h("input", {
      class: "field-input",
      attrs: { id: reasonId, placeholder: "Why, for the log", autocomplete: "off" },
    });
    const clear = button("Clear it", () => {}, true);
    const confirmRow = h(
      "div",
      { class: "stack shut-confirm", attrs: { hidden: "" } },
      h("label", { class: "field-label", attrs: { for: reasonId }, text: "Reason, for the log" }),
      reason,
      h("div", { class: "cluster" }, clear),
    );
    // The block the last check passed for: Clear it takes only that one.
    let checked: { x: number; y: number } | undefined;
    const checks: HTMLButtonElement[] = [];

    async function check(f: Home["frees"][number], pressed: HTMLButtonElement) {
      disarm();
      const res = await whileBusyAll([...checks, clear], pressed, status, () =>
        api.clearBlock(f.x, f.y, CLEAR_CHECK_REASON, true),
      );
      if (isGone()) return;
      for (const b of checks) b.disabled = false;
      checked = res.ok ? { x: f.x, y: f.y } : undefined;
      clear.disabled = checked === undefined;
      confirmRow.hidden = checked === undefined;
      if (!res.ok) {
        result.textContent = "";
        return;
      }
      status.textContent = "";
      result.textContent = clearWords(res.data);
    }

    const disarm = confirmTwice(
      clear,
      "Tap again: this takes it off their plot",
      () => {
        const why = checked ? reasonProblem(reason.value) : "Check a block first.";
        if (why || !checked) {
          status.textContent = why ?? "";
          reason.focus();
          return;
        }
        const { x, y } = checked;
        void (async () => {
          const res = await whileBusyAll([...checks, clear], clear, status, () =>
            api.clearBlock(x, y, reason.value.trim(), false),
          );
          if (isGone() || !res.ok) return;
          result.textContent = clearWords(res.data);
          status.textContent = "";
          toast("Cleared. It's in the log.");
          await load();
        })();
      },
      () => checked !== undefined && reasonProblem(reason.value) === undefined,
    );

    const rows = freesByCost(home.frees).map((f) => {
      const cost = clearCost(f.block);
      let trail: HTMLButtonElement | null = null;
      if (maintainer) {
        trail = button("Clear", (b) => void check(f, b));
        trail.setAttribute("aria-label", `Check clearing the block at ${f.x}, ${f.y}`);
        checks.push(trail);
      }
      return itemRow({
        plain: true,
        className: `shut-block cost-${cost}`,
        attrs: { "data-x": String(f.x), "data-y": String(f.y) },
        name: freeLine(f),
        lines: [
          h(
            "span",
            { class: "cluster shut-block-owner" },
            kindPill(CLEAR_COST_WORDS[cost], COST_TONES[cost] ?? "clay"),
            h("span", {}, "On the plot of ", link(f.owner)),
          ),
        ],
        trail,
      });
    });

    return h(
      "article",
      { class: "stack shut-home", attrs: { "data-resident": home.resident.id } },
      h("p", { class: "item-author" }, link(home.resident)),
      h("p", {
        class: "field-hint",
        text: `Their hearth is at ${home.hearth.x}, ${home.hearth.y}.`,
      }),
      rows.length > 0
        ? itemRows(rows, { className: "shut-blocks" })
        : h("p", {
            class: "field-hint",
            text: "No single block opens a way. Ask them to take some down themselves.",
          }),
      result,
      maintainer ? confirmRow : null,
      status,
    );
  }

  void load();
  return card;
}
