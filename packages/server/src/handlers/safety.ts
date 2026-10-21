import {
  type AreaRouteIds,
  MODERATOR_SUSPEND_MAX_DAYS,
  type SnapshotView,
  WORLD_LOG_PAGE_MAX,
  type WorldLogResponse,
} from "@terrakin/protocol";
import {
  AWARDS,
  awardedInWindow,
  circleById,
  findBounty,
  findEvent,
  goodById,
  heldAsideOf,
  inventorySize,
  listingById,
  own,
  plotAtTile,
  plotNamesOf,
  plotsOwnedBy,
  REPLAY_VERSION,
  residentById,
  tileKey,
  utcDay,
} from "@terrakin/sim";
import { DEPLOY_ACTOR } from "../access";
import { SUMMARY_DAYS } from "../ai-spend";
import type { Api } from "../api";
import { staffBountiesView } from "../bounties";
import { eventView } from "../events";
import { madeThingForReport } from "../galleries";
import { DEFAULT_ORIGIN } from "../links";
import { handleHolders, newcomerFunnel, socialActors, thingHolders } from "../newcomers";
import { shutHomes, walksOutWithout } from "../shut-homes";
import { reportable, type SnapshotHeader } from "../snapshots";
import { staffKeyId, staffKeyView, staffOwner } from "../staff-keys";
import { report } from "../telemetry";
import { cleanText } from "../text";
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
    // RFC 0033: a circle's name comes down in the world, and its stewards hear why.
    clearCircleName: ({ viewer, params, body }) => {
      const k = circleById(service.state, params.id);
      if (!k || k.name === undefined) return fail("not_found", "That circle has no name up.");
      const safety = social().safety;
      const rule = safety.ruleFor(["circle"], params.id, body.rule);
      const done = service.clearCircleName(params.id);
      if (!done.ok) return fail(done.error.code, done.error.message);
      const entry = safety.recordAction(
        viewer,
        "clear_circle_name",
        "circle",
        params.id,
        body.reason,
        rule,
      );
      for (const steward of k.stewards) {
        safety.tellOwner(steward, {
          what: "circle_name",
          rule,
          outcome: "removed",
          circle: params.id,
        });
      }
      return { status: 200, body: { logged: entry } };
    },
    // RFC 0033: a circle's notice is a social row, so it comes down there.
    clearCircleNotice: ({ viewer, params, body }) => {
      const notices = social().circleNotices;
      if (!circleById(service.state, params.id) || !notices.get(params.id)) {
        return fail("not_found", "That circle has no notice up.");
      }
      const safety = social().safety;
      const rule = safety.ruleFor(["circle"], params.id, body.rule);
      const author = notices.clear(params.id);
      const entry = safety.recordAction(
        viewer,
        "clear_circle_notice",
        "circle",
        params.id,
        body.reason,
        rule,
      );
      if (author) {
        safety.tellOwner(author, {
          what: "circle_notice",
          rule,
          outcome: "removed",
          circle: params.id,
        });
      }
      return { status: 200, body: { logged: entry } };
    },
    // RFC 0033: maintainers only, in the moderation log and in the world with an opaque staff id.
    disbandCircle: async ({ viewer, params, body }) => {
      if (api.staffRole(viewer) !== "maintainer") {
        return fail("forbidden", WORLD_MAINTAINERS_ONLY);
      }
      if (!circleById(service.state, params.id)) return fail("not_found", "No such circle.");
      const done = service.disbandCircle(params.id, await worldStaffId(viewer));
      if (!done.ok) return fail(done.error.code, done.error.message);
      const rule = social().safety.ruleFor(["circle"], params.id, body.rule);
      const entry = social().safety.recordAction(
        viewer,
        "disband_circle",
        "circle",
        params.id,
        body.reason,
        rule,
      );
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
    // Homes nobody can walk out of (decision 0343), read with the sim's own walk.
    getShutHomes: () => {
      const ref = (id: string) => social().ref(id);
      const homes = shutHomes(service.state).flatMap((home) => {
        const resident = ref(home.residentId);
        if (!resident) return [];
        const frees = home.frees.flatMap(({ ownerId, ...tile }) => {
          const owner = ref(ownerId);
          return owner ? [{ ...tile, owner }] : [];
        });
        return [{ resident, hearth: home.hearth, reached: home.reached, frees }];
      });
      return { status: 200, body: { homes } };
    },
    // A maintainer opens a way out of a home by taking one block off a plot (decision 0343). What
    // it cost goes back to the plot's owner, who hears it from Terrakin.
    clearBlock: ({ viewer, body }) => {
      if (api.staffRole(viewer) !== "maintainer") return fail("forbidden", MAINTAINERS_ONLY);
      const { state } = service;
      const { x, y } = body;
      const plot = plotAtTile(state, x, y);
      const block = state.blocks[tileKey(x, y)];
      const owner = plot ? social().ref(plot.ownerId) : undefined;
      const dry = body.dry === true;
      const done = service.clearBlock(x, y, dry);
      if (!done.ok) return fail(done.error.code, done.error.message);
      if (!plot || !owner || block === undefined)
        return fail("no_plot", "That tile isn't on a claimed plot.");
      const hearth = residentById(state, plot.ownerId)?.hearth;
      // On a dry run the block is still there, so ask the walk as if it weren't.
      const walksOut = hearth ? walksOutWithout(state, hearth, dry ? { x, y } : undefined) : null;
      if (!dry) {
        social().safety.recordNote(
          viewer,
          "clear_block",
          "resident",
          plot.ownerId,
          `At ${x},${y}: ${body.reason}`,
        );
        social().blockCleared(plot.ownerId, { x, y, block });
      }
      return { status: 200, body: { owner, x, y, block, walksOut, cleared: !dry } };
    },
    // A duplicate record merged into the one that stays (issue #46, decision 0239). What moves is
    // read before the merge, which takes the duplicate out of the world.
    mergeResident: ({ viewer, params, body }) => {
      if (api.staffRole(viewer) !== "maintainer") return fail("forbidden", MAINTAINERS_ONLY);
      const asked = body.into.replace(/^@/, "");
      const intoId = /^r_[0-9a-f]+$/.test(asked) ? asked : social().residentIdByHandle(asked);
      const from = social().ref(params.id);
      const into = intoId ? social().ref(intoId) : undefined;
      if (!from || !into) return fail("not_found", "Nobody has that handle or id.");
      const { state } = service;
      const moves = {
        coins: own(state.economy?.coins, from.id) ?? 0,
        things: inventorySize(own(state.items?.inventories, from.id)),
        plots: plotsOwnedBy(state, from.id).map(({ px, py }) => ({ px, py })),
      };
      const dry = body.dry === true;
      const done = service.mergeResident(from.id, into.id, dry);
      if (!done.ok) return fail(done.error.code, done.error.message);
      if (!dry) {
        social().safety.recordNote(
          viewer,
          "merge_resident",
          "resident",
          from.id,
          `Into ${into.id}: ${body.reason}`,
        );
      }
      return { status: 200, body: { from, into, ...moves, merged: !dry } };
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
      if (viewer !== DEPLOY_ACTOR && api.staffRole(viewer) !== "maintainer") {
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
        handles: handleHolders(social().sql),
        today: service.state.day ?? utcDay(api.now()),
      }),
    }),
    // Recognition awards (RFC 0036). This is the one staff route that moves treasury coins on one
    // person's word, so it takes three gates the other money routes don't: a maintainer, a staff
    // sign-in of their own rather than a key, and a sign-in the staff mapping names.
    awardGrant: async ({ viewer, body }) => {
      if (api.staffRole(viewer) !== "maintainer") return fail("forbidden", MAINTAINERS_ONLY);
      // `KEY_NEVER` in `staff-keys.ts` already turns a key away before this, so this is the second
      // belt: money should not come open again because someone widened a scope.
      if (staffKeyId(viewer) !== undefined) {
        return fail("forbidden", "An award needs your own staff sign-in, not a staff key.");
      }
      // Without the mapping the sim can't see the household, and the household mark is the only
      // disclosure standing in for a second maintainer, so an unmapped sign-in can't award.
      const resident = api.staffResident(viewer);
      if (!resident) {
        return fail(
          "forbidden",
          "Your sign-in isn't mapped to a resident, so an award's household can't be shown. Add it to TERRAKIN_STAFF_RESIDENTS first.",
        );
      }
      // Read the recipient before paying, so a resident the social layer doesn't know is turned
      // down instead of awarded and then failed on the way out.
      const to = social().authorView(body.to);
      if (!to) return fail("not_found", "No such resident.");
      // Rewarding someone who is currently suspended is incoherent, so the one check the sim can't
      // make (it never sees suspensions) is made here. Blocks are deliberately not checked: an
      // award is a payment rather than contact (decision 0295).
      if (social().safety.suspendedUntil(body.to) !== undefined) {
        return fail("not_eligible", "That resident is suspended. End the suspension first.");
      }
      const done = service.awardGrant(body.to, body.coins, await worldStaffId(viewer), resident);
      if (!done.ok) return fail(done.error.code, done.error.message);
      const paid = done.events.find((e) => e.type === "award_paid");
      const household = paid?.type === "award_paid" && paid.household === true;
      social().safety.recordNote(
        viewer,
        "award_grant",
        "resident",
        body.to,
        `Awarded ${body.coins}${household ? " (own household)" : ""}: ${body.reason}`,
      );
      const day = service.state.day ?? utcDay(api.now());
      return {
        status: 200,
        body: {
          to,
          coins: body.coins,
          ...(household ? { household: true as const } : {}),
          left: Math.max(0, AWARDS.perMonth - awardedInWindow(service.state, day)),
        },
      };
    },
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
