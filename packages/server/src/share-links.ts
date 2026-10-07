import {
  type AuthorView,
  type CheckinResponse,
  gameLinks,
  type PlotView,
  type PostView,
  type ProfileView,
  plotLinks,
  postLinks,
  residentLinks,
  TERRAKIN_ACTOR,
} from "@terrakin/protocol";

/**
 * Links to share (decision 0161): the `links` on profiles, plots, posts, and the check-in's items,
 * as absolute URLs on the origin the request came in on. The protocol's `share.ts` builds each
 * one from ids and plot coordinates; this file puts them on the views the handlers answer with.
 */

type At = { px: number; py: number };

/** An author with links to share about them. Terrakin's stand-in actor has no profile, so none. */
function authorWithLinks(origin: string, a: AuthorView): AuthorView {
  return a.id === TERRAKIN_ACTOR.id ? a : { ...a, links: residentLinks(origin, a.id) };
}

/** A profile with its links, and its home plot's when it has one. */
export function profileWithLinks(origin: string, p: ProfileView): ProfileView {
  return {
    ...p,
    ...(p.home ? { home: { ...p.home, links: plotLinks(origin, p.home.px, p.home.py) } } : {}),
    links: residentLinks(origin, p.id),
  };
}

/** A plot (or a gallery, or an event's place) with its links. */
export function plotWithLinks<T extends At>(origin: string, p: T): T & Pick<PlotView, "links"> {
  return { ...p, links: plotLinks(origin, p.px, p.py) };
}

/** A post with its links. */
export function postWithLinks(origin: string, p: PostView): PostView {
  return { ...p, links: postLinks(origin, p.id) };
}

/**
 * The check-in with links on what an owner would want to see: the caller and their home plot, and
 * each item that points at a resident, a plot, a post, an event's place, or a game table. Ids and
 * coordinates only, so nothing here changes what `digest` fingerprints.
 */
export function checkinWithLinks(
  origin: string,
  viewer: string,
  home: At | undefined,
  c: Omit<CheckinResponse, "links">,
): CheckinResponse {
  const event = <E extends { place: At }>(e: E): E => ({
    ...e,
    place: plotWithLinks(origin, e.place),
  });
  return {
    ...c,
    notifications: {
      ...c.notifications,
      items: c.notifications.items.map((n) => ({
        ...n,
        actor: authorWithLinks(origin, n.actor),
        ...(n.plot ? { plot: plotWithLinks(origin, n.plot) } : {}),
        ...(n.postId ? { links: postLinks(origin, n.postId) } : {}),
      })),
    },
    gestures: c.gestures.map((g) => ({ ...g, from: authorWithLinks(origin, g.from) })),
    following: c.following.map((p) => postWithLinks(origin, p)),
    coins: c.coins && {
      ...c.coins,
      today: c.coins.today.map((l) =>
        l.with ? { ...l, with: authorWithLinks(origin, l.with) } : l,
      ),
    },
    events: { soon: c.events.soon.map(event), live: c.events.live.map(event) },
    ...(c.games
      ? {
          games: {
            ...c.games,
            yourMove: c.games.yourMove.map((m) => ({ ...m, links: gameLinks(origin, m.table) })),
            ended: c.games.ended.map((g) => ({ ...g, links: gameLinks(origin, g.table) })),
          },
        }
      : {}),
    links: {
      you: residentLinks(origin, viewer),
      ...(home ? { home: plotLinks(origin, home.px, home.py) } : {}),
    },
  };
}
