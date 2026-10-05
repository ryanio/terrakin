// Must stay first: turns off zod's eval probe before any schema is built (see jitless.ts).
import "./jitless";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/figtree";
import type { AdminOverviewResponse } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { api, SIGNED_OUT_EVENT, savedToken, saveToken } from "./api";
import { logView } from "./log-view";
import { pathFor, type Screen, screenFor, signedInAs } from "./logic";
import { queueView } from "./queue-view";
import { button, notice, type View } from "./view";
import "./style.css";

/**
 * The staff app at admin.terrakin.org (RFC 0006, decision 0040). It asks who's signed in, then
 * shows the review queue or the moderation log. Everything it shows comes from the staff routes;
 * the server checks every action, so this page only decides what to offer.
 */

const top = document.getElementById("top") as HTMLElement;
const main = document.getElementById("main") as HTMLElement;

let overview: AdminOverviewResponse | undefined;
let view: View | undefined;

function show(el: HTMLElement) {
  view?.destroy();
  view = undefined;
  main.replaceChildren(el);
}

function navLink(screen: Screen, label: string, current: Screen): HTMLAnchorElement {
  const a = h("a", {
    class: "nav-link",
    attrs: { href: pathFor(screen), "aria-current": screen === current ? "page" : null },
    text: label,
  });
  a.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (location.pathname !== pathFor(screen)) history.pushState(null, "", pathFor(screen));
    route();
  });
  return a;
}

function paintTop(screen: Screen | undefined) {
  const brand = h(
    "p",
    { class: "brand" },
    h("span", { class: "brand-name", text: "Terrakin" }),
    h("span", { class: "brand-tag", text: "staff" }),
  );
  if (!overview || !screen) {
    top.replaceChildren(h("div", { class: "column top-row" }, brand));
    return;
  }
  const { me } = overview;
  const signOut =
    me.via === "access"
      ? h("a", {
          class: "pill-button small",
          attrs: { href: "/cdn-cgi/access/logout" },
          text: "Sign out",
        })
      : button("Forget token", () => {
          saveToken(undefined);
          overview = undefined;
          signIn();
        });
  top.replaceChildren(
    h(
      "div",
      { class: "column top-row" },
      brand,
      h("p", { class: "who", text: signedInAs(me) }),
      signOut,
    ),
    h(
      "nav",
      { class: "column nav", attrs: { "aria-label": "Staff" } },
      navLink("queue", "Queue", screen),
      navLink("log", "Log", screen),
    ),
  );
}

function route() {
  if (!overview) return;
  const screen = screenFor(location.pathname);
  paintTop(screen);
  document.title = `${screen === "log" ? "Log" : "Queue"} · Terrakin staff`;
  view?.destroy();
  view = screen === "log" ? logView() : queueView(overview);
  main.replaceChildren(view.el);
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/**
 * No sign-in the server accepts. On admin.terrakin.org that means the Access sign-in ran out, and
 * reloading signs in again. Where Access isn't set up, a staff member's resident token works.
 */
function signIn(message?: string) {
  paintTop(undefined);
  document.title = "Sign in · Terrakin staff";
  const input = h("input", {
    class: "field-input",
    attrs: {
      id: "staff-token",
      type: "password",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "Paste a token",
    },
  });
  const status = h("p", { class: "field-hint", attrs: { role: "status" }, text: message ?? "" });
  const form = h(
    "form",
    { class: "token-form", attrs: { "aria-labelledby": "token-title" } },
    h("h2", { class: "section-title", attrs: { id: "token-title" }, text: "Sign in with a token" }),
    h("p", {
      class: "field-hint",
      text: "Where Cloudflare Access isn't set up (local dev, or your own server), paste a maintainer's or moderator's resident token. It stays in this tab until you close it.",
    }),
    h("label", { class: "field-label", attrs: { for: "staff-token" }, text: "Token" }),
    input,
    h("button", { class: "btn-primary", attrs: { type: "submit" }, text: "Sign in" }),
    status,
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const token = input.value.trim();
    if (!token) {
      status.textContent = "Paste a token first.";
      input.focus();
      return;
    }
    saveToken(token);
    void boot();
  });
  show(
    h(
      "div",
      { class: "sign-in" },
      notice(
        "Sign in",
        "On admin.terrakin.org, Cloudflare Access signs you in. If your sign-in ran out, reload the page.",
        button("Reload", () => location.reload(), true),
      ),
      h("section", { class: "paper card" }, form),
    ),
  );
}

function notStaff(message: string) {
  paintTop(undefined);
  document.title = "Staff only · Terrakin";
  const actions = savedToken()
    ? [
        button("Use another token", () => {
          saveToken(undefined);
          signIn();
        }),
      ]
    : [];
  show(notice("Staff only", message, ...actions));
}

async function boot() {
  const res = await api.overview();
  if (res.ok) {
    overview = res.data;
    route();
    return;
  }
  overview = undefined;
  if (res.code === "unauthorized") {
    if (savedToken()) {
      saveToken(undefined);
      signIn("That token didn't work. Check it and try again.");
    } else {
      signIn();
    }
  } else if (res.code === "forbidden") {
    notStaff(res.message);
  } else {
    paintTop(undefined);
    show(
      notice(
        "Couldn't reach Terrakin",
        res.message,
        button("Try again", () => void boot()),
      ),
    );
  }
}

window.addEventListener(SIGNED_OUT_EVENT, () => {
  if (!overview) return;
  const via = overview.me.via;
  overview = undefined;
  if (via === "token") saveToken(undefined);
  signIn(via === "token" ? "That token stopped working. Sign in again." : undefined);
});
window.addEventListener("popstate", route);

void boot();
