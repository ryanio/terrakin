import type { Action, MediaType } from "@terrakin/protocol";
import { EVENT_LEAD_MINUTES } from "@terrakin/protocol";
import {
  activeTable,
  asJoined,
  type Command,
  canBuildOn,
  DAY_LENGTH_MS,
  exactWearStyles,
  FISHING,
  findBounty,
  findEvent,
  type Input,
  inEventArea,
  isTownEvent,
  isWater,
  joinTile,
  LOOK_MEDIA_KEYS,
  type LookMediaKey,
  type LooseWearStyles,
  listingById,
  own,
  type Plot,
  type ProfileFields,
  plotAtTile,
  plotInBounds,
  plotKey,
  ROUTINES,
  type Routine,
  residentById,
  skyAt,
  starterOf,
  timeOfDayAt,
  unclaimedMessage,
  visitTile,
  type WorldState,
  waterBeside,
} from "@terrakin/sim";
import { startFree } from "./games";
import type { Moderation, ReviewContext, Surface } from "./moderation";
import { cleanMultiline, cleanText } from "./text";
import { randomBytes, toHex } from "./world-credentials";
import type { ActResult } from "./world-service";

/**
 * What the server checks and fills in before a resident's action is logged: text cleaned and
 * filtered, blocks and suspensions the sim can't see, look and piece media, and the clock, salt,
 * rolls, and tiles a logged command carries so replay never needs them. `WorldService.perform`
 * handles chat, putter, and build itself and hands every other action to `performAction`.
 */

/** What the checks here read from `WorldService`, and the one way they change the world. */
export interface ActionContext {
  readonly state: WorldState;
  readonly moderation: Moderation;
  now(): number;
  /** `WorldService.run`: check, persist, commit, broadcast; with `dry`, check only. */
  run(input: Input, dry: boolean): ActResult;
  blockedEither(a: string, b: string): boolean;
  suspended(residentId: string): boolean;
  listingRefusal(residentId: string): string | null;
  /** The type of an upload the owner made, or undefined (see `OwnedMediaType`). */
  mediaType: OwnedMediaType;
  /** Tell the social layer a resident's look media after an accepted change. */
  pinLookMedia(residentId: string): void;
  /** Tell the social layer the upload a new piece shows. */
  pinPieceMedia(itemId: string, mediaId: string): void;
  /** The game tables' clock (`WorldService.runGames`). */
  runGames(): void;
}

/**
 * A cast's roll (RFC 0023): a whole number from 0 to `FISHING.outOf - 1`, every one as likely, from
 * Web Crypto. Draws past the last whole multiple of `outOf` are drawn again, so none is favored.
 */
function castRoll(): number {
  const span = 2 ** 32;
  const fair = span - (span % FISHING.outOf);
  for (;;) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    if (n < fair) return n % FISHING.outOf;
  }
}

/** Drop absent fields (the sim's types forbid explicit undefined) and clean the note text. */
export type LooseProfile = {
  [K in Exclude<keyof ProfileFields, "wearStyle">]?: ProfileFields[K] | undefined;
} & { wearStyle?: LooseWearStyles | null | undefined };

