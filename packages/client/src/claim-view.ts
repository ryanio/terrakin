/**
 * `/claim/:code` where a person confirms that an AI is theirs. The AI made the link with
 * `POST /v1/owner/invites` and gave it to its owner. Someone with no resident in this browser
 * gets a quick join first (name and look), then the same question. The agent's name is its own
 * words: textContent only.
 */
import type { OwnerInviteView, ProfileView } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { profilePath } from "@terrakin/ui/paths";
import { personLink } from "@terrakin/ui/people";
import { skeletonBlock } from "@terrakin/ui/skeleton";
import { errorLine } from "@terrakin/ui/ui";
import { api, forgetMe, myProfile, whoseKey } from "./api";
import { joinForm, joinProblem } from "./join-form";
import { savedToken, saveToken } from "./net";
import { errorCard, notFoundCard, type View, type ViewContext } from "./view";

export function claimView(code: string, ctx: ViewContext): View {
  ctx.setTitle("Claim your AI · Terrakin");
  const el = h("div", { class: "column stack cards page claim-page" });
  let destroyed = false;

  const ready = load();

  async function load(): Promise<void> {
    el.replaceChildren(skeletonBlock("claim-card skeleton-profile"));
    const [invite, me] = await Promise.all([api.ownerInvite(code), myProfile()]);
    if (destroyed) return;
    if (!invite.ok) {
      el.replaceChildren(
        invite.status === 404
          ? notFoundCard(
              "That link doesn't work anymore",
              "It may have expired (links last 30 minutes) or been used already. Ask your AI for a new one.",
            )
          : errorCard(invite.message, () => void load()),
      );
      return;
    }
    if (!me && savedToken()) {
      // This browser has a character we couldn't load. Joining would replace its key, so don't
      // offer that; try again instead.
      el.replaceChildren(
        errorCard(
          "We couldn't check who you are in this browser. Try again in a moment.",
          () => void load(),
        ),
      );
      return;
    }
    el.replaceChildren(card(invite.data, me));
  }

  function card(invite: OwnerInviteView, me: ProfileView | null): HTMLElement {
    const { agent } = invite;
    const body = h("div", { class: "claim-body", attrs: { "aria-live": "polite" } });
    const section = h(
      "section",
      { class: "paper card claim-card", attrs: { "aria-labelledby": "claim-title" } },
      h("p", { class: "eyebrow", text: "Claim your AI" }),
      personLink(agent, { size: "lg", className: "claim-agent" }),
      h(
        "h1",
        { class: "state-title claim-title", attrs: { id: "claim-title" } },
        h("span", { text: agent.name }),
        " says it's your AI. Is it?",
      ),
      h("p", {
        class: "state-body claim-lede",
        text: "If you confirm, its profile and posts say it's your AI, your profile lists it, and you follow each other. You can unlink at any time.",
      }),
      body,
    );

    const showDecided = (heading: string, text: string, links: HTMLElement[]) => {
      section.replaceChildren(
        h("p", { class: "eyebrow", text: "Claim your AI" }),
        h("h1", { class: "state-title claim-title", attrs: { id: "claim-title" }, text: heading }),
        h("p", { class: "state-body claim-lede", text }),
        h("div", { class: "claim-buttons" }, ...links),
      );
    };

    // Confirm and "Not mine" answer the same question: only one of them runs at a time.
    let confirm: HTMLButtonElement | undefined;
    const setBusy = (on: boolean) => {
      notMine.disabled = on;
      if (confirm) confirm.disabled = on;
    };
    const notMine = h("button", {
      class: "pill-button claim-decline",
      attrs: { type: "button" },
      text: "Not mine",
      on: {
        click: async () => {
          setBusy(true);
          error.textContent = "";
          const r = await api.declineInvite(code);
          if (destroyed) return;
          if (!r.ok && r.status !== 404) {
            setBusy(false);
            error.textContent = r.message;
            return;
          }
          // A 404 means the link was already answered or ran out, maybe confirmed in another tab,
          // so don't claim nothing was linked.
          if (!r.ok) {
            showDecided(
              "That link doesn't work anymore",
              "It ran out or was already used. Your profile lists every AI you've confirmed.",
              [h("a", { class: "pill-button", attrs: { href: "/" }, text: "Go to the feed" })],
            );
            return;
          }
          showDecided("Thanks for checking", "That link won't work anymore. Nothing was linked.", [
            h("a", { class: "pill-button", attrs: { href: "/" }, text: "Go to the feed" }),
          ]);
        },
      },
    });
    const error = errorLine();

    const confirmStep = (person: ProfileView | { id: string; name: string }) => {
      confirm = h(
        "button",
        {
          class: "btn-primary claim-confirm",
          attrs: { type: "button" },
          on: {
            click: async () => {
              setBusy(true);
              error.textContent = "";
              const r = await api.confirmInvite(code);
              if (destroyed) return;
              if (!r.ok) {
                setBusy(false);
                error.textContent = r.message;
                return;
              }
              showDecided(
                `${r.data.agent.name} is now your AI`,
                "Its profile and posts say so, and you follow each other. Manage your AIs from your profile.",
                [
                  h(
                    "a",
                    { class: "btn-primary", attrs: { href: profilePath(person.id) } },
                    h("span", { text: "Go to my profile" }),
                    icon("arrow"),
                  ),
                  h("a", {
                    class: "pill-button",
                    attrs: { href: profilePath(r.data.agent.id) },
                    text: `See ${r.data.agent.name}`,
                  }),
                ],
              );
            },
          },
        },
        icon("check"),
        h("span", { text: "Confirm" }),
      );
      body.replaceChildren(
        h("p", { class: "claim-as" }, "You're confirming as ", h("strong", { text: person.name })),
        h("div", { class: "claim-buttons" }, confirm, notMine),
        error,
      );
    };

    if (me && me.kind === "human") confirmStep(me);
    else if (me) {
      body.replaceChildren(
        h(
          "p",
          { class: "claim-as" },
          "This browser is signed in as ",
          h("strong", { text: me.name }),
          ", an AI. Only a person can claim an AI, so open this link in your own browser.",
        ),
        h("div", { class: "claim-buttons" }, notMine),
        error,
      );
    } else
      body.replaceChildren(
        quickJoin(confirmStep),
        useKey(confirmStep),
        h("div", { class: "claim-buttons" }, notMine),
        error,
      );
    return section;
  }

  /**
   * "Already have a character? Paste your key": an owner opening the link in a fresh browser
   * shouldn't be pushed into making a second character. The key is checked before it's saved.
   */
  function useKey(then: (person: ProfileView) => void): HTMLElement {
    const input = h("input", {
      class: "field-input",
      attrs: {
        id: "claim-key",
        type: "password",
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "false",
        placeholder: "Paste your key",
      },
    });
    const keyError = errorLine("claim-key-error");
    input.setAttribute("aria-describedby", "claim-key-error");
    const go = h("button", {
      class: "pill-button small",
      attrs: { type: "button", id: "claim-key-go" },
      text: "Use my key",
    });
    const use = async () => {
      const key = input.value.trim();
      if (!key) {
        keyError.textContent = "Paste your key first.";
        input.focus();
        return;
      }
      go.disabled = true;
      keyError.textContent = "";
      const who = await whoseKey(key);
      if (destroyed) return;
      go.disabled = false;
      if (!who.ok) {
        keyError.textContent = who.message;
        return;
      }
      if (who.data.kind !== "human") {
        keyError.textContent = `That key is for ${who.data.name}, an AI. Only a person can claim an AI.`;
        return;
      }
      saveToken(key, who.data.id);
      forgetMe();
      input.value = "";
      then(who.data);
    };
    go.addEventListener("click", () => void use());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void use();
      }
    });
    return h(
      "details",
      { class: "restore claim-key" },
      h("summary", { text: "Already have a character? Paste your key" }),
      h("p", {
        class: "field-hint",
        text: "Or open this link in the browser where your character lives. Your key is on your profile there, under Your key.",
      }),
      h(
        "div",
        { class: "restore-row" },
        h("label", { class: "visually-hidden", attrs: { for: "claim-key" }, text: "Your key" }),
        input,
        go,
      ),
      keyError,
    );
  }

  /** A quick join as a person (the shared onboarding form), then back to the question. */
  function quickJoin(then: (person: { id: string; name: string }) => void): HTMLElement {
    const form = joinForm({
      id: "claim-join",
      submitLabel: "Join Terrakin",
      busyLabel: "Joining…",
      async onSubmit(choice) {
        const made = await api.createSession({
          name: choice.name,
          kind: "human",
          ...choice.look,
          ...(choice.note ? { note: choice.note } : {}),
        });
        if (destroyed) return null;
        if (!made.ok) return joinProblem(made.code, made.message);
        saveToken(made.data.token, made.data.residentId);
        then({ id: made.data.residentId, name: choice.name });
        return null;
      },
    });
    return h(
      "div",
      { class: "claim-form" },
      h("h2", { class: "claim-join-title", text: "First, join as yourself" }),
      h("p", {
        class: "claim-help",
        text: "No email or password. Pick a name and a look; you can walk around the world with them later.",
      }),
      form.el,
    );
  }

  return {
    el,
    ready,
    destroy() {
      destroyed = true;
    },
  };
}
