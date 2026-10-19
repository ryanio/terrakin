/**
 * `/c/:id`: one circle (RFC 0033). Its name and members, its notice, its next circle night with
 * Going, the weeks it gathered, and for its stewards one place to invite, write the notice, rename,
 * set the hall, and schedule a circle night. An invite you hold shows Join and Not now. The server
 * decides everything: a button is one of its `you.moves`, or for the steward tools with no move of
 * their own (Make steward, Remove, Take back, Step down), shown to a steward and checked by the
 * world, and every refusal is its own words. Join shows on any invite, so a refusal says why it
 * can't happen yet. The name, the notice, and residents' names are their words: text nodes only.
 */

import { type Action, CIRCLE_NOTICE, type CircleResponse } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { avatarEl } from "@terrakin/ui/people";
import {
  confirmTwice,
  disclosure,
  emptyNote,
  errorLine,
  itemRow,
  itemRows,
  kindPill,
  pageLayout,
  toast,
  whileBusy,
} from "@terrakin/ui/ui";
import { actFromButton } from "./act";
import { circlesApi } from "./api/circles";
import { eventsApi } from "./api/events";
import { residentsApi } from "./api/residents";
import { actProblem, worldApi } from "./api/world";
import {
  gatheredLine,
  hallWords,
  inviteLine,
  inviteOpenLine,
  inviteStandingLine,
  memberLine,
  membersWords,
  statusWords,
} from "./circles";
import { eventRow, openScheduleSheet } from "./event-cards";
import { savedResidentId } from "./net";
import { pageData } from "./page-data";
import { coins as coinWords } from "./purse";
import { failInto, notFoundCard, type View, type ViewContext } from "./view";

