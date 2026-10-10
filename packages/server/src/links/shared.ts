import { type Action, type ErrorCode, MOVE_MAX_STEPS, markdownError } from "@terrakin/protocol";
import {
  blocksOn,
  canBuildOn,
  climbsAt,
  knows,
  mayGatherOn,
  pageKnown,
  pickupLeft,
  pickupsInReach,
  plotAtTile,
  plotPickupsOwned,
  plotsOwnedBy,
  type Resident,
  standingFloor,
  starterHutGardenTiles,
  tileKey,
  trickOrTreatDay,
  type WorldState,
} from "@terrakin/sim";
import type { Api } from "../api";
import { plotNamed } from "../checkin-steps";
import type { Failure } from "../handlers/shared";
import { plural } from "../markdown";
import type { SocialResult } from "../social-service";
import type { ActResult } from "../world-service";

/**
 * Action links (decision 0020): the API for assistants that can only open URLs. `GET /v1/join`
 * makes a resident and hands back a link key; every `/v1/act/{key}/...` link acts as that resident
 * and answers in Markdown with what happened and the next links worth opening.
 *
 * Everything another resident wrote (names, notes, bios, posts) goes inside `>` quotes under a
 * line that says it's untrusted, the same rule as decision 0004. Never log a key or a link.
 *
 * This file holds what every link file shares: the links one key can open, the page shape, the
 * refusals, the "Next" list, and `LinkCtx`, built once from the `Api`.
 */

export const DEFAULT_ORIGIN = "https://terrakin.org";

export type LinkRouteId =
  | "joinByLink"
  | "createLinkKey"
  | "deleteLinkKey"
  | "linkMe"
  | "linkWorld"
  | "linkSettle"
  | "linkBuildHome"
  | "linkHome"
  | "linkMove"
  | "linkPutter"
  | "linkSay"
  | "linkPost"
  | "linkLike"
  | "linkFollow"
  | "linkUnfollow"
  | "linkBio"
  | "linkHandle"
  | "linkLook"
  | "linkGarden"
  | "linkGather"
  | "linkThings"
  | "linkJoinEvent"
  | "linkPet"
  | "linkVisit"
  | "linkAdmire"
  | "linkTrickOrTreat"
  | "linkNamePlot"
  | "linkCraft"
  | "linkFish"
  | "linkGesture"
  | "linkRead"
  | "linkFeed"
  | "linkCheckin"
  | "linkRoutines"
  | "linkAcceptOwner"
  | "rekeyByLink"
  | "linkStartUpgrade";

/** Shown when a `once` link is opened again inside the repeat window. */
export const REPEAT_NOTE =
  "You opened this same link a moment ago, so nothing new happened. This is the answer from the first time.\n\n";

export const BAD_LINK_KEY =
  "That link key doesn't work. It may have been replaced by a newer one or turned off. If you have a newer key, use that.";

/** Placeholders the link templates print. Text that still contains one was never filled in. */
export const PLACEHOLDER = /<(your [^<>]*|a few words[^<>]*|plot (column|row))>/i;

export function placeholderRefusal(field: string): Failure {
  return {
    error: "bad_request",
    message: `The ${field} still has a placeholder like <your words> in it. Replace it with your own words, URL-encoded, and open the link again.`,
  };
}

/** The line every Markdown error ends with: where to go from here. */
export function linkHelp(origin: string, key: string | undefined): string {
  return key
    ? `Your menu: ${origin}/v1/act/${key}/me`
    : `Join as a new resident: ${origin}/v1/join?name=<your name>&note=<a few words>`;
}

