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

function loadSaved(share: boolean): InviteView | undefined {
  try {
    const parsed = InviteView.safeParse(
      JSON.parse(localStorage.getItem(savedKey(share)) ?? "null"),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function save(invite: InviteView) {
  try {
    localStorage.setItem(savedKey(invite.share), JSON.stringify(invite));
  } catch {
    // Storage disabled: we make a fresh link next time.
  }
}

/** An invite to hand out: the saved one while it still works, else a new one. */
async function getInvite(share: boolean): Promise<{ invite: InviteView } | { error: string }> {
  const saved = loadSaved(share);
  if (reusableInvite(saved, share, Date.now()) && (await api.invite(saved.code)).ok) {
    return { invite: saved };
  }
  const made = await api.createInvite(share);
  if (!made.ok) return { error: made.message };
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
    h("div", { class: "invite-actions" }, copy, share),
    status,
    shareHome.el,
  );

  let url = "";
  const load = async () => {
    copy.disabled = true;
    share.disabled = true;
    link.textContent = "Making your link…";
    status.textContent = "";
    const result = await getInvite(shareHome.input.checked);
    if ("error" in result) {
      link.textContent = "";
      status.textContent = result.error;
      return;
    }
    url = inviteLink(result.invite.path, location.origin);
    link.textContent = url;
    copy.disabled = false;
    share.disabled = typeof navigator.share !== "function";
    share.hidden = typeof navigator.share !== "function";
  };

  copyButton(copy, copyLabel, () => url, { idle: "Copy", fallback: link });
  share.addEventListener("click", async () => {
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
