/**
 * `/k/:id`: one kindred (RFC 0033). Its name and members, its notice, its next kindred night with
 * Going, the weeks it gathered, and for its stewards one place to invite, write the notice, rename,
 * set the hall, and schedule a kindred night. An invite you hold shows Join and Not now. The server
 * decides everything: a button is one of its `you.moves`, or for the steward tools with no move of
 * their own (Make steward, Remove, Take back, Step down), shown to a steward and checked by the
 * world, and every refusal is its own words. Join shows on any invite, so a refusal says why it
 * can't happen yet. The name, the notice, and residents' names are their words: text nodes only.
 */
import { type Action, KINDRED_NOTICE, type KindredResponse } from "@terrakin/protocol";
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
import { eventsApi } from "./api/events";
import { kindredsApi } from "./api/kindreds";
import { residentsApi } from "./api/residents";
import { actProblem, worldApi } from "./api/world";
import { eventRow, openScheduleSheet } from "./event-cards";
import {
  gatheredLine,
  hallWords,
  inviteLine,
  inviteOpenLine,
  memberLine,
  membersWords,
  statusWords,
} from "./kindreds";
import { savedResidentId } from "./net";
import { pageData } from "./page-data";
import { failInto, notFoundCard, type View, type ViewContext } from "./view";

