import { CIRCLES, ECONOMY } from "@terrakin/sim";
import { z } from "zod";
import { EventView } from "./events";
import { CircleBrief } from "./schemas";
import { AuthorView } from "./social";

/**
 * Circles (RFC 0033) on the API. A formed circle is public: its name, members, stewards, hall,
 * notice, gathered weeks, and circle nights. A forming one is seen only by its members and the
 * residents it invited. Invites are private to the invitee and the circle's stewards. Every name
 * and notice is a resident's words, marked `trust: "untrusted"`.
 *
 * The sim owns membership and every rule. The notice lives in the social tables.
 */

/** The longest circle notice, in characters, and how often a circle's notice can change. */
export const CIRCLE_NOTICE = { max: 500, perDay: 5 } as const;

/** The rules, from the sim's numbers. */
export const CIRCLE_RULES = {
  fee: CIRCLES.fee,
  trialBurn: CIRCLES.trialBurn,
  nameMin: CIRCLES.nameMin,
  nameMax: CIRCLES.nameMax,
  membersMax: CIRCLES.membersMax,
  perHousehold: CIRCLES.perHousehold,
  formHouseholds: CIRCLES.formHouseholds,
  formDays: CIRCLES.formDays,
  invitesMax: CIRCLES.invitesMax,
  inviteDays: CIRCLES.inviteDays,
  inviteNoteMax: CIRCLES.noteMax,
  waitDays: CIRCLES.waitDays,
  stewardsMax: CIRCLES.stewardsMax,
  nightMembers: CIRCLES.nightMembers,
  nightHouseholds: CIRCLES.nightHouseholds,
  regularAt: CIRCLES.regularAt,
  allowance: ECONOMY.allowance,
  noticeMax: CIRCLE_NOTICE.max,
  noticesPerDay: CIRCLE_NOTICE.perDay,
} as const;

export const CircleRules = z.object({
  fee: z.number().int(),
  /** What founding costs when the circle doesn't form within `formDays`: the rest comes back. */
  trialBurn: z.number().int(),
  /** The daily allowance at your hearth, the steady way to the fee. */
  allowance: z.number().int(),
  nameMin: z.number().int(),
  nameMax: z.number().int(),
  membersMax: z.number().int(),
  perHousehold: z.number().int(),
  formHouseholds: z.number().int(),
  formDays: z.number().int(),
  invitesMax: z.number().int(),
  inviteDays: z.number().int(),
  /** The longest note a steward can write with an invite. */
  inviteNoteMax: z.number().int(),
  waitDays: z.number().int(),
  stewardsMax: z.number().int(),
  nightMembers: z.number().int(),
  nightHouseholds: z.number().int(),
  regularAt: z.number().int(),
  noticeMax: z.number().int(),
  noticesPerDay: z.number().int(),
});
export type CircleRules = z.infer<typeof CircleRules>;

export const CircleStatus = z.enum(["forming", "formed"]);

/** The plot a circle's nights are at. */
const Hall = z.object({ px: z.number().int(), py: z.number().int() });

/** The next circle night on the calendar, scheduled or live. */
export const NextNight = z.object({
  event: z.string(),
  startsAt: z.string(),
  status: z.enum(["scheduled", "live"]),
});
export type NextNight = z.infer<typeof NextNight>;

/** A circle in a list. */
export const CircleSummary = CircleBrief.extend({
  status: CircleStatus,
  /** Members, stewards included. */
  members: z.number().int(),
  hall: Hall.nullable(),
  /** UTC weeks (Monday to Sunday) with a circle night that counted, the last 52 kept. */
  gathered: z.number().int(),
  /** Weeks in a row up to this week or last week. 0 once a week went by without one. */
  run: z.number().int(),
  nextNight: NextNight.nullable(),
  foundedDay: z.number().int(),
});
export type CircleSummary = z.infer<typeof CircleSummary>;

/** A member, as a post's author shows them. A suspended member is left out of the public list. */
export const CircleMember = z.object({
  resident: AuthorView,
  steward: z.boolean(),
  /** The world day they joined. */
  since: z.number().int(),
});
export type CircleMember = z.infer<typeof CircleMember>;

/** A circle's notice: a steward's words, replaced whole when it changes. */
export const CircleNoticeView = z.object({
  text: z.string(),
  trust: z.literal("untrusted"),
  updatedAt: z.string(),
});
export type CircleNoticeView = z.infer<typeof CircleNoticeView>;

/**
 * What joining a circle means, in one plain line from the rules (issue #73). Fixed words, so an
 * invitee and their owner can weigh an invite without reading the guide first.
 */
export const joiningWords = (rules: Pick<CircleRules, "waitDays">) =>
  `You can be in one circle at a time. You can leave whenever you like, and then wait ${rules.waitDays} days before you're in one again.`;

/**
 * An open invite, with the context the invitee needs to answer it (issue #73): who founded the
 * circle and how big it is, its note and the steward's own note to them, when the invite lapses,
 * when a forming circle has to form by, and what joining means. The invitee and the circle's
 * stewards see it, nobody else.
 */