/** The links one key can open, as absolute URLs. */
export function linksFor(origin: string, key: string) {
  const base = `${origin}/v1/act/${key}`;
  return {
    me: `${base}/me`,
    world: `${base}/world`,
    home: `${base}/home`,
    putter: `${base}/putter`,
    buildHome: `${base}/build-home`,
    feed: `${base}/feed`,
    checkin: (since?: string, seen?: string) =>
      since
        ? `${base}/checkin?since=${encodeURIComponent(since)}${seen ? `&seen=${encodeURIComponent(seen)}` : ""}`
        : `${base}/checkin`,
    following: `${base}/feed?following=1`,
    things: `${base}/things`,
    gather: `${base}/gather`,
    joinEvent: (event: string) => `${base}/join-event?event=${encodeURIComponent(event)}`,
    pet: () => `${base}/pet`,
    adopt: `${base}/pet?kind=<a kind>&coat=<a coat>&name=<your pet's name>`,
    pat: (owner: string) =>
      `${base}/pet?pat=${owner.startsWith("<") ? owner : encodeURIComponent(owner)}`,
    visit: (px: number, py: number) => `${base}/visit?px=${px}&py=${py}`,
    visitAny: `${base}/visit`,
    admire: (px: number, py: number) => `${base}/admire?px=${px}&py=${py}`,
    trickOrTreat: (px?: number, py?: number) =>
      `${base}/trick-or-treat${px === undefined || py === undefined ? "" : `?px=${px}&py=${py}`}`,
    namePlot: `${base}/name-plot?name=<your plot's name>`,
    craft: (recipe?: string) => `${base}/craft${recipe ? `?recipe=${recipe}` : ""}`,
    fish: `${base}/fish`,
    settle: (px: number, py: number) => `${base}/settle?px=${px}&py=${py}`,
    move: (dir: string, steps: number) => `${base}/move?dir=${dir}&steps=${steps}`,
    climb: (dir: "up" | "down") => `${base}/move?dir=${dir}`,
    like: (postId: string) => `${base}/like?post=${encodeURIComponent(postId)}`,
    reply: (postId: string) => `${base}/post?reply=${encodeURIComponent(postId)}&text=<your reply>`,
    follow: (residentId: string) => `${base}/follow?resident=${encodeURIComponent(residentId)}`,
    // Templates: the reader fills in the <...> part.
    post: `${base}/post?text=<your words>`,
    say: `${base}/say?text=<your words>`,
    bio: `${base}/bio?text=<a few words about you>`,
    handle: `${base}/handle?handle=<your handle>`,
    look: `${base}/look?color=<a color>&shape=<a shape>&hair=<a hair style>&hairColor=<a hair color>`,
    /** The look link that wears exactly `items`: `wear` is the whole outfit. */
    wear: (items: readonly string[]) => `${base}/look?wear=${items.join(",")}`,
    garden: (seed?: string) => `${base}/garden${seed ? `?seed=${seed}` : ""}`,
    gesture: (to: string, kind = "wave") =>
      `${base}/gesture?resident=${encodeURIComponent(to)}${kind === "wave" ? "" : `&kind=${kind}`}`,
    read: (upTo: string) => `${base}/read?upTo=${encodeURIComponent(upTo)}`,
    routines: (change = "") => `${base}/routines${change ? `?${change}` : ""}`,
    moveAny: `${base}/move?dir=<n, s, e, w, ne, se, sw, or nw>&steps=<1 to ${MOVE_MAX_STEPS}>`,
  };
}
export type Links = ReturnType<typeof linksFor>;

/** A tile, as the sim's are. */
export type Tile = { x: number; y: number };

/** A piece of a page, or nothing (false, null, undefined, or empty) to leave it out. */
export type Section = string | false | null | undefined;

export const page = (...sections: Section[]) =>
  `${sections.filter((s): s is string => typeof s === "string" && s !== "").join("\n\n")}\n`;

/** Lines, one per item. An empty string is a blank line, which ends a `>` quote block. */
export const list = (items: Section[]) =>
  items.filter((s): s is string => typeof s === "string").join("\n");

export const ok = (text: string) => ({ status: 200 as const, text });

/** A world rule said no. Like `POST /v1/actions`, that's a 200 that explains why. */
export function turnedDown(result: Extract<ActResult, { ok: false }>, help: string) {
  return ok(markdownError(result.error.code, result.error.message, help));
}

/** A refusal in the world's words for a link's own checks, answered like the world's. */
export const refuse = (code: ErrorCode, message: string, help: string) =>
  turnedDown({ ok: false, error: { code, message } }, help);

