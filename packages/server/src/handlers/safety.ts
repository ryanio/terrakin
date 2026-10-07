import {
  type AreaRouteIds,
  MODERATOR_SUSPEND_MAX_DAYS,
  type SnapshotView,
  WORLD_LOG_PAGE_MAX,
  type WorldLogResponse,
} from "@terrakin/protocol";
import {
  findBounty,
  findEvent,
  goodById,
  heldAsideOf,
  listingById,
  plotNamesOf,
  REPLAY_VERSION,
} from "@terrakin/sim";
import { SUMMARY_DAYS } from "../ai-spend";
import type { Api } from "../api";
import { staffBountiesView } from "../bounties";
import { eventView } from "../events";
import { madeThingForReport } from "../galleries";
import { DEFAULT_ORIGIN } from "../links";
import { newcomerFunnel, socialActors, thingHolders } from "../newcomers";
import { reportable, type SnapshotHeader } from "../snapshots";
import { staffKeyId, staffKeyView, staffOwner } from "../staff-keys";
import { report } from "../telemetry";
import { cleanText } from "../text";
import { utcDay } from "../world-service";
import {
  DAILY_CAP_RETRY_SECONDS,
  fail,
  type Handlers,
  logged,
  MAINTAINERS_ONLY,
  STAFF_ONLY,
  WORLD_MAINTAINERS_ONLY,
  worldStaffId,
} from "./shared";

/**
 * The handlers for safety and staff: reports, transparency, review, moderation, bounties, events,
 * and world snapshots. Their routes are in the protocol's `route-table/safety.ts`.
 */
