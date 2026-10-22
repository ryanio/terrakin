/**
 * Keys, for every staff role (RFC 0026): make a key for your own AI so it can call the staff routes
 * from the command line, see when each was last used, and revoke one. A key acts as you, never
 * beyond your role or its scope, and is shown once. Maintainers see and can revoke everyone's.
 * Names are staff's own words, still put in as text.
 */
import {
  type AdminOverviewResponse,
  STAFF_KEY_DAYS,
  type StaffKeyScope,
  type StaffKeyView,
} from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { fullDate } from "@terrakin/ui/format";
import {
  confirmTwice,
  copyBlock,
  itemRow,
  itemRows,
  stateCard,
  toast,
  whileBusy,
  whileBusyAll,
} from "@terrakin/ui/ui";
import { api } from "./api";
import { keyMessage, keyScopes, mainSite } from "./logic";
import { actorName, button, pageHead, type View } from "./view";

export function keysView(overview: AdminOverviewResponse): View {
  const { me } = overview;
  const site = mainSite(location.origin);
  const scopes = keyScopes(me.role);
  const scopeLabel = (s: StaffKeyScope) => scopes.find((o) => o.scope === s)?.label ?? s;
  let destroyed = false;

  const name = h("input", {
    class: "field-input",
    attrs: { id: "key-name", placeholder: "Whose AI, like Ryan's Claude", autocomplete: "off" },
  });
  const scope = h(
    "select",
    { class: "field-input", attrs: { id: "key-scope" } },
    ...scopes.map((o) => h("option", { attrs: { value: o.scope }, text: o.label })),
  );
  const days = h(
    "select",
    { class: "field-input", attrs: { id: "key-days" } },
    ...STAFF_KEY_DAYS.map((d) =>
      h("option", {
        attrs: { value: String(d), selected: d === 90 ? "" : null },
        text: `${d} days`,
      }),
    ),
  );
  const status = h("p", { class: "field-hint item-status", attrs: { role: "status" } });
  const made = h("div", { class: "stack", attrs: { "aria-live": "polite" } });
  const list = h("div", { class: "stack key-list" });
  const make = button("Make key", () => {}, true);
  make.addEventListener("click", async () => {
    if (!name.value.trim()) {
      status.textContent = "Name it first, so the log says whose AI acted.";
      name.focus();
      return;
    }
    const res = await whileBusyAll([make], make, status, () =>
      api.makeKey(name.value.trim(), scope.value as StaffKeyScope, Number(days.value)),
    );
    if (destroyed || !res.ok) return;
    make.disabled = false;
    status.textContent = "";
    name.value = "";
    const { secret, key } = res.data;
    made.replaceChildren(
      h(
        "article",
        { class: "stack paper card key-made", attrs: { "data-key": key.id } },
        h("h2", { class: "card-title", text: `New key: ${key.name}` }),
        h("p", {
          class: "field-hint",
          text: `Shown only now. It works until ${fullDate(key.expiresAt)}, or until you revoke it below.`,
        }),
        copyBlock("The key", secret),
        copyBlock("Message to give your AI with it", keyMessage(site, secret, key.scope)),
      ),
    );
    void load();
  });

  async function load() {
    const res = await api.keys();
    if (destroyed) return;
    if (!res.ok) {
      list.replaceChildren(
        stateCard({
          title: "Couldn't load the keys",
          body: res.message,
          actions: [button("Try again", (b) => void whileBusy(b, load))],
        }),
      );
      return;
    }
    list.replaceChildren(
      res.data.keys.length > 0
        ? itemRows(res.data.keys.map(row), { className: "key-rows" })
        : stateCard({ title: "No keys yet", body: "Keys you make show here." }),
    );
  }

  /** One key: its name, scope, who made it, and when it stops working, with Revoke at the end. */
  function row(k: StaffKeyView): HTMLLIElement {
    const over = k.revokedAt !== null || Date.parse(k.expiresAt) <= Date.now();
    const state =
      k.revokedAt !== null
        ? `Revoked ${fullDate(k.revokedAt)}`
        : over
          ? `Expired ${fullDate(k.expiresAt)}`
          : `Works until ${fullDate(k.expiresAt)}`;
    const keyStatus = h("p", { class: "field-hint item-status", attrs: { role: "status" } });
    const revoke = button("Revoke", () => {});
    confirmTwice(revoke, "Tap again to revoke it", async () => {
      const res = await whileBusyAll([revoke], revoke, keyStatus, () => api.revokeKey(k.id));
      if (destroyed || !res.ok) return;
      toast(`${k.name} is revoked`);
      void load();
    });
    const li = itemRow({
      name: k.name,
      className: `key-row${over ? " key-over" : ""}`,
      attrs: { "data-key": k.id },
      lines: [
        scopeLabel(k.scope),
        k.mine
          ? null
          : h("span", {}, "Made by ", actorName({ actor: k.owner, actorView: k.ownerView })),
        `${state}. ${k.lastUsedAt ? `Last used ${fullDate(k.lastUsedAt)}.` : "Not used yet."}`,
      ],
      trail: over ? null : revoke,
    });
    li.append(keyStatus);
    return li;
  }

  const el = h(
    "div",
    { class: "column stack cards keys" },
    pageHead({
      id: "keys-title",
      title: "Keys for your AI",
      lede: "A key lets your own AI call the staff tools from the command line. It acts as you, never beyond your role or the scope you pick, and everything it does is logged under your name with the key's name. It can't make keys. Keep it in your password manager, and revoke it if it might have leaked.",
    }),
    h(
      "section",
      { class: "stack paper card staff-form", attrs: { "aria-labelledby": "key-form-title" } },
      h("h2", { class: "card-title", attrs: { id: "key-form-title" }, text: "Make a key" }),
      h("label", { class: "field-label", attrs: { for: "key-name" }, text: "Name" }),
      name,
      h("label", { class: "field-label", attrs: { for: "key-scope" }, text: "What it can do" }),
      scope,
      h("label", { class: "field-label", attrs: { for: "key-days" }, text: "How long it works" }),
      days,
      h("div", { class: "cluster" }, make),
      status,
    ),
    made,
    h("h2", {
      class: "section-title",
      text: me.role === "maintainer" ? "Every staff key" : "Your keys",
    }),
    list,
  );

  void load();
  return {
    el,
    destroy() {
      destroyed = true;
    },
  };
}