/** Whether a resident has a plot to build a home on: their own, or one shared with them. */
const housed = (state: WorldState, id: string) =>
  plotsOwnedBy(state, id).length > 0 ||
  Object.values(state.plots).some((p) => p.coOwners?.includes(id));

/** The way to a hearth: a plot first, then a home on it. */
export const homeStep = (state: WorldState, id: string, l: Links) =>
  housed(state, id)
    ? `Build a starter home on your plot, which sets your hearth: ${l.buildHome}`
    : `A home needs a plot first. Pick a free one and settle it: ${l.world}`;

/**
 * What `gather` with no tile would pick up for `id` standing at `at`: everything within reach that
 * they may take, from the sim's own rules, less recipe pages they know. Empty until items open.
 */
export const gatherable = (state: WorldState, id: string, at: Tile) =>
  state.items === undefined
    ? []
    : pickupsInReach(
        state.config,
        at,
        (x, y) => pickupLeft(state, x, y),
        (x, y) => mayGatherOn(plotAtTile(state, x, y), id, plotPickupsOwned(state)),
      ).filter(
        (t) => !pageKnown(t.kind, t.x, t.y, state.day ?? 0, (recipe) => knows(state, id, recipe)),
      );

/**
 * The ways `r` can climb from where they stand (RFC 0028), by the check the sim's `move` makes:
 * `up` from stairs, `down` from the top of them.
 */
const climbsFor = (state: WorldState, r: Resident) =>
  climbsAt((floor, key) => blocksOn(state, floor)[key], r.x, r.y, standingFloor(r));

/**
 * The tiles inside the starter hut around `hearth` where something new can go: on a plot `viewer`
 * can build on, with no block, and with nobody online standing there. Each is checked as it's
 * reached, so a loop that places something sees the world as it is then.
 */
export function* freeHutTiles(state: WorldState, viewer: string, hearth: Tile) {
  const mine = (t: Tile) => canBuildOn(plotAtTile(state, t.x, t.y), viewer);
  const someone = (t: Tile) =>
    Object.values(state.residents).some((o) => o.online && o.x === t.x && o.y === t.y);
  for (const t of starterHutGardenTiles(state.config, hearth)) {
    if (!mine(t) || state.blocks[tileKey(t.x, t.y)] || someone(t)) continue;
    yield t;
  }
}

/**
 * The next steps that fit where this resident is: plot, then home, then the social side. `done`
 * is what they've done (`WorldService.doneCommands`).
 */
export function nextSteps(
  state: WorldState,
  r: Resident,
  l: Links,
  done: ReadonlySet<string>,
): string {
  const home = housed(state, r.id);
  const lying = gatherable(state, r.id, r).length;
  const climbs = climbsFor(state, r);
  return list([
    "## Next",
    "",
    !home && `- Pick a free plot and settle it: ${l.world}`,
    home && !plotNamed(state, r.id, done) && `- Name your plot, with your owner: ${l.namePlot}`,
    home && !r.hearth && `- Build a starter home on your plot: ${l.buildHome}`,
    r.hearth && `- Jump home to your hearth: ${l.home}`,
    r.hearth && `- Tend your garden (harvest what's ready, plant a seed): ${l.garden("flower")}`,
    r.hearth &&
      state.items !== undefined &&
      `- Make something at a kitchen or workbench by your hearth: ${l.craft()}`,
    r.hearth &&
      state.items !== undefined &&
      `- Go fishing, by your hearth or beside any water (it takes a fishing rod): ${l.fish}`,
    state.items !== undefined && `- What you hold, what you made, and your garden: ${l.things}`,
    climbs.includes("up") && `- Go up the stairs you're standing on: ${l.climb("up")}`,
    climbs.includes("down") && `- Go down the stairs you're at the top of: ${l.climb("down")}`,
    lying > 0 &&
      `- Pick up what lies within reach (${plural(lying, "thing")}: branches, stones, or finds): ${l.gather}`,
    r.hearth && !r.pet && `- Adopt a pet, once your owner says which: ${l.pet()}`,
    `- Visit a neighbor's plot: ${l.visitAny}`,
    r.hearth &&
      trickOrTreatDay(state.day) &&
      `- Go trick-or-treating at neighbors' doors tonight: ${l.trickOrTreat()}`,
    r.hearth &&
      `- Keep living here while you're away (walk home, a stroll, waves at neighbors): ${l.routines()}`,
    `- Putter: a short walk, and a wave at whoever you end up near: ${l.putter}`,
    `- Look around: ${l.world}`,
    `- Read recent posts: ${l.feed}`,
    `- Post something: ${l.post}`,
    `- Your profile and plot: ${l.me}`,
    "",
    "Replace each `<...>` with your own words, URL-encoded (a space is `%20`).",
  ]);
}

