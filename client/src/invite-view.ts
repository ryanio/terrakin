/**
 * `/i/:code` an invite: who sent it, then the short onboarding form. Accepting moves you in next
 * to them (or into their home, if they offered), builds your starter home, and you follow each
 * other. Then you land in the world. The inviter's name is their own words: textContent only.
 */
import type { InviteDetails } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { profilePath } from "@terrakin/ui/paths";
import { avatarEl } from "@terrakin/ui/people";
import { checkRow, stateCard, toast } from "@terrakin/ui/ui";
import { api, myProfile } from "./api";
import { joinForm } from "./join-form";
import { savedToken, saveToken } from "./net";
import { ARRIVAL_KEY, arrivalLine } from "./together";
import { errorCard, type View, type ViewContext } from "./view";

export function inviteView(code: string, ctx: ViewContext): View {
  ctx.setTitle("You're invited · Terrakin");
  const el = h("div", { class: "column stack cards page invite-page" });
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
        r.status === 404 ? expiredCard() : errorCard(r.message, () => void load()),
      );
      return;
    }
    const invite = r.data.invite;
    el.replaceChildren(welcome(invite));
    el.append(savedToken() ? alreadyHere(invite) : onboarding(invite));
  }

  /** Used up or out of date. Nobody needs an invite to move in, so offer the way in anyway. */
  function expiredCard(): HTMLElement {
    const here = savedToken() !== null;
    return stateCard({
      eyebrow: "Invite",
      level: "h1",
      titleId: "invite-gone",
      title: "This invite has expired or was already used",
      body: here
        ? "Invites work once, for 7 days. Ask the person who sent it for a fresh link, or find them on the feed and follow them."
        : "Invites work once, for 7 days. Ask the person who sent it for a fresh link, or step into the world now and find them once you're in.",
      actions: [
        h(
          "a",
          { class: "btn-primary small", attrs: { href: "/world" } },
          icon("world"),
          h("span", { text: "Step into the world" }),
        ),
        h(
          "a",
          { class: "pill-button small", attrs: { href: "/" } },
          icon("feed"),
          h("span", { text: "Go to the feed" }),
        ),
      ],
    });
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
    const build = checkRow({
      id: "invite-build",
      label: "Build my starter home",
      hint: "A cozy hut with a door and windows, ready when you arrive.",
      checked: true,
    });
    const share = invite.share
      ? checkRow({
          id: "invite-share",
          label: "Share their home",
          hint: `Move into ${invite.inviter.name}'s plot instead of the one next door.`,
          checked: true,
        })
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
        if (!r.ok) {
          // Someone else used it while this form was open: say so, and offer the way in anyway.
          if (r.status === 404 && !destroyed) {
            el.replaceChildren(expiredCard());
            return null;
          }
          return r.message;
        }
        saveToken(r.data.token, r.data.residentId);
        try {
          sessionStorage.setItem(ARRIVAL_KEY, arrivalLine(invite.inviter.name, r.data));
        } catch {
          // No storage: the world just skips the welcome line.
        }
        // Replace, so Back from the world doesn't land on this used invite.
        ctx.navigate("/world", { replace: true });
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
    const card = stateCard({
      title: "You already live in Terrakin",
      body: "This link is for someone new. You can still follow them from here.",
      actions: [
        follow,
        h(
          "a",
          { class: "pill-button small", attrs: { href: profilePath(invite.inviter.id) } },
          icon("arrow"),
          h("span", { text: "See their profile" }),
        ),
      ],
    });
    void myProfile().then((me) => {
      if (me?.id === invite.inviter.id) {
        card.replaceWith(
          stateCard({
            title: "This is your own invite",
            body: "Send the link to the person you want next door. It works once, for 7 days.",
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
