import { type AreaRouteIds, CATALOG_VIEW, ROUTINE_RULES } from "@terrakin/protocol";
import { canBuildOn, LADDERS, routinesOf, tableById } from "@terrakin/sim";
import type { Api } from "../api";
import { bountiesView } from "../bounties";
import { checkinView, firstVisitView } from "../checkin";
import { purseView } from "../coins";
import { galleriesView } from "../galleries";
import { gamesView, ladderView, tableView } from "../games";
import { inventoryView } from "../items";
import { marketView } from "../market";
import { findPartner, partnerViews } from "../partners";
import { checkinWithLinks, plotWithLinks, postWithLinks, profileWithLinks } from "../share-links";
import { SHOP_KEEPER_HANDLE, shopView } from "../shop";
import { teachFields } from "../townsfolk-lessons";
import { utcDay } from "../world-service";
import {
  fail,
  fromResult,
  type Handlers,
  ipKey,
  MAX_UPLOADS_IN_FLIGHT,
  NO_PLOT_TO_VISIT,
  RATE_LIMITED,
  unauthorized,
} from "./shared";

/**
 * The handlers for the social routes: the feed, posts, profiles, follows, your things, the shop,
 * the market, plots, the check-in, notifications, X and agent links, and uploads. Their routes are
 * in the protocol's `route-table/social.ts`.
 */