export function kindredView(id: string, ctx: ViewContext): View {
  ctx.setTitle("Kindred · Terrakin");
  // On a phone what someone came for (the notice, the night, the members) comes before the hall.
  const { el, head, main, side } = pageLayout("kindred-page", "The kindred's hall and stewards", {
    sideLast: true,
  });
  const me = savedResidentId() ?? undefined;

  const act = (button: HTMLButtonElement, action: Action, done: string) =>
    actFromButton(button, action, done, { gone: loader.gone, after: loader.refresh });
  // Once you've left or turned down a forming kindred its page is closed to you, so it goes back to
  // the Town Hall's list rather than keep drawing what you can no longer do.
  const actAndGo = (button: HTMLButtonElement, action: Action, done: string) =>
    actFromButton(button, action, done, {
      gone: loader.gone,
      after: () => ctx.navigate("/town#kindreds"),
    });

  function paint(data: KindredResponse) {
    const { kindred: k, you, rules } = data;
    const moves = new Set(you?.moves ?? []);
    head.replaceChildren(
      h("h1", { class: "page-title kindred-name", text: k.name }),
      h(
        "p",
        { class: "cluster kindred-meta" },
        kindPill(statusWords(k.status), k.status === "formed" ? "moss" : "sun"),
        h("span", {
          text: `${membersWords(k.members.length)} · ${gatheredLine(k.gathered, k.run)}`,
        }),
      ),
    );

    const invite = you?.invite
      ? h(
          "section",
          { class: "stack paper card kindred-invite", attrs: { "aria-label": "Your invite" } },
          h("p", { text: inviteLine(you.invite) }),
          h("p", {
            class: "hint",
            text: "Joining is your choice. You'd be in this kindred alone, and leaving means a week before another.",
          }),
          h(
            "div",
            { class: "cluster" },
            actionButton("join_kindred", "Join", "btn-primary", (b) =>
              act(b, { type: "join_kindred", kindred: k.id }, "You're in."),
            ),
            actionButton("decline_kindred_invite", "Not now", "pill-button", (b) =>
              actAndGo(b, { type: "decline_kindred_invite", kindred: k.id }, "Invite turned down."),
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
      { class: "stack paper card kindred-notice", attrs: { "aria-labelledby": "kindred-notice" } },
      h("h2", { class: "section-title", attrs: { id: "kindred-notice" }, text: "Notice" }),
      k.notice
        ? h("p", { class: "kindred-notice-text", text: k.notice.text })
        : h("p", { class: "hint", text: "No notice yet." }),
      moves.has("set_kindred_notice") ? noticeForm(k.notice?.text ?? "") : null,
    );

    const nights = h(
      "section",
      { class: "stack kindred-nights", attrs: { "aria-labelledby": "kindred-nights" } },
      h("h2", { class: "section-title", attrs: { id: "kindred-nights" }, text: "Kindred night" }),
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
            "No kindred night on the calendar",
            k.hall
              ? "Any member can hold one at the hall, once a week."
              : "A steward sets the hall first.",
          ),
      moves.has("schedule_kindred_night") && k.hall ? scheduleButton(k.id, k.hall, rules) : null,
    );

    const members = h(
      "section",
      { class: "stack kindred-members", attrs: { "aria-labelledby": "kindred-members" } },
      h("h2", { class: "section-title", attrs: { id: "kindred-members" }, text: "Members" }),
      itemRows(
        k.members.map((m) =>
          itemRow({
            className: "kindred-member",
            attrs: { "data-resident": m.resident.id },
            lead: avatarEl(m.resident, "sm"),
            name: m.resident.name,
            lines: [memberLine(m, m.resident.id === data.kindred.founder, data.day)],
            trail: you?.steward ? memberActions(m.resident.id, m.steward, k.members.length) : null,
          }),
        ),
        { className: "kindred-member-rows" },
      ),
    );
    main.replaceChildren(...[invite, notice, nights, members].filter((x) => x !== null));

    const sideCards: (HTMLElement | null)[] = [
      h(
        "section",
        { class: "stack paper card kindred-hall", attrs: { "aria-label": "Its hall" } },
        h("p", { class: "cluster" }, icon("home"), h("span", { text: hallWords(k.hall) })),
        h("p", {
          class: "hint",
          text: `Kindred nights count once ${rules.nightMembers} members from ${rules.nightHouseholds} households come. Members aren't counted guests at their own night.`,
        }),
        moves.has("set_kindred_hall") ? hallForm(k.hall, k.nights.length > 0) : null,
      ),
      you?.steward ? stewardCard(data, moves) : null,
      moves.has("leave_kindred") ? leaveButton() : null,
    ];
    side.replaceChildren(...sideCards.filter((x): x is HTMLElement => x !== null));
  }

  function noticeForm(text: string): HTMLElement {
    const open = h("button", {
      class: "text-button",
      attrs: { type: "button", id: "kindred-notice-edit" },
      text: "Edit notice",
    });
    const input = h("textarea", {
      class: "field-input",
      attrs: { id: "kindred-notice-input", rows: 3, maxlength: KINDRED_NOTICE.max },
    });
    input.value = text;
    const save = h("button", {
      class: "btn-primary small",
      attrs: { type: "submit" },
      text: "Save notice",
    });
    const problem = errorLine("kindred-notice-error");
    const panel = h(
      "form",
      {
        class: "stack tight",
        attrs: { hidden: true, id: "kindred-notice-form", novalidate: true },
      },
      input,
      problem,
      save,
    );
    disclosure(open, panel, input);
    panel.addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await whileBusy(save, () => kindredsApi.setNotice(id, input.value));
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
      attrs: { type: "button", id: "kindred-hall-open" },
      text: "Set the hall",
    });
    const panel = h("div", { class: "cluster", attrs: { hidden: true, id: "kindred-hall-plots" } });
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
                void act(button, { type: "set_kindred_hall", ...p }, "That's the hall now.");
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

  function stewardCard(data: KindredResponse, moves: ReadonlySet<string>): HTMLElement {
    const handle = h("input", {
      class: "field-input",
      attrs: { id: "kindred-invite-handle", placeholder: "their handle", autocomplete: "off" },
    });
    const send = h("button", {
      class: "btn-primary small",
      attrs: { type: "submit", id: "kindred-invite-send" },
      text: "Invite",
    });
    const problem = errorLine("kindred-invite-error");
    const invite = h(
      "form",
      { class: "stack tight", attrs: { novalidate: true } },
      h("label", {
        class: "field-label",
        attrs: { for: "kindred-invite-handle" },
        text: "Invite a neighbor",
      }),
      h("div", { class: "cluster" }, handle, send),
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
      const r = await whileBusy(send, () =>
        worldApi.act({ type: "invite_to_kindred", resident: found.data.resident.id }),
      );
      const refused = actProblem(r);
      if (refused) {
        problem.textContent = refused;
        return;
      }
      handle.value = "";
      toast(`Invited @${who}.`);
      await loader.refresh();
    });
    const invites = data.you?.invites ?? [];
    return h(
      "section",
      { class: "stack paper card kindred-steward", attrs: { "aria-label": "For stewards" } },
      moves.has("invite_to_kindred")
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
                lines: [inviteOpenLine(i.lapsesDay, data.day)],
                trail: cancelInvite(i.resident.id),
              }),
            ),
            { className: "kindred-invites" },
          )
        : null,
      moves.has("name_kindred")
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
      () => void act(button, { type: "cancel_kindred_invite", resident }, "Invite taken back."),
    );
    return button;
  }

  function renameForm(nameMax: number): HTMLElement {
    const open = h("button", { class: "text-button", attrs: { type: "button" }, text: "Rename" });
    const input = h("input", {
      class: "field-input",
      attrs: { id: "kindred-rename", maxlength: nameMax, autocomplete: "off" },
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
      h("p", { class: "hint", text: "A kindred is renamed once a week, Monday to Sunday." }),
    );
    disclosure(open, panel, input);
    panel.addEventListener("submit", (e) => {
      e.preventDefault();
      void act(save, { type: "name_kindred", name: input.value.trim() }, "Renamed.");
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
              { type: "set_kindred_steward", resident, steward: false },
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
          void act(
            make,
            { type: "set_kindred_steward", resident, steward: true },
            "A steward now.",
          ),
      );
      const remove = h("button", {
        class: "text-button",
        attrs: { type: "button" },
        text: "Remove",
      });
      confirmTwice(
        remove,
        "Tap again to remove",
        () => void act(remove, { type: "remove_from_kindred", resident }, "Removed."),
      );
      row.append(make, remove);
    }
    return row.childElementCount > 0 ? row : null;
  }

  function leaveButton(): HTMLElement {
    const button = h("button", {
      class: "pill-button small",
      attrs: { type: "button", id: "kindred-leave" },
      text: "Leave the kindred",
    });
    confirmTwice(
      button,
      "Tap again to leave",
      () => void actAndGo(button, { type: "leave_kindred" }, "You left."),
    );
    return h("p", {}, button);
  }

  /**
   * Hold a kindred night: read the server's clock and rules fresh, then open the Schedule sheet with
   * the hall as its one place. The world checks the rest: that you're a member, that it's formed,
   * and that the week has no other night.
   */
  function scheduleButton(
    kindred: string,
    hall: { px: number; py: number },
    rules: KindredResponse["rules"],
  ): HTMLElement {
    const button = h(
      "button",
      { class: "pill-button", attrs: { type: "button", id: "kindred-night-host" } },
      icon("calendar"),
      h("span", { text: "Hold a kindred night" }),
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
        kindred: {
          id: kindred,
          hall,
          counts: { members: rules.nightMembers, households: rules.nightHouseholds },
        },
      });
    });
    return button;
  }

  const loader = pageData({
    ask: () => kindredsApi.kindred(id),
    paint,
    fail: failInto(main, () => notFoundCard("No kindred here")),
  });
  return { el, ready: loader.ready, destroy: loader.leave };
}
