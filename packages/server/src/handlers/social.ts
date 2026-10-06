import { type AreaRouteIds, CATALOG_VIEW, ROUTINE_RULES } from "@terrakin/protocol";
import { canBuildOn, LADDERS, routinesOf, tableById } from "@terrakin/sim";
import type { Api } from "../api";
import { bountiesView } from "../bounties";
import { checkinView } from "../checkin";
import { purseView } from "../coins";
import { galleriesView } from "../galleries";
import { gamesView, ladderView, tableView } from "../games";
import { inventoryView } from "../items";
import { marketView } from "../market";
import { findPartner, partnerViews } from "../partners";
import { SHOP_KEEPER_HANDLE, shopView } from "../shop";
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
    createPost: ({ viewer, body, ip }) =>
      fromResult(social().createPost(viewer, body, ipKey(ip)), (post) => ({
        status: 201 as const,
        body: { post },
      })),
    getPost: ({ viewer, params }) => {
      const post = social().post(params.id, viewer, true);
      if (!post) return fail("not_found", "No such post.");
      return { status: 200, body: { post, replies: social().replies(params.id, viewer) } };
    },
    deletePost: async ({ viewer, params }) =>
      fromResult(await social().deletePost(viewer, params.id), () => ({ status: 204 as const })),
    likePost: ({ viewer, params }) =>
      fromResult(social().setLike(viewer, params.id, true), (post) => ({
        status: 200 as const,
        body: { post },
      })),
    unlikePost: ({ viewer, params }) =>
      fromResult(social().setLike(viewer, params.id, false), (post) => ({
        status: 200 as const,
        body: { post },
      })),
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
    getResidentByHandle: ({ viewer, params }) => {
      const resident = social().profileByHandle(params.handle, viewer);
      if (!resident) return fail("not_found", "Nobody has that handle.");
      void social().agentLinks.refreshIfStale(resident.id);
      return { status: 200, body: { resident } };
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
    getGalleries: ({ query }) => {
      const layer = api.social;
      return {
        status: 200,
        body: galleriesView(service.state, (id) => layer?.authorView(id), {
          resident: query.resident,
          // A suspended resident's gallery is closed for now, like their market stall.
          hidden: (id) => layer?.safety.suspendedUntil(id) !== undefined,
        }),
      };
    },
    getPlots: ({ viewer, query }) => {
      const layer = social();
      const author = (id: string) => layer.authorView(id);
      const sort = query.sort ?? "recent";
      const plots = layer.plots.list(service.state, author, sort, api.plotViewer(viewer));
      return { status: 200, body: { plots: plots.slice(0, query.limit) } };
    },
    getPlot: ({ viewer, params }) => {
      const plot = api.plotFor(viewer, params);
      return plot ? { status: 200, body: { plot } } : fail("not_found", NO_PLOT_TO_VISIT);
    },
    admirePlot: ({ viewer, params }) =>
      fromResult(social().plots.admire(service.state, viewer, params.px, params.py), () => {
        const plot = api.plotFor(viewer, params);
        return plot
          ? { status: 201 as const, body: { plot } }
          : fail("not_found", NO_PLOT_TO_VISIT);
      }),
    getCheckin: ({ viewer, query }) => {
      social().checkins.record(viewer);
      return {
        status: 200,
        body: checkinView(service.state, social(), viewer, {
          since: query.since,
          seen: query.seen,
          done: service.doneCommands(viewer),
          suggestions: social().checkins,
          devlogAt: (date) => social().checkins.published(date),
        }),
      };
    },
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
    getResident: ({ viewer, params }) => {
      const profile = social().profile(params.id, viewer);
      if (!profile) return fail("not_found", "No such resident.");
      // Whether you share a plot with them: the site offers a kiss to the people you live with.
      const shared =
        viewer !== undefined &&
        viewer !== params.id &&
        Object.values(service.state.plots).some(
          (p) => canBuildOn(p, viewer) && canBuildOn(p, params.id),
        );
      const resident = shared ? { ...profile, sharesPlot: true as const } : profile;
      // An hour-old agent link is checked again in the background; this answer doesn't wait.
      void social().agentLinks.refreshIfStale(params.id);
      return { status: 200, body: { resident } };
    },
    getMe: ({ viewer }) => {
      const resident = social().profile(viewer, viewer);
      if (!resident) return fail("unauthorized", "That token doesn't belong to anyone here.");
      return { status: 200, body: { resident } };
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
    followResident: ({ viewer, params }) =>
      fromResult(social().setFollow(viewer, params.id, true), (resident) => ({
        status: 200 as const,
        body: { resident },
      })),
    unfollowResident: ({ viewer, params }) =>
      fromResult(social().setFollow(viewer, params.id, false), (resident) => ({
        status: 200 as const,
        body: { resident },
      })),
    praiseResident: ({ viewer, params }) =>
      fromResult(social().givePraise(viewer, params.id), (resident) => ({
        status: 201 as const,
        body: { resident },
      })),
    patResidentPet: ({ viewer, params }) =>
      fromResult(social().patPet(viewer, params.id), (resident) => ({
        status: 201 as const,
        body: { resident },
      })),
    updateProfile: async ({ viewer, body }) =>
      fromResult(await social().updateProfile(viewer, body), (resident) => ({
        status: 200 as const,
        body: { resident },
      })),
    startXLink: ({ viewer }) =>
      fromResult(social().startXLink(viewer), (start) => ({ status: 200 as const, body: start })),
    verifyXLink: async ({ viewer, body, ip }) => {
      // The route's own limit is per resident. Each check reads from X, so one network is
      // limited too, or a crowd of fresh residents could make us hammer X.
      if (!api.limiters.xVerifyIp.take(ipKey(ip))) {
        return fail("rate_limited", RATE_LIMITED.xVerifyIp);
      }
      return fromResult(await social().verifyXLink(viewer, body.url), (resident) => ({
        status: 200 as const,
        body: { resident },
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
      await social().agentLinks.unlink(viewer);
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
    unlinkX: ({ viewer }) =>
      fromResult(social().unlinkX(viewer), (resident) => ({
        status: 200 as const,
        body: { resident },
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