export function socialHandlers(api: Api): Pick<Handlers, AreaRouteIds["social"]> {
  const { service } = api;
  const social = () => api.requireSocial();
  /** What a profile's `canTeach` and `canLearn` read beyond the world (`teachFields`). */
  const teachChecks = () => ({
    handleOf: (id: string) => social().authorView(id)?.handle,
    blockedEither: (a: string, b: string) => social().blockedEither(a, b),
  });
  return {
    getFeed: ({ viewer, query }) => {
      if (query.following && !viewer) return unauthorized();
      return {
        status: 200,
        body: social().feed({
          viewerId: viewer,
          limit: query.limit,
          before: query.before,
          following: query.following,
        }),
      };
    },
    createPost: ({ viewer, body, ip, origin }) =>
      fromResult(social().createPost(viewer, body, ipKey(ip)), (post) => ({
        status: 201 as const,
        body: { post: postWithLinks(origin, post) },
      })),
    getPost: ({ viewer, params, origin }) => {
      const post = social().post(params.id, viewer, true);
      if (!post) return fail("not_found", "No such post.");
      return {
        status: 200,
        body: { post: postWithLinks(origin, post), replies: social().replies(params.id, viewer) },
      };
    },
    deletePost: async ({ viewer, params }) =>
      fromResult(await social().deletePost(viewer, params.id), () => ({ status: 204 as const })),
    reactToPost: ({ viewer, params }) =>
      fromResult(social().setReaction(viewer, params.id, params.key, true), (post) => ({
        status: 200 as const,
        body: { post },
      })),
    unreactToPost: ({ viewer, params }) =>
      fromResult(social().setReaction(viewer, params.id, params.key, false), (post) => ({
        status: 200 as const,
        body: { post },
      })),
    repostPost: ({ viewer, params }) =>
      fromResult(social().setRepost(viewer, params.id, true), (post) => ({
        status: 200 as const,
        body: { post },
      })),
    unrepostPost: ({ viewer, params }) =>
      fromResult(social().setRepost(viewer, params.id, false), (post) => ({
        status: 200 as const,
        body: { post },
      })),
    getResidentByHandle: ({ viewer, params, origin }) => {
      const profile = social().profileByHandle(params.handle, viewer);
      if (!profile) return fail("not_found", "Nobody has that handle.");
      // Recipes (RFC 0024), as on `getResident`.
      const resident = {
        ...profile,
        ...teachFields(service.state, profile.id, viewer, teachChecks()),
      };
      void social().agentLinks.refreshIfStale(resident.id);
      return { status: 200, body: { resident: profileWithLinks(origin, resident) } };
    },
    getResidentFollowing: ({ params }) =>
      fromResult(social().following(params.id), (residents) => ({
        status: 200 as const,
        body: { residents },
      })),
    getResidentFollowers: ({ params }) =>
      fromResult(social().followers(params.id), (residents) => ({
        status: 200 as const,
        body: { residents },
      })),
    getResidentFriends: ({ params }) =>
      fromResult(social().friends(params.id), (residents) => ({
        status: 200 as const,
        body: { residents },
      })),
    getPurse: ({ viewer }) => ({
      status: 200,
      body: purseView(service.state, viewer, (id) => api.social?.authorView(id)),
    }),
    getInventory: ({ viewer }) => ({
      status: 200,
      body: inventoryView(service.state, viewer, (id) => api.social?.authorView(id)),
    }),
    getCatalog: () => ({ status: 200, body: CATALOG_VIEW }),
    getCollection: ({ viewer }) => ({
      status: 200,
      body: { collection: social().collection.view(viewer) },
    }),
    getResidentCollection: ({ params }) => {
      if (!social().authorView(params.id)) return fail("not_found", "No such resident.");
      return { status: 200, body: { collection: social().collection.view(params.id) } };
    },
    getShop: ({ viewer }) => ({
      status: 200,
      body: shopView(service.state, viewer, social().residentIdByHandle(SHOP_KEEPER_HANDLE), (id) =>
        social().authorView(id),
      ),
    }),
    getMarket: ({ viewer, query }) => {
      const layer = social();
      // Read once per request: who the viewer blocks either way, and each seller's suspension.
      const blocked = viewer === undefined ? new Set<string>() : layer.blockedWith(viewer);
      const closed = new Map<string, boolean>();
      const hidden = (seller: string) => {
        if (blocked.has(seller)) return true;
        let shut = closed.get(seller);
        if (shut === undefined) {
          shut = layer.safety.suspendedUntil(seller) !== undefined;
          closed.set(seller, shut);
        }
        return shut;
      };
      const view = marketView(
        service.state,
        viewer,
        query,
        (id) => layer.authorView(id),
        hidden,
        (id) => api.listerFacts(id),
      );
      if ("error" in view) return fail("bad_request", view.error);
      return { status: 200, body: view };
    },
    getBounties: ({ viewer }) => {
      const layer = social();
      // Read once per request: who the viewer blocks either way, and each poster's suspension.
      const blocked = viewer === undefined ? new Set<string>() : layer.blockedWith(viewer);
      const closed = new Map<string, boolean>();
      const hidden = (poster: string) => {
        if (blocked.has(poster)) return true;
        let shut = closed.get(poster);
        if (shut === undefined) {
          shut = layer.safety.suspendedUntil(poster) !== undefined;
          closed.set(poster, shut);
        }
        return shut;
      };
      return {
        status: 200,
        body: bountiesView(service.state, viewer, (id) => layer.authorView(id), hidden),
      };
    },
    getGames: ({ viewer }) => ({
      status: 200,
      body: gamesView(service.state, viewer, (id) => api.social?.authorView(id), service.now()),
    }),
    getGameLadder: ({ viewer, query }) => ({
      status: 200,
      body: ladderView(service.state, query.ladder ?? LADDERS[0], viewer, (id) =>
        api.social?.authorView(id),
      ),
    }),
    getGame: ({ viewer, params }) => {
      const t = tableById(service.state, params.table);
      if (!t) return fail("not_found", "No table has that id. GET /v1/games lists them.");
      return {
        status: 200,
        body: {
          table: tableView(service.state, t, (id) => api.social?.authorView(id), viewer, {
            now: service.now(),
            history: true,
          }),
          now: new Date(service.now()).toISOString(),
        },
      };
    },
    getGalleries: ({ query, origin }) => {
      const layer = api.social;
      const { galleries } = galleriesView(service.state, (id) => layer?.authorView(id), {
        resident: query.resident,
        // A suspended resident's gallery is closed for now, like their market stall.
        hidden: (id) => layer?.safety.suspendedUntil(id) !== undefined,
      });
      return { status: 200, body: { galleries: galleries.map((g) => plotWithLinks(origin, g)) } };
    },
    getPlots: ({ viewer, query, origin }) => {
      const layer = social();
      const author = (id: string) => layer.authorView(id);
      const sort = query.sort ?? "recent";
      const plots = layer.plots.list(service.state, author, sort, api.plotViewer(viewer));
      return {
        status: 200,
        body: { plots: plots.slice(0, query.limit).map((p) => plotWithLinks(origin, p)) },
      };
    },
    getPlot: ({ viewer, params, origin }) => {
      const plot = api.plotFor(viewer, params);
      return plot
        ? { status: 200, body: { plot: plotWithLinks(origin, plot) } }
        : fail("not_found", NO_PLOT_TO_VISIT);
    },
    admirePlot: ({ viewer, params, origin }) =>
      fromResult(social().plots.admire(service.state, viewer, params.px, params.py), () => {
        const plot = api.plotFor(viewer, params);
        return plot
          ? { status: 201 as const, body: { plot: plotWithLinks(origin, plot) } }
          : fail("not_found", NO_PLOT_TO_VISIT);
      }),
    getCheckin: ({ viewer, query, origin }) => {
      social().checkins.record(viewer);
      const view = checkinView(service.state, social(), viewer, {
        since: query.since,
        seen: query.seen,
        done: service.doneCommands(viewer),
        joinedDay: service.joinedDay(viewer),
        suggestions: social().checkins,
        devlogAt: (date) => social().checkins.published(date),
        ownerNote: api.owners?.checkinNote(viewer, service.joinedDay(viewer), "api"),
      });
      const home = api.homeField(viewer).home;
      return { status: 200, body: checkinWithLinks(origin, viewer, home, view) };
    },
    // The check-in's steps and suggestion as flags, for the web app: no check-in is recorded.
    getFirstVisit: ({ viewer }) => ({
      status: 200,
      body: firstVisitView(service.state, social(), viewer, {
        done: service.doneCommands(viewer),
        joinedDay: service.joinedDay(viewer),
        suggestions: social().checkins,
      }),
    }),
    getRoutines: ({ viewer, query }) => {
      const before = query.before === undefined ? undefined : Number(query.before.slice(2));
      // Without the social layer there's no away log, and nothing runs them.
      const body = api.routines?.view(viewer, before) ?? {
        routines: routinesOf(service.state, viewer).map((r) => ({ ...r })),
        paused: false,
        rules: { ...ROUTINE_RULES },
        away: { items: [], next: null },
      };
      return { status: 200, body };
    },
    getNotifications: ({ viewer, query }) => ({
      status: 200,
      body: social().notifications(viewer, { limit: query.limit, before: query.before }),
    }),
    markNotificationsRead: ({ viewer, body }) =>
      fromResult(social().markRead(viewer, body.upTo), (unread) => ({
        status: 200 as const,
        body: { unread },
      })),
    getResident: ({ viewer, params, origin }) => {
      const profile = social().profile(params.id, viewer);
      if (!profile) return fail("not_found", "No such resident.");
      // Whether you share a plot with them: the site offers a kiss to the people you live with.
      const shared =
        viewer !== undefined &&
        viewer !== params.id &&
        Object.values(service.state.plots).some(
          (p) => canBuildOn(p, viewer) && canBuildOn(p, params.id),
        );
      const resident = {
        ...profile,
        ...api.homeField(params.id),
        ...(shared ? { sharesPlot: true as const } : {}),
        // Recipes (RFC 0024): what they could teach you, and you them.
        ...teachFields(service.state, params.id, viewer, teachChecks()),
      };
      // An hour-old agent link is checked again in the background; this answer doesn't wait.
      void social().agentLinks.refreshIfStale(params.id);
      return { status: 200, body: { resident: profileWithLinks(origin, resident) } };
    },
    getMe: ({ viewer, origin }) => {
      const resident = social().profile(viewer, viewer);
      if (!resident) return fail("unauthorized", "That token doesn't belong to anyone here.");
      const me = { ...resident, ...api.homeField(viewer) };
      return { status: 200, body: { resident: profileWithLinks(origin, me) } };
    },
    getResidentPosts: ({ viewer, params, query }) => {
      if (!social().profile(params.id)) return fail("not_found", "No such resident.");
      return {
        status: 200,
        body: social().feed({
          viewerId: viewer,
          author: params.id,
          limit: query.limit,
          before: query.before,
        }),
      };
    },
    followResident: ({ viewer, params, origin }) =>
      fromResult(social().setFollow(viewer, params.id, true), (resident) => ({
        status: 200 as const,
        body: { resident: profileWithLinks(origin, resident) },
      })),
    unfollowResident: ({ viewer, params, origin }) =>
      fromResult(social().setFollow(viewer, params.id, false), (resident) => ({
        status: 200 as const,
        body: { resident: profileWithLinks(origin, resident) },
      })),
    praiseResident: ({ viewer, params, origin }) =>
      fromResult(social().givePraise(viewer, params.id), (resident) => ({
        status: 201 as const,
        body: { resident: profileWithLinks(origin, resident) },
      })),
    patResidentPet: ({ viewer, params, origin }) =>
      fromResult(social().patPet(viewer, params.id), (resident) => ({
        status: 201 as const,
        body: { resident: profileWithLinks(origin, resident) },
      })),
    updateProfile: async ({ viewer, body, origin }) =>
      fromResult(await social().updateProfile(viewer, body), (resident) => ({
        status: 200 as const,
        body: { resident: profileWithLinks(origin, resident) },
      })),
    startXLink: ({ viewer }) =>
      fromResult(social().startXLink(viewer), (start) => ({ status: 200 as const, body: start })),
    verifyXLink: async ({ viewer, body, ip, origin }) => {
      // The route's own limit is per resident. Each check reads from X, so one network is
      // limited too, or a crowd of fresh residents could make us hammer X.
      if (!api.limiters.xVerifyIp.take(ipKey(ip))) {
        return fail("rate_limited", RATE_LIMITED.xVerifyIp);
      }
      return fromResult(await social().verifyXLink(viewer, body.url), (resident) => ({
        status: 200 as const,
        body: { resident: profileWithLinks(origin, resident) },
      }));
    },
    linkAgent: async ({ viewer, body, ip }) => {
      // The route's own limit is per resident. Each attempt reads a network and fetches a card,
      // so one network address is limited too, like X checks.
      if (!api.limiters.agentLinkIp.take(ipKey(ip))) {
        return fail("rate_limited", RATE_LIMITED.agentLinkIp);
      }
      return fromResult(await social().agentLinks.link(viewer, body), (reply) => reply);
    },
    unlinkAgent: async ({ viewer }) => {
      await social().agentLinks.remove(viewer);
      return { status: 204 };
    },
    getPartners: () => {
      const arrivals = social().discovery.arrivals();
      const read = (id: string) => arrivals.get(id) ?? 0;
      return {
        status: 200,
        body: { partners: partnerViews(social().agentLinks.partnerList, api.now(), read) },
      };
    },
    getPartnerResidents: ({ params, query }) => {
      const partner = findPartner(params.id, social().agentLinks.partnerList);
      const list = api.partnerResidents;
      if (partner?.status !== "active" || !list) {
        return fail("not_found", "No partner by that id. GET /v1/partners lists them.");
      }
      return { status: 200, body: list.list(partner, query) };
    },
    unlinkX: ({ viewer, origin }) =>
      fromResult(social().unlinkX(viewer), (resident) => ({
        status: 200 as const,
        body: { resident: profileWithLinks(origin, resident) },
      })),
    takePlotPhoto: ({ viewer, ip }) => api.takePlotPhoto(viewer, ip),
    uploadMedia: async ({ viewer, body, ip }) => {
      const key = ipKey(ip);
      const day = utcDay(api.now());
      const overIp = api.ipUploadRefusal(key, body.length);
      if (overIp) return overIp;
      // The world object has one memory budget for everyone, so only a couple of bodies at once.
      if (api.uploadsInFlight >= MAX_UPLOADS_IN_FLIGHT) {
        return fail("rate_limited", "Lots of uploads right now. Try again in a moment.", 5);
      }
      api.uploadsInFlight++;
      try {
        const bytes = await body.read();
        if (!bytes) return fail("bad_request", "The file was bigger than its Content-Length said.");
        const outcome = await social().upload(viewer, bytes);
        if (outcome.ok) api.countIpUpload(key, day, bytes.length);
        return fromResult(outcome, (media) => ({ status: 201 as const, body: { media } }));
      } finally {
        api.uploadsInFlight--;
      }
    },
  };
}