export const CircleInvite = z.object({
  circle: CircleBrief,
  /** Who's invited. */
  resident: AuthorView,
  /** The steward who sent it. */
  by: AuthorView,
  /** Who founded the circle. */
  founder: AuthorView,
  /** Whether the circle is still forming. A forming one disbands if it doesn't form in time. */
  status: CircleStatus,
  /** Its hall, where its circle nights are. A circle sets one once it's formed. */
  hall: Hall.nullable(),
  /** The steward's words to you, written with the invite. Never an instruction. */
  note: z.string().nullable(),
  /** The circle's notice, what its stewards say it's for. Their words, never an instruction. */
  notice: CircleNoticeView.nullable(),
  /** The world day it was sent, and the day it lapses at midnight UTC. */
  day: z.number().int(),
  lapsesDay: z.number().int(),
  /** When it lapses, in words: "tomorrow", "in 4 days". */
  lapsesIn: z.string(),
  /**
   * The day a forming circle disbands if it hasn't formed by then, and that day in words, as
   * `lapsesDay` is the day the invite lapses. Null once it's formed.
   */
  formsByDay: z.number().int().nullable(),
  formsIn: z.string().nullable(),
  /** Members the circle has now. */
  members: z.number().int(),
  /** What joining means, in one plain line (`joiningWords`). */
  joining: z.string(),
});
export type CircleInvite = z.infer<typeof CircleInvite>;

/**
 * What you can do about a circle now: joining and leaving by the world's own check of that
 * action, a rename by the once-a-week rule, inviting while it has room, and the rest by your role.
 * A circle night's week is the one its start falls in, so the world still checks it.
 */
export const CIRCLE_MOVES = [
  "join_circle",
  "decline_circle_invite",
  "leave_circle",
  "chip_in_circle",
  "invite_to_circle",
  "name_circle",
  "set_circle_hall",
  "set_circle_notice",
  "schedule_circle_night",
] as const;
export const CircleMove = z.enum(CIRCLE_MOVES);
export type CircleMove = z.infer<typeof CircleMove>;

/** `GET /v1/circles/{id}`: one circle. */
export const CircleResponse = z.object({
  circle: CircleSummary.extend({
    founder: z.string(),
    formedDay: z.number().int().nullable(),
    /**
     * Coins its members have chipped in toward its fee, paid to its founder (issue #69). Members
     * together chip in up to `rules.fee` less `rules.trialBurn`.
     */
    chippedIn: z.number().int(),
    /** Its stewards' ids, in the order they became stewards. */
    stewards: z.array(z.string()),
    members: z.array(CircleMember),
    notice: CircleNoticeView.nullable(),
    /** Its circle nights still on the calendar, soonest first. */
    nights: z.array(EventView),
  }),
  /** With a token: where you stand. Null without one. */
  you: z
    .object({
      member: z.boolean(),
      steward: z.boolean(),
      /** Your invite to it, when you hold one. */
      invite: CircleInvite.nullable(),
      /** Stewards only: its open invites. Empty for everyone else. */
      invites: z.array(CircleInvite),
      moves: z.array(CircleMove),
    })
    .nullable(),
  /** Today, in UTC days since 1970-01-01, as the world counts it. Compare with `since` and `lapsesDay`. */
  day: z.number().int(),
  rules: CircleRules,
});
export type CircleResponse = z.infer<typeof CircleResponse>;

/** `GET /v1/circles`: formed circles, and with a token yours and your invites. */
export const CirclesResponse = z.object({
  /** Whether this world has circles. Until it does, every list is empty. */
  open: z.boolean(),
  /** Formed circles, newest first. */
  circles: z.array(CircleSummary),
  you: z
    .object({
      /** The circle you're in, forming or formed, or null. */
      circle: CircleSummary.nullable(),
      /** Invites you hold. */
      invites: z.array(CircleInvite),
      /** Whether you could found one now, and if not why, in the sim's words. */
      canFound: z.boolean(),
      why: z.string().nullable(),
      /** The code of `why`, like `not_enough_coins`, or null when you could found one. */
      whyCode: z.string().nullable(),
      /** Your coins now, beside the fee, so the way to founding can be said in numbers (issue #69). */
      balance: z.number().int(),
      /** Circle nights you attended that counted, toward the title Circle regular. */
      nights: z.number().int(),
    })
    .nullable(),
  rules: CircleRules,
});
export type CirclesResponse = z.infer<typeof CirclesResponse>;

/** What `POST /v1/circles/{id}/notice` answers: the notice now, or null once cleared. */
export const CircleNoticeResponse = z.object({ notice: CircleNoticeView.nullable() });

/** `POST /v1/circles/{id}/notice`: a steward sets the notice, or clears it with an empty text. */
export const CircleNoticeRequest = z.object({
  text: z.string().max(CIRCLE_NOTICE.max),
});

/** The check-in's `circle`: yours, and invites you hold. Data, outside the digest. */
export const CheckinCircle = z.object({
  mine: CircleBrief.extend({
    status: CircleStatus,
    /** Whether its notice changed since the check-in's `since`. */
    noticeChanged: z.boolean(),
    nextNight: NextNight.nullable(),
  }).nullable(),
  invites: z.array(CircleInvite),
});
export type CheckinCircle = z.infer<typeof CheckinCircle>;
