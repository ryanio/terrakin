import { type AreaRouteIds, type GestureItem, INVITE_PLOT_SUGGESTIONS } from "@terrakin/protocol";
import type { Api } from "../api";
import { anchorPlot, suggestPlots } from "../together";
import {
  fail,
  fromResult,
  givenItem,
  type Handlers,
  INVITE_GONE,
  MAX_LETTER_READS_IN_FLIGHT,
} from "./shared";

/**
 * The handlers for invites, letters, gestures, and blocks (decision 0024). Their routes are in the
 * protocol's `route-table/together.ts`.
 */
export function togetherHandlers(api: Api): Pick<Handlers, AreaRouteIds["together"]> {
  const { service } = api;
  const social = () => api.requireSocial();
  return {
    createInvite: ({ viewer, body }) => {
      const share = body.share === true;
      if (share && !anchorPlot(service.state, viewer)?.owned) {
        return fail("bad_request", "Settle a plot of your own first, then you can share it.");
      }
      return fromResult(social().together.createInvite(viewer, share), (invite) => ({
        status: 201 as const,
        body: { invite },
      }));
    },
    getInvite: ({ params }) => {
      const invite = social().together.openInvite(params.code);
      const inviter = invite && social().authorView(invite.inviter);
      if (!invite || !inviter) return fail("not_found", INVITE_GONE);
      const anchor = anchorPlot(service.state, invite.inviter);
      const sharedPlot = invite.share && anchor?.owned ? { px: anchor.px, py: anchor.py } : null;
      return {
        status: 200,
        body: {
          invite: {
            code: invite.code,
            inviter,
            share: sharedPlot !== null,
            sharedPlot,
            plots: anchor ? suggestPlots(service.state, anchor, INVITE_PLOT_SUGGESTIONS) : [],
            expiresAt: invite.expiresAt,
          },
        },
      };
    },
    acceptInvite: ({ params, body }) => api.acceptInvite(params.code, body),
    createLetter: async ({ viewer, body }) =>
      fromResult(await social().together.createLetter(viewer, body), (letter) => ({
        status: 201 as const,
        body: { letter },
      })),
    getLetters: ({ viewer, query }) => ({
      status: 200,
      body: social().together.letters(viewer, query),
    }),
    getLetter: ({ viewer, params }) => {
      // Not yours and not there look the same, so nobody learns a letter exists.
      const letter = social().together.openLetter(viewer, params.id);
      return letter ? { status: 200, body: { letter } } : fail("not_found", "No such letter.");
    },
    deleteLetter: async ({ viewer, params }) =>
      (await social().together.deleteLetter(viewer, params.id))
        ? { status: 204 }
        : fail("not_found", "No such letter."),
    getLetterMedia: async ({ viewer, params }) => {
      // Each read holds a whole picture in the one world object's memory, so only a few at once.
      if (api.letterReadsInFlight >= MAX_LETTER_READS_IN_FLIGHT) {
        return fail("rate_limited", "Lots of pictures loading right now. Try again in a moment.");
      }
      api.letterReadsInFlight++;
      try {
        const file = await social().together.letterMedia(viewer, params.id, params.mediaId);
        return file
          ? { status: 200, bytes: file.bytes, contentType: file.type }
          : fail("not_found", "Not found.");
      } finally {
        api.letterReadsInFlight--;
      }
    },
    sendGesture: ({ viewer, params, body }) => {
      const together = social().together;
      let item: GestureItem | undefined;
      if (body.item !== undefined) {
        // A gift that carries a thing: the gesture's own checks first, then the thing moves in
        // the world like any `give` (its limits, blocks, and note filter), then the gesture.
        const checked = together.checkGesture(viewer, params.id, body);
        if (!checked.ok) return fail(checked.code, checked.message);
        const { note } = checked.value;
        service.arrive(viewer, "give");
        const given = service.act(viewer, {
          type: "give",
          item: body.item,
          to: params.id,
          ...(body.count === undefined ? {} : { count: body.count }),
          ...(note ? { note } : {}),
        });
        if (!given.ok) return fail(given.error.code, given.error.message);
        item = givenItem(given.events, viewer);
      }
      const sent = together.sendGesture(viewer, params.id, body, item ? { item } : {});
      if (sent.ok && !sent.value.secret) {
        service.notify(params.id, together.liveGesture(sent.value.gesture, sent.value.streak));
      }
      return fromResult(sent, (value) => ({ status: 201 as const, body: value }));
    },
    getGestures: ({ viewer, query }) => ({
      status: 200,
      body: social().together.gestures(viewer, query),
    }),
    blockResident: ({ viewer, params }) =>
      fromResult(social().setBlock(viewer, params.id, true), (resident) => ({
        status: 200 as const,
        body: { resident },
      })),
    unblockResident: ({ viewer, params }) =>
      fromResult(social().setBlock(viewer, params.id, false), (resident) => ({
        status: 200 as const,
        body: { resident },
      })),
  };
}
