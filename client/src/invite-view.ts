/**
 * `/i/:code` an invite: who sent it, then the short onboarding form. Accepting moves you in next
 * to them (or into their home, if they offered), builds your starter home, and you follow each
 * other. Then you land in the world. The inviter's name is their own words: textContent only.
 */
import type { InviteDetails } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { toast } from "@terrakin/ui/ui";
import { api, myProfile } from "./api";
import { checkRow, joinForm } from "./join-form";
import { savedToken, saveToken } from "./net";
import { avatarEl, profilePath } from "./post-card";
import { ARRIVAL_KEY } from "./together";
import { errorCard, notFoundCard, type View, type ViewContext } from "./view";

export function inviteView(code: string, ctx: ViewContext): View {
  ctx.setTitle("You're invited · Terrakin");
  const el = h("div", { class: "column page invite-page" });
  let destroyed = false;

  const ready = load();

  async function load(): Promise<void> {
    el.replaceChildren(
      h("div", { class: "paper card profile skeleton-profile", attrs: { "aria-hidden": "true" } }),
    );
    const r = await api.invite(code);
    if (destroyed) return;
    if (!r.ok) {
      el.replaceChildren(
        r.status === 404
          ? notFoundCard(
              "This invite has expired or was already used",
              "Invites work once, for 7 days. Ask the person who sent it for a fresh link, or look around the feed in the meantime.",
            )
          : errorCard(r.message, () => void load()),
      );
      return;
    }
    const invite = r.data.invite;
    el.replaceChildren(welcome(invite));
    el.append(savedToken() ? alreadyHere(invite) : onboarding(invite));
  }

  function welcome(invite: InviteDetails): HTMLElement {
    const { inviter } = invite;
    return h(
      "section",
      { class: "paper card invite-hero", attrs: { "aria-labelledby": "invite-heading" } },
      avatarEl(inviter, "xl"),
      h("p", { class: "eyebrow", text: "You're invited" }),
      h(
        "h1",
        { class: "invite-title", attrs: { id: "invite-heading" } },
        h("span", { class: "invite-name", text: inviter.name }),
        " invited you to Terrakin",
      ),
      h("p", {
        class: "invite-lede",
        text: invite.share
          ? "A small world you build together. Pick a name and a look, and you can move into their home with them."
          : "A small world you build together. Pick a name and a look, and you'll move in next door with a little home of your own.",
      }),
    );
  }

  function onboarding(invite: InviteDetails): HTMLElement {
    const build = checkRow(
      "invite-build",
      "Build my starter home",
      "A cozy hut with a door and windows, ready when you arrive.",
      true,
    );
    const share = invite.share
      ? checkRow(
          "invite-share",
          "Share their home",
          `Move into ${invite.inviter.name}'s plot instead of the one next door.`,
          true,
        )
      : undefined;
    const form = joinForm({
      id: "invite",
      submitLabel: "Move in",
      busyLabel: "Moving in…",
      extras: [h("div", { class: "check-group" }, build.el, share?.el ?? null)],
      async onSubmit(choice) {
        const r = await api.acceptInvite(code, {
          name: choice.name,
          kind: "human",
          color: choice.color,
          shape: choice.shape,
          ...(choice.note ? { note: choice.note } : {}),
          ...(choice.theme ? { theme: choice.theme } : {}),
          build: build.input.checked,
          ...(share ? { share: share.input.checked } : {}),
        });
        if (!r.ok) return r.message;
        saveToken(r.data.token, r.data.residentId);
        try {
          sessionStorage.setItem(
            ARRIVAL_KEY,
            r.data.shared
              ? `Welcome home. You share ${invite.inviter.name}'s plot now.`
              : `Welcome! You live next to ${invite.inviter.name} now.`,
          );
        } catch {
          // No storage: the world just skips the welcome line.
        }
        ctx.navigate("/world");
        return null;
      },
    });
    return h(
      "section",
      { class: "paper card onboard-card", attrs: { "aria-label": "Make your character" } },
      form.el,
      h("p", {
        class: "field-hint onboard-foot",
        text: "No account, no email, no payment. Your character lives in this browser.",
      }),
    );
  }

  /** Someone who already has a character here: offer to follow instead. */
  function alreadyHere(invite: InviteDetails): HTMLElement {
    const card = h(
      "section",
      { class: "paper card state-card" },
      h("h2", { class: "state-title", text: "You already live in Terrakin" }),
      h("p", {
        class: "state-body",
        text: "This link is for someone new. You can still follow them from here.",
      }),
    );
    const actions = h("div", { class: "state-actions" });
    const follow = h(
      "button",
      { class: "btn-primary small", attrs: { type: "button" } },
      h("span", { text: `Follow ${invite.inviter.name}` }),
    );
    follow.addEventListener("click", async () => {
      follow.disabled = true;
      const r = await api.follow(invite.inviter.id, true);
      if (destroyed) return;
      if (r.ok) ctx.navigate(profilePath(invite.inviter.id));
      else {
        follow.disabled = false;
        toast(r.message);
      }
    });
    actions.append(
      follow,
      h(
        "a",
        { class: "pill-button small", attrs: { href: profilePath(invite.inviter.id) } },
        icon("arrow"),
        h("span", { text: "See their profile" }),
      ),
    );
    card.append(actions);
    void myProfile().then((me) => {
      if (me?.id === invite.inviter.id) {
        card.replaceChildren(
          h("h2", { class: "state-title", text: "This is your own invite" }),
          h("p", {
            class: "state-body",
            text: "Send the link to the person you want next door. It works once, for 7 days.",
          }),
        );
      }
    });
    return card;
  }

  return {
    el,
    ready,
    destroy() {
      destroyed = true;
    },
  };
}