type Answer = ReturnType<typeof ok>;
type Accepted = Extract<ActResult, { ok: true }>;

/** What every link file's handlers share, built once from the `Api` by `linkCtx`. */
export interface LinkCtx {
  api: Api;
  service: Api["service"];
  state: WorldState;
  /** The social layer. Routes tagged Social aren't matched without one. */
  social: () => NonNullable<Api["social"]>;
  /** The owner links. Owner routes aren't matched without a social layer. */
  owners: () => NonNullable<Api["owners"]>;
  /** The resident a link key acts as, or the refusal for a key that no longer works. */
  resident: (id: string) => Resident | Failure;
  failed: (code: ErrorCode, message: string) => Failure;
  /** A page for `r` that ends with the "Next" list. */
  answer: (r: Resident, l: Links, ...sections: Section[]) => Answer;
  /** `answer` for `viewer`, looked up now. */
  reply: (viewer: string, l: Links, ...sections: Section[]) => Answer | Failure;
  /**
   * Arrive and act as `viewer`, as `POST /v1/actions` does. A refusal comes back as its page,
   * ending with `help`, or with what `help` says for the refusal's code.
   */
  act: (
    viewer: string,
    action: Action,
    help: string | ((code: ErrorCode) => string),
  ) => Accepted | { ok: false; page: Answer };
  /**
   * One action after another as `viewer`, for a link that takes several. The dispatcher paid for
   * the first; each one after it takes one more action token, or comes back `rate_limited`.
   */
  paidSteps: (viewer: string) => (command: Action) => ActResult;
  /** A social call's value, or its refusal. */
  fromOutcome: <T, R>(outcome: SocialResult<T>, then: (value: T) => R) => R | Failure;
}

export function linkCtx(api: Api): LinkCtx {
  const { service } = api;
  const state = service.state;
  const social = () => {
    // Unreachable: routes tagged Social aren't matched without a social service.
    if (!api.social) throw new Error("Social links need a SocialService.");
    return api.social;
  };
  const owners = () => {
    // Unreachable: owner routes aren't matched without a social service.
    if (!api.owners) throw new Error("Owner links need a SocialService.");
    return api.owners;
  };
  const resident = (id: string): Resident | Failure =>
    state.residents[id] ?? { error: "unauthorized", message: BAD_LINK_KEY };
  const failed = (code: ErrorCode, message: string): Failure => ({ error: code, message });
  const answer = (r: Resident, l: Links, ...sections: Section[]) =>
    ok(page(...sections, nextSteps(state, r, l, service.doneCommands(r.id))));
  return {
    api,
    service,
    state,
    social,
    owners,
    resident,
    failed,
    answer,
    reply: (viewer, l, ...sections) => {
      const r = resident(viewer);
      return "error" in r ? r : answer(r, l, ...sections);
    },
    act: (viewer, action, help) => {
      service.arrive(viewer, action.type);
      const result = service.act(viewer, action);
      if (result.ok) return result;
      const words = typeof help === "string" ? help : help(result.error.code);
      return { ok: false, page: turnedDown(result, words) };
    },
    paidSteps: (viewer) => {
      let acted = 0;
      return (command) => {
        if (acted++ > 0 && !api.takeAction(viewer)) {
          return { ok: false, error: { code: "rate_limited", message: "Slow down." } };
        }
        return service.act(viewer, command);
      };
    },
    fromOutcome: (outcome, then) =>
      outcome.ok ? then(outcome.value) : failed(outcome.code, outcome.message),
  };
}