export function cleanProfile(fields: LooseProfile): ProfileFields {
  const out: ProfileFields = {
    ...(fields.color ? { color: fields.color } : {}),
    ...(fields.shape ? { shape: fields.shape } : {}),
    ...(fields.note !== undefined ? { note: cleanText(fields.note) } : {}),
  };
  // Look fields: absent stays absent, null (clear) is kept.
  if (fields.theme !== undefined) out.theme = fields.theme;
  if (fields.pattern !== undefined) out.pattern = fields.pattern;
  if (fields.wear !== undefined) out.wear = [...fields.wear];
  if (fields.wearStyle !== undefined) {
    out.wearStyle = fields.wearStyle === null ? null : exactWearStyles(fields.wearStyle);
  }
  if (fields.hair !== undefined) out.hair = fields.hair;
  if (fields.hairColor !== undefined) out.hairColor = fields.hairColor;
  for (const key of LOOK_MEDIA_KEYS) {
    const value = fields[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** What each look media field may be: still images for art and patterns, `.glb` for models. */
const LOOK_MEDIA_TYPES: Record<LookMediaKey, { types: readonly MediaType[]; what: string }> = {
  patternMedia: {
    types: ["image/png", "image/jpeg", "image/webp"],
    what: "Your pattern must be one of your PNG, JPEG, or WebP uploads.",
  },
  homeArt: {
    types: ["image/png", "image/jpeg", "image/webp"],
    what: "Your home picture must be one of your PNG, JPEG, or WebP uploads.",
  },
  homeModel: {
    types: ["model/gltf-binary"],
    what: "Your home model must be one of your .glb uploads.",
  },
};

/** What a piece of art may show: a still picture, or a `.glb` model. */
const PIECE_MEDIA_TYPES: readonly MediaType[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "model/gltf-binary",
];

/** Look up the type of an upload `owner` made, or undefined if it isn't theirs (or doesn't exist). */
export type OwnedMediaType = (owner: string, mediaId: string) => MediaType | undefined;

/** Run text through the edge filters (moderation.ts). Undefined when it may go ahead. */
export function filtered(
  moderation: Moderation,
  surface: Surface,
  text: string | undefined,
  context: ReviewContext,
): ActResult | undefined {
  if (text === undefined || text === "") return undefined;
  const verdict = moderation.review(surface, text, context);
  if (verdict.ok) return undefined;
  return { ok: false, error: { code: verdict.code, message: verdict.message } };
}

/** Refuse look media that aren't the resident's own uploads of the right kind. */
export function checkLookMedia(
  mediaType: OwnedMediaType,
  residentId: string,
  fields: LooseProfile,
): ActResult | undefined {
  for (const key of LOOK_MEDIA_KEYS) {
    const id = fields[key];
    if (id === undefined || id === null) continue;
    const rule = LOOK_MEDIA_TYPES[key];
    const type = mediaType(residentId, id);
    if (!type || !rule.types.includes(type)) {
      return { ok: false, error: { code: "bad_request", message: rule.what } };
    }
  }
  return undefined;
}

/**
 * Every action but chat, putter, and build: its checks, then its command, logged through
 * `ctx.run` (or with `dry` only checked). An action with nothing to check or fill in is logged
 * as it came.
 */
export function performAction(
  ctx: ActionContext,
  residentId: string,
  action: Exclude<Action, { type: "chat" | "putter" | "build" }>,
  dry: boolean,
): ActResult {
  const context = { resident: residentId };
  if (action.type === "profile") {
    const { type, ...profile } = action;
    const note = profile.note && cleanText(profile.note);
    const refused = filtered(ctx.moderation, "note", note, context);
    if (refused) return refused;
    const media = checkLookMedia(ctx.mediaType, residentId, profile);
    if (media) return media;
    const command: Command = { type, ...cleanProfile(profile) };
    const result = ctx.run({ actor: residentId, command }, dry);
    if (result.ok && !dry) ctx.pinLookMedia(residentId);
    return result;
  }
  if (action.type === "visit") return visit(ctx, residentId, action.px, action.py, dry);
  if (action.type === "trick_or_treat") {
    const { px, py } = action;
    const refused = closedDoor(ctx, residentId, px, py, "You can't knock at this door.");
    if (refused) return refused;
    return ctx.run({ actor: residentId, command: { type: "trick_or_treat", px, py } }, dry);
  }
  if (action.type === "build_starter_home") {
    // Drop absent fields: the sim's types forbid explicit undefined.
    const { walls, windows } = action;
    const command: Command = {
      type: "build_starter_home",
      ...(walls ? { walls } : {}),
      ...(windows ? { windows } : {}),
    };
    return ctx.run({ actor: residentId, command }, dry);
  }
  if (action.type === "propose" && action.kind === "grant" && action.to) {
    // Like a gift, a grant can't name someone across a block either way.
    if (ctx.blockedEither(residentId, action.to)) {
      return {
        ok: false,
        error: { code: "forbidden", message: "You can't propose a grant for this resident." },
      };
    }
  }
  if (action.type === "propose") {
    // Proposal text is read by everyone, agents included: clean it and turn away text written
    // as orders to AI readers before it's logged. The sim stores what's logged.
    const title = cleanText(action.title);
    const text = cleanMultiline(action.text ?? "");
    const refused =
      filtered(ctx.moderation, "proposal_title", title, context) ??
      filtered(ctx.moderation, "proposal_text", text, context);
    if (refused) return refused;
    const { blocks, remove, ground, lift, amount, to } = action;
    const command: Command = {
      type: "propose",
      kind: action.kind,
      title,
      text,
      ...(blocks?.length ? { blocks } : {}),
      ...(remove?.length ? { remove } : {}),
      ...(ground?.length ? { ground } : {}),
      ...(lift?.length ? { lift } : {}),
      ...(amount === undefined ? {} : { amount }),
      ...(to === undefined ? {} : { to }),
    };
    return ctx.run({ actor: residentId, command }, dry);
  }
  if (action.type === "give_coins") {
    // Blocks live in the social layer; a gift can't cross one either way (decision 0024).
    if (ctx.blockedEither(residentId, action.to)) {
      return {
        ok: false,
        error: { code: "forbidden", message: "You can't send coins to this resident." },
      };
    }
    const note = action.note === undefined ? "" : cleanText(action.note);
    const refused = filtered(ctx.moderation, "gift_note", note, context);
    if (refused) return refused;
    const command: Command = {
      type: "give_coins",
      to: action.to,
      amount: action.amount,
      ...(note ? { note } : {}),
    };
    return ctx.run({ actor: residentId, command }, dry);
  }
  if (action.type === "give") {
    // Like coins, a gift can't cross a block either way (decision 0024).
    if (ctx.blockedEither(residentId, action.to)) {
      return {
        ok: false,
        error: { code: "forbidden", message: "You can't give things to this resident." },
      };
    }
    const note = action.note === undefined ? "" : cleanText(action.note);
    const refused = filtered(ctx.moderation, "gift_note", note, context);
    if (refused) return refused;
    const command: Command = {
      type: "give",
      item: action.item,
      to: action.to,
      ...(action.count === undefined ? {} : { count: action.count }),
      ...(note ? { note } : {}),
    };
    return ctx.run({ actor: residentId, command }, dry);
  }
  if (action.type === "gather") {
    // Without a tile it gathers everything within reach. Drop absent fields: the sim's types
    // forbid explicit undefined.
    const { x, y } = action;
    const command: Command = {
      type: "gather",
      ...(x === undefined ? {} : { x }),
      ...(y === undefined ? {} : { y }),
    };
    return ctx.run({ actor: residentId, command }, dry);
  }
  if (action.type === "craft") {
    // A label travels with the thing to everyone who holds it: clean it and filter it first.
    const label = action.label === undefined ? "" : cleanText(action.label);
    const refused = filtered(ctx.moderation, "item_label", label, context);
    if (refused) return refused;
    const command: Command = {
      type: "craft",
      recipe: action.recipe,
      x: action.x,
      y: action.y,
      ...(label ? { label } : {}),
    };
    return ctx.run({ actor: residentId, command }, dry);
  }
  if (action.type === "make_piece") {
    // A title travels with the piece to everyone who sees it: clean it and filter it first.
    const title = cleanText(action.title);
    const refused = filtered(ctx.moderation, "item_label", title, context);
    if (refused) return refused;
    const type = ctx.mediaType(residentId, action.media);
    if (!type || !PIECE_MEDIA_TYPES.includes(type)) {
      return {
        ok: false,
        error: {
          code: "invalid_piece",
          message: "A piece shows one of your PNG, JPEG, or WebP uploads, or a .glb model.",
        },
      };
    }
    const command: Command = {
      type: "make_piece",
      media: action.media,
      title,
      ...(type === "model/gltf-binary" ? { model: true as const } : {}),
    };
    const result = ctx.run({ actor: residentId, command }, dry);
    if (result.ok && !dry) {
      for (const e of result.events) {
        if (e.type !== "inventory") continue;
        for (const g of e.gained ?? []) if (g.media) ctx.pinPieceMedia(g.id, g.media);
      }
    }
    return result;
  }
  if (action.type === "adopt_pet" || action.type === "rename_pet") {
    // A pet's name is shown to everyone, agents included, wherever the pet is: cleaned and
    // filtered like a resident's name before it's logged (RFC 0019).
    const name = cleanText(action.name);
    const refused = filtered(ctx.moderation, "pet_name", name, context);
    if (refused) return refused;
    const command: Command =
      action.type === "adopt_pet"
        ? { type: "adopt_pet", kind: action.kind, coat: action.coat, name }
        : { type: "rename_pet", name };
    return ctx.run({ actor: residentId, command }, dry);
  }
  if (action.type === "name_plot") {
    // A plot's name is shown to everyone, agents included, on the map and wherever the plot is:
    // cleaned and filtered like a resident's name before it's logged (decision 0121). A clear
    // carries no words.
    const name = action.name === null ? null : cleanText(action.name);
    if (name !== null) {
      const refused = filtered(ctx.moderation, "plot_name", name, context);
      if (refused) return refused;
    }
    const command: Command = { type: "name_plot", px: action.px, py: action.py, name };
    return ctx.run({ actor: residentId, command }, dry);
  }
  if (action.type === "teach" && ctx.blockedEither(residentId, action.to)) {
    // Like a gift, a lesson can't cross a block either way (RFC 0024).
    return {
      ok: false,
      error: { code: "forbidden", message: "You can't teach this resident." },
    };
  }
  if (action.type === "teach" && ctx.suspended(action.to)) {
    // A suspended resident can't act; nobody teaches them until staff lift it.
    return {
      ok: false,
      error: { code: "forbidden", message: "You can't teach this resident right now." },
    };
  }
  if (action.type === "treat_pet" && ctx.blockedEither(residentId, action.owner)) {
    // Like a gift, a treat can't cross a block either way.
    return {
      ok: false,
      error: { code: "forbidden", message: "You can't give this resident's pet a treat." },
    };
  }
  if (action.type === "post_bounty") {
    // A bounty's words are read by everyone, agents included: cleaned and filtered like a
    // proposal's before they're logged (decision 0004).
    const title = cleanText(action.title);
    const text = cleanMultiline(action.text ?? "");
    const refused =
      filtered(ctx.moderation, "bounty_title", title, context) ??
      filtered(ctx.moderation, "bounty_text", text, context);
    if (refused) return refused;
    const command: Command = {
      type: "post_bounty",
      title,
      reward: action.reward,
      ...(text ? { text } : {}),
    };
    return ctx.run({ actor: residentId, command }, dry);
  }
  if (action.type === "schedule_event") return scheduleEvent(ctx, residentId, action, dry);
  if (action.type === "join_event") {
    const e = findEvent(ctx.state, action.event);
    const host = e && !isTownEvent(e) ? e.host : undefined;
    // Like a gift, going to an event can't cross a block, and a suspended host's are shut.
    if (host && ctx.blockedEither(residentId, host)) {
      return {
        ok: false,
        error: { code: "forbidden", message: "You can't go to this resident's events." },
      };
    }
    if (host && ctx.suspended(host)) {
      return {
        ok: false,
        error: { code: "forbidden", message: "That event is closed for now." },
      };
    }
    // Already there and online: nothing to log. The call itself keeps them from going idle,
    // which is how a guest on REST stays counted.
    const me = residentById(ctx.state, residentId);
    if (
      e?.status === "live" &&
      me &&
      (me.online || dry) &&
      inEventArea(ctx.state.config, e, me.x, me.y)
    ) {
      return { ok: true, seq: ctx.state.seq, events: [] };
    }
    // The planner picks where they land, as for a visit (the plot's edge, by the door), and the
    // logged input carries it, so replay never runs the planner.
    const tile =
      e?.status === "live" ? joinTile(asJoined(ctx.state, residentId), residentId, e) : undefined;
    const command: Command = {
      type: "join_event",
      event: action.event,
      ...(tile ? { x: tile.x, y: tile.y } : {}),
    };
    return ctx.run({ actor: residentId, command }, dry);
  }
  if (action.type === "claim_bounty") {
    // Like a sale, a bounty can't cross a block either way, and a suspended poster's are shut.
    const b = findBounty(ctx.state, action.bounty);
    const poster = b && b.proposal === undefined ? b.poster : undefined;
    if (poster && ctx.blockedEither(residentId, poster)) {
      return {
        ok: false,
        error: { code: "forbidden", message: "You can't take this resident's bounties." },
      };
    }
    if (poster && ctx.suspended(poster)) {
      return {
        ok: false,
        error: { code: "forbidden", message: "That bounty is closed for now." },
      };
    }
  }
  if (action.type === "list_item") {
    const why = ctx.listingRefusal(residentId);
    if (why) return { ok: false, error: { code: "not_eligible", message: why } };
    const command: Command = {
      type: "list_item",
      item: action.item,
      price: action.price,
      ...(action.count === undefined ? {} : { count: action.count }),
    };
    return ctx.run({ actor: residentId, command }, dry);
  }
  if (action.type === "buy_listing") {
    // Like a gift, a sale can't cross a block either way.
    const seller = listingById(ctx.state, action.listing)?.seller;
    if (seller && ctx.blockedEither(residentId, seller)) {
      return {
        ok: false,
        error: { code: "forbidden", message: "You can't buy from this resident." },
      };
    }
    if (seller && ctx.suspended(seller)) {
      return {
        ok: false,
        error: { code: "forbidden", message: "That stall is closed for now." },
      };
    }
  }
  if (action.type === "set_routines") {
    // Defaults go in before it's logged, so the log holds the hour each routine runs at.
    const command: Command = {
      type: "set_routines",
      routines: action.routines.map((r): Routine => {
        if (r.kind === "greet") return { kind: r.kind, max: r.max ?? ROUTINES.greetMax };
        const hour =
          r.hour ?? (r.kind === "walk_home" ? ROUTINES.walkHomeHour : ROUTINES.strollHour);
        return { kind: r.kind, hour };
      }),
    };
    return ctx.run({ actor: residentId, command }, dry);
  }
  if (action.type === "fish") return fish(ctx, residentId, dry);
  if (action.type === "shop_buy" || action.type === "sell_to_town") {
    const count = action.count === undefined ? {} : { count: action.count };
    const command: Command =
      action.type === "shop_buy"
        ? { type: "shop_buy", sku: action.sku, ...count }
        : { type: "sell_to_town", item: action.item, ...count };
    return ctx.run({ actor: residentId, command }, dry);
  }
  // Party games (RFC 0011). The server stamps tables with its salt and clock before logging.
  if (action.type === "open_table") {
    const command: Command = {
      type: "open_table",
      game: action.game,
      pace: action.pace,
      salt: toHex(randomBytes(16)),
      at: ctx.now(),
    };
    return ctx.run({ actor: residentId, command }, dry);
  }
  if (action.type === "sit") {
    // Like a gift, a seat can't cross a block either way.
    const t = activeTable(ctx.state, action.table);
    if (t?.seats.some((s) => ctx.blockedEither(residentId, s.resident))) {
      return {
        ok: false,
        error: { code: "forbidden", message: "You can't sit at this table." },
      };
    }
    const command: Command = { type: "sit", table: action.table, at: ctx.now() };
    return ctx.run({ actor: residentId, command }, dry);
  }
  if (action.type === "start_game" || action.type === "decide") {
    // Once the first seat has let the start grace pass, anyone seated may start it.
    const t = activeTable(ctx.state, action.table);
    const now = ctx.now();
    const free =
      t !== undefined && startFree(t, now) && starterOf(ctx.state, t) !== residentId
        ? { free: true as const }
        : {};
    const command: Command =
      action.type === "start_game"
        ? { type: "start_game", table: action.table, at: now, ...free }
        : { type: "decide", table: action.table, round: action.round, move: action.move };
    const result = ctx.run({ actor: residentId, command }, dry);
    // Townsfolk take their turn, and a round everyone has settled closes now, not at its end.
    if (result.ok && !dry) ctx.runGames();
    return result;
  }
  return ctx.run({ actor: residentId, command: action satisfies Command }, dry);
}

/**
 * `schedule_event`: the words are cleaned and filtered like a bounty's before they're logged
 * (decision 0004), and the start, sent as an ISO time, is checked against the clock (at least
 * `EVENT_LEAD_MINUTES` ahead). The sim checks the rest.
 */
function scheduleEvent(
  ctx: ActionContext,
  residentId: string,
  action: Extract<Action, { type: "schedule_event" }>,
  dry: boolean,
): ActResult {
  const context = { resident: residentId };
  const title = cleanText(action.title);
  const text = cleanMultiline(action.text ?? "");
  const refused =
    filtered(ctx.moderation, "event_title", title, context) ??
    filtered(ctx.moderation, "event_text", text, context);
  if (refused) return refused;
  const startsAt = Date.parse(action.startsAt);
  if (!Number.isSafeInteger(startsAt) || startsAt % 60_000 !== 0) {
    return {
      ok: false,
      error: {
        code: "invalid_event",
        message: "Start on a whole minute, like 2026-10-11T19:00:00Z.",
      },
    };
  }
  const now = ctx.now();
  if (startsAt < now + EVENT_LEAD_MINUTES * 60_000) {
    return {
      ok: false,
      error: {
        code: "invalid_event",
        message: `An event starts at least an hour from now, so guests can plan. It's ${new Date(now).toISOString()} here.`,
      },
    };
  }
  const command: Command = {
    type: "schedule_event",
    kind: action.kind,
    title,
    ...(text ? { text } : {}),
    px: action.px,
    py: action.py,
    startsAt,
    minutes: action.minutes,
  };
  return ctx.run({ actor: residentId, command }, dry);
}

/**
 * A cast. The server rolls it and notes the weather and the map's time of day on its own clock,
 * and the logged command carries all three, so replay never reads a clock or the weather and
 * nobody can pick a rainy night or a lucky roll. Never into the pond of anyone blocked either way,
 * nor of a suspended owner, whose plot is closed for now, as for a visit.
 */
function fish(ctx: ActionContext, residentId: string, dry: boolean): ActResult {
  const me = asJoined(ctx.state, residentId).residents[residentId];
  const water = me ? waterBeside(me, (x, y) => isWater(ctx.state, x, y)) : undefined;
  const plot = water ? plotAtTile(ctx.state, water.x, water.y) : undefined;
  if (plot) {
    const refused = closedDoor(
      ctx,
      residentId,
      plot.px,
      plot.py,
      "You can't fish in this resident's pond.",
    );
    if (refused) return refused;
  }
  const now = ctx.now();
  const command: Command = {
    type: "fish",
    roll: castRoll(),
    weather: skyAt(now, ctx.state.day).weather,
    timeOfDay: timeOfDayAt(now, DAY_LENGTH_MS),
  };
  return ctx.run({ actor: residentId, command }, dry);
}

/**
 * A jump to someone else's plot. The sim's planner picks the tile, from where the resident will
 * be (an offline one comes back with the visit itself, and a dry run checks them as if they had),
 * and the logged command carries it, so replay never runs the planner. Never onto the plot of
 * anyone blocked either way, owner or co-owner, nor of a suspended owner, whose plot is closed for
 * now like their stall. A plot nobody lives on gets a hint that names one the resident can visit.
 */
function visit(
  ctx: ActionContext,
  residentId: string,
  px: number,
  py: number,
  dry: boolean,
): ActResult {
  const refused = closedDoor(ctx, residentId, px, py, "You can't visit this plot.");
  if (refused) return refused;
  const blocked = (p: Plot) =>
    [p.ownerId, ...(p.coOwners ?? [])].some((id) => ctx.blockedEither(residentId, id));
  const view = asJoined(ctx.state, residentId);
  const tile = visitTile(view, residentId, px, py);
  const command: Command = { type: "visit", px, py, ...(tile ? { x: tile.x, y: tile.y } : {}) };
  const result = ctx.run({ actor: residentId, command }, dry);
  if (result.ok || result.error.code !== "plot_unclaimed") return result;
  const closed = (p: Plot) => ctx.suspended(p.ownerId) || blocked(p);
  const message = unclaimedMessage(view, residentId, px, py, closed);
  return { ...result, error: { ...result.error, message } };
}

/**
 * Why a resident can't come to the door of plot (px, py), from what the sim can't see: a
 * suspended owner's plot is closed for now, and nobody comes to the door of anyone blocked either
 * way, owner or co-owner. A visit (RFC 0020) and a trick-or-treater's knock (RFC 0022) both ask.
 * Undefined when nothing out here stands in the way.
 */
function closedDoor(
  ctx: ActionContext,
  residentId: string,
  px: number,
  py: number,
  blockedLine: string,
): ActResult | undefined {
  const plot = plotInBounds(ctx.state.config, px, py)
    ? own(ctx.state.plots, plotKey(px, py))
    : undefined;
  if (!plot || canBuildOn(plot, residentId)) return undefined;
  if (ctx.suspended(plot.ownerId)) {
    return { ok: false, error: { code: "forbidden", message: "That plot is closed for now." } };
  }
  if ([plot.ownerId, ...(plot.coOwners ?? [])].some((id) => ctx.blockedEither(residentId, id))) {
    return { ok: false, error: { code: "forbidden", message: blockedLine } };
  }
  return undefined;
}
