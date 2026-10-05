/**
 * Connecting an X account (decision 0022): the sheet on your own profile, the "@handle on X" link,
 * and the small mark next to names on posts. The server reads the post and decides; this file only
 * shows its answers. Handles are drawn as text and only become a link through `xProfileUrl`.
 */
import { type ProfileView, xProfileUrl } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { xIntentHref } from "@terrakin/ui/format";
import {
  closeOverlay,
  copyButton,
  errorLine,
  openOverlay,
  sheet,
  toast,
  whileBusy,
} from "@terrakin/ui/ui";
import { api } from "./api";

/** "@handle on X", linking to the account. `rel="me"` says the account and this profile are one. */
export function xAccountLink(handle: string): HTMLElement | null {
  const href = xProfileUrl(handle);
  if (!href) return null;
  return h(
    "a",
    {
      class: "x-account",
      attrs: { href, target: "_blank", rel: "me noopener", title: "Verified with a post on X" },
    },
    icon("check", "icon x-account-check"),
    h("span", { text: `@${handle}` }),
    // Flex drops this space visually (the gap spaces them); it keeps the text "@handle on X".
    " ",
    h("span", { class: "x-account-on", text: "on X" }),
  );
}

/**
 * The X line on a profile. Other people's profiles show the link, if any. Your own shows the link
 * and a way to disconnect, or a "Connect X" button. Call `paint(true)` once we know it's you.
 */
export function xRow(profile: ProfileView): { el: HTMLElement; paint(mine: boolean): void } {
  const el = h("div", { class: "x-row" });
  let mine = false;
  const paint = (isMine: boolean) => {
    mine = isMine;
    const link = profile.x ? xAccountLink(profile.x.handle) : null;
    el.replaceChildren();
    if (link) el.append(link);
    if (mine && profile.x) el.append(disconnectButton());
    if (mine && !profile.x) el.append(connectButton());
    el.hidden = el.childElementCount === 0;
  };

  const update = (next: ProfileView) => {
    if (next.x) profile.x = next.x;
    else delete profile.x;
    paint(mine);
  };

  function connectButton() {
    return h(
      "button",
      {
        class: "pill-button small x-connect",
        attrs: { type: "button" },
        on: { click: () => openConnectSheet(update) },
      },
      icon("link"),
      "Connect X",
    );
  }

  function disconnectButton() {
    const b = h("button", {
      class: "x-disconnect",
      attrs: { type: "button" },
      text: "Disconnect",
    });
    b.addEventListener("click", async () => {
      const res = await whileBusy(b, () => api.xUnlink());
      if (!res.ok) {
        toast(res.message);
        return;
      }
      update(res.data.resident);
      toast("X disconnected");
    });
    return b;
  }

  paint(false);
  return { el, paint };
}

/** The two-step sheet: post this line on X, then paste the post's link. */
export function openConnectSheet(onConnected: (profile: ProfileView) => void) {
  const body = h("div", { class: "sheet-body" });
  const { dialog, close } = sheet(
    { id: "x-sheet-title", title: "Connect X", className: "x-sheet", closeOnBackdrop: true },
    body,
  );

  let closed = false;
  openOverlay(dialog, () => {
    closed = true;
  });
  close.focus();

  body.replaceChildren(h("p", { class: "sheet-lede", text: "Getting your code…" }));
  void load();

  async function load() {
    const start = await api.xStart();
    if (closed) return;
    if (!start.ok) {
      body.replaceChildren(
        h("p", { class: "sheet-lede", text: start.message }),
        h("button", {
          class: "pill-button",
          attrs: { type: "button" },
          text: "Try again",
          on: { click: () => void load() },
        }),
      );
      return;
    }
    steps(start.data.text, xIntentHref(start.data.intentUrl, start.data.text));
  }

  function steps(text: string, intent: string | undefined) {
    const phrase = h("p", { class: "x-phrase", text });
    const copyLabel = h("span", { text: "Copy" });
    const copy = h(
      "button",
      { class: "pill-button small", attrs: { type: "button" } },
      icon("copy"),
      copyLabel,
    );
    copyButton(copy, copyLabel, () => text, { idle: "Copy", fallback: phrase });
    const open = intent
      ? h(
          "a",
          {
            class: "btn-primary small x-open",
            attrs: { href: intent, target: "_blank", rel: "noopener noreferrer" },
          },
          "Open X",
          icon("arrow"),
        )
      : null;

    const input = h("input", {
      class: "x-url",
      attrs: {
        id: "x-url",
        type: "url",
        inputmode: "url",
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "false",
        placeholder: "https://x.com/you/status/…",
        required: true,
      },
    });
    const error = errorLine();
    const verify = h("button", {
      class: "btn-primary x-verify",
      attrs: { type: "submit" },
      text: "Verify",
    });
    const form = h(
      "form",
      { class: "x-form", attrs: { novalidate: true } },
      h("label", {
        class: "x-label",
        attrs: { for: "x-url" },
        text: "Paste the link to your post",
      }),
      input,
      error,
      verify,
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const url = input.value.trim();
      if (!url) {
        error.textContent = "Paste the link to your post first.";
        input.focus();
        return;
      }
      error.textContent = "";
      const res = await whileBusy(verify, () => api.xVerify(url), "Checking…");
      if (closed) return;
      if (!res.ok) {
        error.textContent = res.message;
        return;
      }
      onConnected(res.data.resident);
      done(res.data.resident.x?.handle ?? "");
    });

    body.replaceChildren(
      h(
        "p",
        { class: "sheet-lede" },
        "Show your X account on your profile. Post one line from it, then paste the post's link here. It's public, and we keep only your handle and that link.",
      ),
      h(
        "ol",
        { class: "x-steps" },
        h(
          "li",
          { class: "x-step" },
          h("h3", { class: "x-step-title", text: "Post this on X" }),
          phrase,
          h("div", { class: "x-step-actions" }, copy, open),
          h("p", { class: "x-hint", text: "The code in it works for an hour." }),
        ),
        h("li", { class: "x-step" }, form),
      ),
    );
  }

  function done(handle: string) {
    const ok = h("button", {
      class: "btn-primary",
      attrs: { type: "button" },
      text: "Done",
      on: { click: () => closeOverlay() },
    });
    body.replaceChildren(
      h(
        "div",
        { class: "x-done", attrs: { role: "status" } },
        h("span", { class: "x-done-mark" }, icon("check", "icon x-done-icon")),
        h("p", { class: "x-done-title", text: `Connected @${handle}` }),
        h("p", { class: "sheet-lede", text: "It shows on your profile now." }),
        xAccountLink(handle),
        ok,
      ),
    );
    ok.focus();
  }
}