export function circleView(id: string, ctx: ViewContext): View {
  ctx.setTitle("Circle · Terrakin");
  // On a phone what someone came for (the notice, the night, the members) comes before the hall.
  const { el, head, main, side } = pageLayout("circle-page", "The circle's hall and stewards", {
    sideLast: true,
  });
  const me = savedResidentId() ?? undefined;

  const act = (button: HTMLButtonElement, action: Action, done: string) =>
    actFromButton(button, action, done, { gone: loader.gone, after: loader.refresh });
  // Once you've left or turned down a forming circle its page is closed to you, so it goes back to
  // the Town Hall's list rather than keep drawing what you can no longer do.
  const actAndGo = (button: HTMLButtonElement, action: Action, done: string) =>
    actFromButton(button, action, done, {
      gone: loader.gone,
      after: () => ctx.navigate("/town#circles"),
    });

  function paint(data: CircleResponse) {
    const { circle: k, you, rules } = data;
    const moves = new Set(you?.moves ?? []);
    head.replaceChildren(
      h("h1", { class: "page-title circle-name", text: k.name }),
      h(
        "p",
        { class: "cluster circle-meta" },
        kindPill(statusWords(k.status), k.status === "formed" ? "moss" : "sun"),
        h("span", {
          text: `${membersWords(k.members.length)} · ${gatheredLine(k.gathered, k.run)}`,
        }),
      ),
    );

    const invite = you?.invite
      ? h(
          "section",
          { class: "stack paper card circle-invite", attrs: { "aria-label": "Your invite" } },
          h("p", { text: inviteLine(you.invite) }),
          // The steward's own words to you, drawn as text (issue #73). What the circle is for is
          // on the invite too, for readers with no page; here the Notice section below has it.
          you.invite.note === null
            ? null
            : h("p", { class: "circle-invite-note", text: you.invite.note }),
          h("p", { class: "hint", text: inviteStandingLine(you.invite, rules) }),
          h("p", { class: "hint", text: `${inviteOpenLine(you.invite)}.` }),
          h("p", { class: "hint", text: `Joining is your choice. ${you.invite.joining}` }),
          h(
            "div",
            { class: "cluster" },
            actionButton("join_circle", "Join", "btn-primary", (b) =>
              act(b, { type: "join_circle", circle: k.id }, "You're in."),
            ),
            actionButton("decline_circle_invite", "Not now", "pill-button", (b) =>
              actAndGo(b, { type: "decline_circle_invite", circle: k.id }, "Invite turned down."),
            ),
          ),
        )
      : null;

    function actionButton(
      move: string,
      text: string,
      cls: string,
      send: (button: HTMLButtonElement) => unknown,
    ): HTMLButtonElement {
      const button = h("button", {
        class: `${cls} small`,
        attrs: { type: "button", "data-move": move },
        text,
      });
      button.addEventListener("click", () => void send(button));
      return button;
    }

    const notice = h(
      "section",
      { class: "stack paper card circle-notice", attrs: { "aria-labelledby": "circle-notice" } },
      h("h2", { class: "section-title", attrs: { id: "circle-notice" }, text: "Notice" }),
      k.notice
        ? h("p", { class: "circle-notice-text", text: k.notice.text })
        : h("p", { class: "hint", text: "No notice yet." }),
      moves.has("set_circle_notice") ? noticeForm(k.notice?.text ?? "") : null,
    );

    const nights = h(
      "section",
      { class: "stack circle-nights", attrs: { "aria-labelledby": "circle-nights" } },
      h("h2", { class: "section-title", attrs: { id: "circle-nights" }, text: "Circle night" }),
      k.nights.length > 0
        ? h(
            "ul",
            { class: "stack plain-list paper card event-list" },
            ...k.nights.map((e) =>
              eventRow(e, {
                now: Date.now(),
                me,
                navigate: ctx.navigate,
                changed: () => void loader.refresh(),
              }),
            ),
          )
        : emptyNote(
            "No circle night on the calendar",
            k.hall
              ? "Any member can hold one at the hall, once a week."
              : "A steward sets the hall first.",
          ),
      moves.has("schedule_circle_night") && k.hall ? scheduleButton(k.id, k.hall, rules) : null,
    );

    const members = h(
      "section",
      { class: "stack circle-members", attrs: { "aria-labelledby": "circle-members" } },
      h("h2", { class: "section-title", attrs: { id: "circle-members" }, text: "Members" }),
      itemRows(
        k.members.map((m) =>
          itemRow({
            className: "circle-member",
            attrs: { "data-resident": m.resident.id },
            lead: avatarEl(m.resident, "sm"),
            name: m.resident.name,
            lines: [memberLine(m, m.resident.id === data.circle.founder, data.day)],
            trail: you?.steward ? memberActions(m.resident.id, m.steward, k.members.length) : null,
          }),
        ),
        { className: "circle-member-rows" },
      ),
    );
    main.replaceChildren(...[invite, notice, nights, members].filter((x) => x !== null));

    const sideCards: (HTMLElement | null)[] = [
      h(
        "section",
        { class: "stack paper card circle-hall", attrs: { "aria-label": "Its hall" } },
        h("p", { class: "cluster" }, icon("home"), h("span", { text: hallWords(k.hall) })),
        h("p", {
          class: "hint",
          text: `Circle nights count once ${rules.nightMembers} members from ${rules.nightHouseholds} households come. Members aren't counted guests at their own night.`,
        }),
        moves.has("set_circle_hall") ? hallForm(k.hall, k.nights.length > 0) : null,
      ),
      you?.steward ? stewardCard(data, moves) : null,
      k.status === "forming" ? feeCard(data, moves) : null,
      moves.has("leave_circle") ? leaveButton() : null,
    ];
    side.replaceChildren(...sideCards.filter((x): x is HTMLElement => x !== null));
  }

  function noticeForm(text: string): HTMLElement {
    const open = h("button", {
      class: "text-button",
      attrs: { type: "button", id: "circle-notice-edit" },
      text: "Edit notice",
    });
    const input = h("textarea", {
      class: "field-input",
      attrs: { id: "circle-notice-input", rows: 3, maxlength: CIRCLE_NOTICE.max },
    });
    input.value = text;
    const save = h("button", {
      class: "btn-primary small",
      attrs: { type: "submit" },
      text: "Save notice",
    });
    const problem = errorLine("circle-notice-error");
    const panel = h(
      "form",
      {
        class: "stack tight",
        attrs: { hidden: true, id: "circle-notice-form", novalidate: true },
      },
      input,
      problem,
      save,
    );
    disclosure(open, panel, input);
    panel.addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await whileBusy(save, () => circlesApi.setNotice(id, input.value));
      if (loader.gone()) return;
      if (!r.ok) {
        problem.textContent = r.message;
        return;
      }
      toast(r.data.notice ? "Notice up." : "Notice cleared.");
      await loader.refresh();
    });
    return h("div", { class: "stack tight" }, open, panel);
  }

  /**
   * Set the hall: a button for each plot you can build on but the hall itself, read when it's
   * opened, since the page itself doesn't carry them. Moving the hall calls off the nights booked
   * at the old one, so with one booked it takes a second tap. The server checks the plot is yours
   * to give.
   */
  function hallForm(hall: { px: number; py: number } | null, booked: boolean): HTMLElement {
    const open = h("button", {
      class: "text-button",
      attrs: { type: "button", id: "circle-hall-open" },
      text: "Set the hall",
    });
    const panel = h("div", { class: "cluster", attrs: { hidden: true, id: "circle-hall-plots" } });
    disclosure(open, panel, undefined, async (shown) => {
      if (!shown) return;
      const r = await eventsApi.events();
      if (loader.gone()) return;
      const plots = (r.ok ? (r.data.you?.plots ?? []) : []).filter(
        (p) => !(hall && p.px === hall.px && p.py === hall.py),
      );
      panel.replaceChildren(
        ...(plots.length > 0
          ? plots.map((p) => {
              const button = h("button", {
                class: "pill-button small",
                attrs: { type: "button", "data-plot": `${p.px},${p.py}` },
                text: `Plot ${p.px}, ${p.py}`,
              });
              const move = () =>
                void act(button, { type: "set_circle_hall", ...p }, "That's the hall now.");
              if (booked) confirmTwice(button, "Tap again: its nights are called off", move);
              else button.addEventListener("click", move);
              return button;
            })
          : [
              h("p", {
                class: "hint",
                text: !r.ok
                  ? r.message
                  : hall
                    ? "You have no other plot to make the hall."
                    : "You have no plot to make the hall.",
              }),
            ]),
      );
    });
    return h("div", { class: "stack tight" }, open, panel);
  }

  function stewardCard(data: CircleResponse, moves: ReadonlySet<string>): HTMLElement {
    const handle = h("input", {
      class: "field-input",
      attrs: { id: "circle-invite-handle", placeholder: "their handle", autocomplete: "off" },
    });
    const send = h("button", {
      class: "btn-primary small",
      attrs: { type: "submit", id: "circle-invite-send" },
      text: "Invite",
    });
    const problem = errorLine("circle-invite-error");
    // A note with the invite (issue #73): why them, and what the circle is for. Optional, so an
    // empty box sends the invite as it always did.
    const note = h("textarea", {
      class: "field-input",
      attrs: {
        id: "circle-invite-note",
        rows: 2,
        maxlength: data.rules.inviteNoteMax,
        placeholder: "why you're asking them (optional)",
      },
    });
    const invite = h(
      "form",
      { class: "stack tight", attrs: { novalidate: true } },
      h("label", {
        class: "field-label",
        attrs: { for: "circle-invite-handle" },
        text: "Invite a neighbor",
      }),
      handle,
      h("label", {
        class: "field-label",
        attrs: { for: "circle-invite-note" },
        text: "A note to them",
      }),
      note,
      h("div", { class: "cluster" }, send),
      problem,
    );
    invite.addEventListener("submit", async (e) => {
      e.preventDefault();
      const who = handle.value.trim().replace(/^@/, "");
      if (!who) return handle.focus();
      problem.textContent = "";
      const found = await whileBusy(send, () => residentsApi.byHandle(who));
      if (loader.gone()) return;
      if (!found.ok) {
        problem.textContent = `Nobody here goes by @${who}.`;
        return;
      }
      const words = note.value.trim();
      const r = await whileBusy(send, () =>
        worldApi.act({
          type: "invite_to_circle",
          resident: found.data.resident.id,
          ...(words ? { note: words } : {}),
        }),
      );
      const refused = actProblem(r);
      if (refused) {
        problem.textContent = refused;
        return;
      }
      handle.value = "";
      note.value = "";
      toast(`Invited @${who}.`);
      await loader.refresh();
    });
    const invites = data.you?.invites ?? [];
    return h(
      "section",
      { class: "stack paper card circle-steward", attrs: { "aria-label": "For stewards" } },
      moves.has("invite_to_circle")
        ? invite
        : h("p", {
            class: "hint",
            text: `No more invites for now: it has ${data.rules.membersMax} members or ${data.rules.invitesMax} open invites.`,
          }),
      invites.length > 0
        ? itemRows(
            invites.map((i) =>
              itemRow({
                plain: true,
                lead: avatarEl(i.resident, "sm"),
                name: i.resident.name,
                lines: [inviteOpenLine(i)],
                trail: cancelInvite(i.resident.id),
              }),
            ),
            { className: "circle-invites" },
          )
        : null,
      moves.has("name_circle")
        ? renameForm(data.rules.nameMax)
        : h("p", { class: "hint", text: "It was renamed this week. Next week it can be again." }),
    );
  }

  function cancelInvite(resident: string): HTMLButtonElement {
    const button = h("button", {
      class: "text-button",
      attrs: { type: "button" },
      text: "Take back",
    });
    button.addEventListener(
      "click",
      () => void act(button, { type: "cancel_circle_invite", resident }, "Invite taken back."),
    );
    return button;
  }

  function renameForm(nameMax: number): HTMLElement {
    const open = h("button", { class: "text-button", attrs: { type: "button" }, text: "Rename" });
    const input = h("input", {
      class: "field-input",
      attrs: { id: "circle-rename", maxlength: nameMax, autocomplete: "off" },
    });
    const save = h("button", {
      class: "pill-button small",
      attrs: { type: "submit" },
      text: "Save the name",
    });
    const panel = h(
      "form",
      { class: "stack tight", attrs: { hidden: true, novalidate: true } },
      h("div", { class: "cluster" }, input, save),
      h("p", { class: "hint", text: "A circle is renamed once a week, Monday to Sunday." }),
    );
    disclosure(open, panel, input);
    panel.addEventListener("submit", (e) => {
      e.preventDefault();
      void act(save, { type: "name_circle", name: input.value.trim() }, "Renamed.");
    });
    return h("div", { class: "stack tight" }, open, panel);
  }

  /**
   * A steward's buttons on a member's row. Others: Make steward, and Remove for anyone not a steward
   * (the world never removes a steward). Your own row: Step down, while someone else is in it.
   */
  function memberActions(resident: string, steward: boolean, members: number): HTMLElement | null {
    const row = h("div", { class: "cluster" });
    if (resident === me) {
      if (members > 1) {
        const down = h("button", {
          class: "text-button",
          attrs: { type: "button" },
          text: "Step down",
        });
        confirmTwice(
          down,
          "Tap again to step down",
          () =>
            void act(
              down,
              { type: "set_circle_steward", resident, steward: false },
              "You're not a steward now.",
            ),
        );
        row.append(down);
      }
    } else if (!steward) {
      const make = h("button", {
        class: "text-button",
        attrs: { type: "button" },
        text: "Make steward",
      });
      make.addEventListener(
        "click",
        () =>
          void act(make, { type: "set_circle_steward", resident, steward: true }, "A steward now."),
      );
      const remove = h("button", {
        class: "text-button",
        attrs: { type: "button" },
        text: "Remove",
      });
      confirmTwice(
        remove,
        "Tap again to remove",
        () => void act(remove, { type: "remove_from_circle", resident }, "Removed."),
      );
      row.append(make, remove);
    }
    return row.childElementCount > 0 ? row : null;
  }

  /**
   * While it forms: what members have chipped in toward the founder's fee, and for a member who
   * isn't the founder, Chip in (issue #69). The world checks the amount and the room left.
   */
  function feeCard(data: CircleResponse, moves: ReadonlySet<string>): HTMLElement {
    const { rules } = data;
    const room = rules.fee - rules.trialBurn;
    const card = h(
      "section",
      { class: "stack tight paper card circle-fee", attrs: { "aria-label": "Its fee" } },
      h("p", {
        text: `Members have chipped in ${data.circle.chippedIn} of the ${room} coins they can toward the founder's ${rules.fee}. If it doesn't form, members get theirs back, and the founder all but ${rules.trialBurn}.`,
      }),
    );
    if (!moves.has("chip_in_circle")) return card;
    const amount = h("input", {
      class: "field-input",
      attrs: {
        id: "circle-chip-amount",
        type: "number",
        inputmode: "numeric",
        min: 1,
        max: room - data.circle.chippedIn,
        value: Math.min(5, room - data.circle.chippedIn),
        "aria-label": "Coins to chip in",
      },
    });
    const send = h("button", {
      class: "btn-primary small",
      attrs: { type: "submit", id: "circle-chip-in" },
      text: "Chip in",
    });
    const problem = errorLine("circle-chip-error");
    const form = h("form", { class: "cluster", attrs: { novalidate: true } }, amount, send);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const coins = Number(amount.value);
      const r = await whileBusy(send, () =>
        worldApi.act({ type: "chip_in_circle", circle: data.circle.id, coins }),
      );
      const refused = actProblem(r);
      if (refused) {
        problem.textContent = refused;
        return;
      }
      toast(`You chipped in ${coinWords(coins)}.`);
      await loader.refresh();
    });
    card.append(form, problem);
    return card;
  }

  function leaveButton(): HTMLElement {
    const button = h("button", {
      class: "pill-button small",
      attrs: { type: "button", id: "circle-leave" },
      text: "Leave the circle",
    });
    confirmTwice(
      button,
      "Tap again to leave",
      () => void actAndGo(button, { type: "leave_circle" }, "You left."),
    );
    return h("p", {}, button);
  }

  /**
   * Hold a circle night: read the server's clock and rules fresh, then open the Schedule sheet with
   * the hall as its one place. The world checks the rest: that you're a member, that it's formed,
   * and that the week has no other night.
   */
  function scheduleButton(
    circle: string,
    hall: { px: number; py: number },
    rules: CircleResponse["rules"],
  ): HTMLElement {
    const button = h(
      "button",
      { class: "pill-button", attrs: { type: "button", id: "circle-night-host" } },
      icon("calendar"),
      h("span", { text: "Hold a circle night" }),
    );
    button.addEventListener("click", async () => {
      const r = await whileBusy(button, () => eventsApi.events());
      if (loader.gone()) return;
      if (!r.ok) {
        toast(r.message);
        return;
      }
      openScheduleSheet({
        events: r.data,
        commons: hall,
        done: () => void loader.refresh(),
        circle: {
          id: circle,
          hall,
          counts: { members: rules.nightMembers, households: rules.nightHouseholds },
        },
      });
    });
    return button;
  }

  const loader = pageData({
    ask: () => circlesApi.circle(id),
    paint,
    fail: failInto(main, () => notFoundCard("No circle here")),
  });
  return { el, ready: loader.ready, destroy: loader.leave };
}