export function safetyHandlers(api: Api): Pick<Handlers, AreaRouteIds["safety"]> {
  const { service } = api;
  const social = () => api.requireSocial();
  return {
    createReport: ({ viewer, body }) => {
      const filed = social().safety.report(viewer, body);
      if (!filed.ok) {
        return fail(
          filed.code,
          filed.message,
          filed.code === "rate_limited" ? DAILY_CAP_RETRY_SECONDS : undefined,
        );
      }
      const { report, created } = filed.value;
      return created
        ? { status: 201 as const, body: { report } }
        : { status: 200 as const, body: { report } };
    },
    getTransparency: () => ({ status: 200, body: social().safety.transparency() }),
    getAdminOverview: ({ viewer }) => {
      const role = api.staffRole(viewer);
      if (!role) return fail("forbidden", STAFF_ONLY);
      const owner = staffOwner(viewer);
      const via =
        staffKeyId(viewer) !== undefined
          ? ("key" as const)
          : owner.startsWith("access:")
            ? ("access" as const)
            : ("token" as const);
      // An Access sign-in shows the resident it's mapped to, so staff can see the mapping took.
      const resident = api.staffResident(viewer);
      return {
        status: 200,
        body: {
          me: {
            actor: owner,
            role,
            via,
            resident: resident === undefined ? null : (social().authorView(resident) ?? null),
          },
          triage: social().safety.triageStatus(),
          checkins: social().checkins.stats(),
          spend: {
            ...(api.spendLedger?.summary() ?? {
              todayMicroUsd: 0,
              windowMicroUsd: 0,
              lines: [],
              chatter: { calls: 0, notes: 0, drafts: 0, refused: 0, microUsd: 0 },
            }),
            days: SUMMARY_DAYS,
          },
          chatter: api.chatterStatus(),
          tips: api.tipsStatus(),
        },
      };
    },
    getTownsfolkActivity: () => ({ status: 200, body: api.townsfolkActivity() }),
    getReports: ({ query }) => {
      const queue = social().safety.queue(query.limit);
      // Say which suspensions and hold-backs only a maintainer may change, so the staff app
      // offers moderators only what the routes below will accept.
      const items = queue.items.map((item) => {
        const person = item.kind === "resident" ? item.id : item.target.author?.id;
        if (!person) return item;
        const suspensionLocked = api.suspensionLocked(person);
        const holdBackLocked = api.holdBackLocked(person);
        return {
          ...item,
          target: {
            ...item.target,
            ...(suspensionLocked ? { suspensionLocked } : {}),
            ...(holdBackLocked ? { holdBackLocked } : {}),
          },
        };
      });
      return { status: 200, body: { ...queue, items } };
    },
    getModerationLog: ({ query }) => ({ status: 200, body: social().safety.logPage(query) }),
    dismissReports: ({ viewer, body }) =>
      logged(social().safety.dismiss(viewer, body.kind, body.id, body.reason)),
    hidePost: async ({ viewer, params, body }) =>
      logged(await social().safety.hidePost(viewer, params.id, body.reason, body.rule)),
    unhidePost: ({ viewer, params, body }) =>
      logged(social().safety.unhidePost(viewer, params.id, body.reason)),
    suspendResident: ({ viewer, params, body }) => {
      if (api.staffRole(viewer) !== "maintainer" && body.days > MODERATOR_SUSPEND_MAX_DAYS) {
        return fail(
          "forbidden",
          `Moderators can suspend for up to ${MODERATOR_SUSPEND_MAX_DAYS} days. Ask a maintainer for longer.`,
        );
      }
      const locked = api.maintainersSuspension(viewer, params.id);
      if (locked) return locked;
      return logged(social().safety.suspend(viewer, params.id, body.days, body.reason));
    },
    unsuspendResident: ({ viewer, params, body }) =>
      api.maintainersSuspension(viewer, params.id) ??
      logged(social().safety.unsuspend(viewer, params.id, body.reason)),
    quarantineResident: ({ viewer, params, body }) =>
      logged(social().safety.quarantine(viewer, params.id, body.reason)),
    releaseResident: ({ viewer, params, body }) => {
      if (api.staffRole(viewer) !== "maintainer" && api.holdBackLocked(params.id)) {
        return fail("forbidden", "A maintainer held these back. Ask a maintainer to release them.");
      }
      return logged(social().safety.release(viewer, params.id, body.reason));
    },
    removeResidentPictures: async ({ viewer, params, body }) =>
      logged(await social().safety.removePictures(viewer, params.id, body.reason, body.rule)),
    // Decision 0121: every name that's theirs to answer for comes down, on plots they own and names
    // they wrote on plots shared with them. Whoever wrote each one hears it (decision 0064).
    clearPlotNames: ({ viewer, params, body }) => {
      const names = plotNamesOf(service.state, params.id);
      if (names.length === 0) return fail("not_found", "They have no plot names to take down.");
      const safety = social().safety;
      const rule = safety.ruleFor(["resident"], params.id, body.rule);
      for (const p of names) {
        const done = service.clearPlotName(p.px, p.py);
        if (!done.ok) return fail(done.error.code, done.error.message);
      }
      const entry = safety.recordAction(
        viewer,
        "clear_plot_names",
        "resident",
        params.id,
        body.reason,
        rule,
      );
      for (const p of names) {
        safety.tellOwner(p.namedBy, {
          what: "plot_name",
          rule,
          outcome: "removed",
          plot: { px: p.px, py: p.py },
        });
      }
      return { status: 200, body: { logged: entry } };
    },
    // Decision 0056: the lot goes back to its seller, or waits out of view when they're full.
    removeListing: ({ viewer, params, body }) => {
      const listing = listingById(service.state, params.id);
      if (!listing || listing.takenDown) {
        return fail("not_found", "That listing isn't in the market any more.");
      }
      const safety = social().safety;
      const rule = safety.ruleFor(["listing"], params.id, body.rule);
      const done = service.removeListing(params.id);
      if (!done.ok) return fail(done.error.code, done.error.message);
      const entry = safety.recordAction(
        viewer,
        "remove_listing",
        "listing",
        params.id,
        body.reason,
        rule,
      );
      // Decision 0064: the seller hears what came down, why, and where the lot is now.
      safety.tellOwner(listing.seller, {
        what: "listing",
        rule,
        outcome: listingById(service.state, params.id) ? "held" : "returned",
        id: params.id,
        kind: listing.kind,
        count: listing.count,
      });
      return { status: 200, body: { logged: entry } };
    },
    // Decision 0059: the thing goes back to whoever put it up, or waits for room. It settles the
    // reports on it either way: as a thing on display, and as a piece (a title, say).
    removeDisplay: ({ viewer, params, body }) => {
      const shown = madeThingForReport(service.state, "display", params.id);
      const kind = goodById(service.state, params.id)?.good.kind;
      if (!shown || !kind) return fail("not_found", "That isn't on display any more.");
      const safety = social().safety;
      const rule = safety.ruleFor(["display", "piece"], params.id, body.rule);
      const done = service.removeDisplay(params.id, false);
      if (!done.ok) return fail(done.error.code, done.error.message);
      safety.closeReports(viewer, "piece", params.id);
      const entry = safety.recordAction(
        viewer,
        "remove_display",
        "display",
        params.id,
        body.reason,
        rule,
      );
      // Decision 0064: whoever put it up hears it, and whether it's back or held for them.
      const held = heldAsideOf(service.state, shown.owner).some((d) => d.good.id === params.id);
      safety.tellOwner(shown.owner, {
        what: "display",
        rule,
        outcome: held ? "held" : "returned",
        id: params.id,
        kind,
      });
      return { status: 200, body: { logged: entry } };
    },
    // Decision 0059: the file goes first, everywhere, so the world never says it's gone while
    // storage still serves it. Then every piece made from it loses its picture, and this one
    // comes off display if it's up.
    removePiece: async ({ viewer, params, body }) => {
      const safety = social().safety;
      const media = madeThingForReport(service.state, "piece", params.id)?.media;
      if (!media) return fail("not_found", "No piece with that id shows a picture.");
      // Like a resident's pictures: the upload may be staff's avatar too.
      const maker = goodById(service.state, params.id)?.good.maker;
      if (maker && safety.protects(maker)) {
        return fail(
          "bad_request",
          "Staff's pictures can't be removed. Take them off the staff list first.",
        );
      }
      const check = service.removeDisplay(params.id, true, true);
      if (!check.ok) return fail(check.error.code, check.error.message);
      const rule = safety.ruleFor(["piece", "display"], params.id, body.rule);
      if (!(await safety.purgeUpload(media))) {
        return fail("internal", "The picture couldn't be deleted from storage yet. Try again.");
      }
      const done = service.removeDisplay(params.id, true);
      if (!done.ok) {
        // The file is gone: say so in the log, and leave the reports open to try again.
        safety.recordNote(viewer, "remove_piece", "piece", params.id, body.reason);
        return fail(done.error.code, done.error.message);
      }
      // Every piece that showed the picture is settled, wherever its reports are.
      const removed = done.events.flatMap((e) => (e.type === "picture_removed" ? e.items : []));
      for (const id of new Set([params.id, ...removed])) {
        safety.closeReports(viewer, "display", id);
        if (id !== params.id) safety.closeReports(viewer, "piece", id);
      }
      const entry = safety.recordAction(
        viewer,
        "remove_piece",
        "piece",
        params.id,
        body.reason,
        rule,
      );
      // Decision 0064: its maker hears it once, however many pieces showed the picture.
      if (maker) {
        safety.tellOwner(maker, {
          what: "piece",
          rule,
          outcome: "removed",
          id: params.id,
          kind: "piece",
        });
      }
      // Decision 0065: whoever holds or displays a piece made from the picture hears it too,
      // once per piece, not only its maker.
      for (const pieceId of new Set([params.id, ...removed])) {
        const holder = goodById(service.state, pieceId)?.holder;
        if (!holder || holder === maker) continue;
        safety.tellOwner(holder, {
          what: "piece",
          rule,
          outcome: "removed",
          id: pieceId,
          kind: "piece",
        });
      }
      return { status: 200, body: { logged: entry } };
    },
    // Staff keys (RFC 0026): a staff member's own, made and revoked signed in as themselves.
    getStaffKeys: ({ viewer }) => {
      const keys = social().staffKeys;
      const rows = api.staffRole(viewer) === "maintainer" ? keys.list() : keys.list(viewer);
      return {
        status: 200,
        body: {
          keys: rows.map((r) => staffKeyView(r, viewer, social().authorView(r.owner) ?? null)),
        },
      };
    },
    createStaffKey: ({ viewer, body }) => {
      // Its name shows in the log beside everything it does, so it's cleaned like residents' text.
      const name = cleanText(body.name);
      if (!name) return fail("bad_request", "Give the key a name, like Ryan's Claude.");
      const { row, secret } = social().staffKeys.mint(viewer, name, body.scope, body.days);
      return {
        status: 201,
        body: {
          key: staffKeyView(row, viewer, social().authorView(row.owner) ?? null),
          secret,
        },
      };
    },
    revokeStaffKey: ({ viewer, params }) => {
      const keys = social().staffKeys;
      const row = keys.row(params.id);
      if (!row) return fail("not_found", "No staff key has that id.");
      if (row.owner !== viewer && api.staffRole(viewer) !== "maintainer") {
        return fail("forbidden", "Only its maker or a maintainer can revoke a staff key.");
      }
      const revoked = keys.revoke(params.id) ?? row;
      return {
        status: 200,
        body: { key: staffKeyView(revoked, viewer, social().authorView(revoked.owner) ?? null) },
      };
    },
    // An agent that lost its key, or was revoked, back in through the team (decision 0149). The
    // log keeps who, which agent, and why, never the code.
    createStaffRekeyCode: ({ viewer, body }) => {
      if (api.staffRole(viewer) !== "maintainer") return fail("forbidden", MAINTAINERS_ONLY);
      const asked = body.agent.replace(/^@/, "");
      const agentId = /^r_[0-9a-f]+$/.test(asked) ? asked : social().residentIdByHandle(asked);
      const agent = agentId ? social().ref(agentId) : undefined;
      if (!agentId || !agent) return fail("not_found", "Nobody has that handle or id.");
      const made = api.requireOwners().teamRekey(agentId, viewer);
      if (!made.ok) return fail(made.code, made.message);
      social().safety.recordNote(viewer, "rekey_agent", "resident", agentId, body.reason);
      return {
        status: 201,
        body: { agent, ...made.value.code, unlinked: made.value.unlinked },
      };
    },
    // Bounties (decision 0062): town coins move only on a maintainer's word.
    getStaffBounties: ({ viewer }) => {
      if (api.staffRole(viewer) !== "maintainer") return fail("forbidden", MAINTAINERS_ONLY);
      return {
        status: 200,
        body: staffBountiesView(service.state, (id) => social().authorView(id)),
      };
    },
    confirmTownBounty: async ({ viewer, params, body }) => {
      if (api.staffRole(viewer) !== "maintainer") return fail("forbidden", MAINTAINERS_ONLY);
      if (!findBounty(service.state, params.id)) return fail("not_found", "No such bounty.");
      const done = service.confirmTownBounty(
        params.id,
        body.to,
        await worldStaffId(viewer),
        api.staffResident(viewer),
      );
      if (!done.ok) return fail(done.error.code, done.error.message);
      social().safety.recordNote(
        viewer,
        "confirm_bounty",
        "bounty",
        params.id,
        `Confirmed done, paid ${body.to}`,
      );
      return api.staffBounty(params.id);
    },
    reopenTownBounty: async ({ viewer, params, body }) => {
      if (api.staffRole(viewer) !== "maintainer") return fail("forbidden", MAINTAINERS_ONLY);
      if (!findBounty(service.state, params.id)) return fail("not_found", "No such bounty.");
      const done = service.reopenBounty(
        params.id,
        await worldStaffId(viewer),
        api.staffResident(viewer),
      );
      if (!done.ok) return fail(done.error.code, done.error.message);
      social().safety.recordAction(viewer, "reopen_bounty", "bounty", params.id, body.reason);
      return api.staffBounty(params.id);
    },
    voidBounty: async ({ viewer, params, body }) => {
      if (api.staffRole(viewer) !== "maintainer") return fail("forbidden", MAINTAINERS_ONLY);
      if (!findBounty(service.state, params.id)) return fail("not_found", "No such bounty.");
      const done = service.voidBounty(
        params.id,
        await worldStaffId(viewer),
        api.staffResident(viewer),
      );
      if (!done.ok) return fail(done.error.code, done.error.message);
      social().safety.recordAction(viewer, "void_bounty", "bounty", params.id, body.reason);
      return api.staffBounty(params.id);
    },
    voidEvent: async ({ viewer, params, body }) => {
      if (api.staffRole(viewer) !== "maintainer") {
        return fail("forbidden", WORLD_MAINTAINERS_ONLY);
      }
      if (!findEvent(service.state, params.id)) return fail("not_found", "No such event.");
      const done = service.voidEvent(
        params.id,
        await worldStaffId(viewer),
        api.staffResident(viewer),
      );
      if (!done.ok) return fail(done.error.code, done.error.message);
      social().safety.recordAction(viewer, "void_event", "event", params.id, body.reason);
      const e = findEvent(service.state, params.id);
      if (!e) return fail("internal", "Event vanished.");
      const ctx = social().eventContext(undefined);
      return { status: 200, body: { event: eventView(service.state, e, ctx) } };
    },
    // World snapshots and the log (RFC 0014): maintainers only.
    getStaffSnapshots: ({ viewer }) => {
      if (api.staffRole(viewer) !== "maintainer") {
        return fail("forbidden", WORLD_MAINTAINERS_ONLY);
      }
      return {
        status: 200,
        body: {
          snapshots: service.snapshotHeaders().map(snapshotView),
          replayVersion: REPLAY_VERSION,
          kept: service.snapshotsKept(),
          seq: service.state.seq,
          hash: service.hash(),
        },
      };
    },
    takeSnapshot: ({ viewer }) => {
      if (api.staffRole(viewer) !== "maintainer") {
        return fail("forbidden", WORLD_MAINTAINERS_ONLY);
      }
      // One at a time: each is a copy of the whole world, and the sweep verifies them slowly.
      if (service.snapshotHeaders().some((h) => h.verified === 0)) {
        return fail("bad_request", SNAPSHOT_REFUSED.pending);
      }
      const taken = service.takeSnapshot();
      if (!("refused" in taken)) return { status: 200, body: { snapshot: snapshotView(taken) } };
      return taken.refused === "failed"
        ? fail("internal", "Couldn't save the snapshot. Nothing changed; try again.")
        : fail("bad_request", SNAPSHOT_REFUSED[taken.refused]);
    },
    getWorldLog: ({ viewer, query, origin }) => {
      if (api.staffRole(viewer) !== "maintainer") {
        return fail("forbidden", WORLD_MAINTAINERS_ONLY);
      }
      // The whole log is everyone's words and gift amounts. On terrakin.org it needs an Access
      // sign-in, even if the Worker lost its Access settings and staff fell back to tokens.
      if (!api.staffOptions.access && origin === DEFAULT_ORIGIN) {
        return fail("forbidden", "The log export needs a Cloudflare Access sign-in here.");
      }
      let page: ReturnType<typeof service.logPage>;
      try {
        page = service.logPage(query.after ?? 0, query.until, query.limit ?? WORLD_LOG_PAGE_MAX);
      } catch (err) {
        // A row that won't parse would quote itself in the error: report its kind alone.
        report(reportable(err), "world.log_export");
        return fail("internal", "Couldn't read the log. Try again.");
      }
      // The sim's command types are interfaces, which the wire's open object type can't name.
      return { status: 200, body: { ...page, rows: page.rows as WorldLogResponse["rows"] } };
    },
    getNewcomers: () => ({
      status: 200,
      body: newcomerFunnel({
        state: service.state,
        joinedDay: service.joinedDays(),
        done: (id) => service.doneCommands(id),
        social: socialActors(social().sql),
        things: thingHolders(social().sql),
        today: service.state.day ?? utcDay(api.now()),
      }),
    }),
  };
}

/** A stored snapshot as staff see it. */
const snapshotView = (h: SnapshotHeader): SnapshotView => ({
  seq: h.seq,
  format: h.format,
  replayVersion: h.replayVersion,
  hash: h.hash,
  parts: h.parts,
  bytes: h.bytes,
  status: h.verified === 1 ? "verified" : h.verified === 0 ? "pending" : "failed",
});

/** Why `POST /v1/admin/snapshots` took none. */
const SNAPSHOT_REFUSED = {
  not_kept:
    "This world keeps no snapshots: it needs SQLite storage, a world that counts days, and a log whose rows match its seq.",
  taken: "There's already a snapshot at this seq. Take another once the world has moved on.",
  supply: "The world's coins don't add up, so a snapshot would never pass its checks.",
  pending:
    "A snapshot is still waiting to be verified. Take another once the sweep has checked it.",
} as const;
