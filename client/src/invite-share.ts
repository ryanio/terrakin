/**
 * "Invite someone": makes an invite link (or reuses the one you made earlier) and shows it with
 * Copy and Share. Opened from your own profile and from the world's HUD.
 */
import { InviteView } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { checkRow, copyButton, openOverlay, sheet } from "@terrakin/ui/ui";
import { api } from "./api";
import { savedResidentId } from "./net";
import { inviteLink, reusableInvite } from "./together";

const savedKey = (share: boolean) => `terrakin.invite.${savedResidentId() ?? "me"}.${share}`;
/** The code of the saved invite once it was copied or shared, so the next open makes a new one. */
const handedOutKey = (share: boolean) => `${savedKey(share)}.out`;

function loadSaved(share: boolean): { invite?: InviteView; handedOut: boolean } {
  try {
    const parsed = InviteView.safeParse(
      JSON.parse(localStorage.getItem(savedKey(share)) ?? "null"),
    );
    if (!parsed.success) return { handedOut: false };
    const handedOut = localStorage.getItem(handedOutKey(share)) === parsed.data.code;
    return { invite: parsed.data, handedOut };
  } catch {
    return { handedOut: false };
  }
}

function save(invite: InviteView) {
  try {
    localStorage.setItem(savedKey(invite.share), JSON.stringify(invite));
  } catch {
    // Storage disabled: we make a fresh link next time.
  }
}

function markHandedOut(invite: InviteView) {
  try {
    localStorage.setItem(handedOutKey(invite.share), invite.code);
  } catch {
    // Storage disabled: nothing is saved to reuse either.
  }
}

/**
 * An invite to hand out: the saved one while it still works and nobody was sent it yet, else a
 * new one. `fresh` always makes a new one.
 */
async function getInvite(
  share: boolean,
  fresh = false,
): Promise<{ invite: InviteView } | { error: string; code: string }> {
  const { invite: saved, handedOut } = loadSaved(share);
  if (
    !fresh &&
    reusableInvite(saved, share, Date.now(), handedOut) &&
    (await api.invite(saved.code)).ok
  ) {
    return { invite: saved };
  }
  const made = await api.createInvite(share);
  if (!made.ok) return { error: made.message, code: made.code };
  save(made.data.invite);
  return { invite: made.data.invite };
}

export function openInviteDialog() {
  const link = h("p", { class: "copy-text invite-link", attrs: { id: "invite-link" } });
  const status = h("p", { class: "field-hint", attrs: { role: "status" } });
  const copyLabel = h("span", { text: "Copy" });
  const copy = h(
    "button",
    { class: "btn-primary small invite-copy", attrs: { type: "button", disabled: true } },
    icon("copy"),
    copyLabel,
  );
  const share = h(
    "button",
    { class: "pill-button small invite-share", attrs: { type: "button", disabled: true } },
    icon("share"),
    h("span", { text: "Share" }),
  );
  // Each link works once: after sending it to one person, make another for the next.
  const fresh = h(
    "button",
    { class: "pill-button small invite-fresh", attrs: { type: "button", hidden: true } },
    icon("plus"),
    h("span", { text: "Make a new link" }),
  );
  const shareHome = checkRow({
    id: "invite-share-home",
    label: "Offer to share my home",
    hint: "They can move into your plot with you instead of the one next door.",
  });

  const { dialog, close } = sheet(
    {
      id: "invite-title",
      title: "Invite someone",
      className: "invite-sheet",
      lede: "Send this link to someone you'd like as a neighbor. They pick a name and a look, move in next to you with a little home, and you follow each other. No sign-up, and it's free. The link works once, for 7 days.",
    },
    h("div", { class: "copy-line invite-line" }, link),
    h("div", { class: "invite-actions" }, copy, share, fresh),
    status,
    shareHome.el,
  );

  const homeHint = shareHome.el.querySelector(".check-hint");
  status.hidden = true;

  let url = "";
  let current: InviteView | undefined;
  let latest = 0;
  const load = async (makeNew = false) => {
    const run = ++latest;
    const wantShare = shareHome.input.checked;
    copy.disabled = true;
    share.disabled = true;
    fresh.disabled = true;
    // Keep the current link in place while the new one loads, so the sheet doesn't jump.
    if (url) link.classList.add("is-loading");
    else link.textContent = "Making your link…";
    status.hidden = true;
    const result = await getInvite(wantShare, makeNew);
    if (run !== latest) return;
    link.classList.remove("is-loading");
    if ("error" in result) {
      if (wantShare && result.code === "bad_request") {
        // Nothing of yours to share yet: say why on the option and go back to the plain link.
        shareHome.input.checked = false;
        shareHome.input.disabled = true;
        if (homeHint) homeHint.textContent = result.error;
        if (url) ready();
        else void load();
        return;
      }
      if (url) {
        // Keep the link that's showing, and the option it was made with.
        shareHome.input.checked = !wantShare;
        ready();
      } else {
        link.textContent = "";
      }
      status.textContent = result.error;
      status.hidden = false;
      return;
    }
    current = result.invite;
    url = inviteLink(result.invite.path, location.origin);
    link.textContent = url;
    ready();
    if (makeNew) {
      status.textContent = "Here's a new link. Links you already sent still work.";
      status.hidden = false;
    }
  };
  const ready = () => {
    copy.disabled = false;
    share.disabled = typeof navigator.share !== "function";
    share.hidden = typeof navigator.share !== "function";
    fresh.disabled = false;
    fresh.hidden = false;
  };
  // Once a link has gone out, the next time the sheet opens it makes a new one.
  const handOut = () => {
    if (current) markHandedOut(current);
  };

  copyButton(copy, copyLabel, () => url, { idle: "Copy", fallback: link });
  copy.addEventListener("click", handOut);
  fresh.addEventListener("click", () => void load(true));
  share.addEventListener("click", async () => {
    handOut();
    try {
      await navigator.share({ url, title: "Come live next to me on Terrakin" });
    } catch {
      // Closed the share sheet: nothing to do.
    }
  });
  shareHome.input.addEventListener("change", () => void load());

  openOverlay(dialog);
  close.focus();
  void load();
}
