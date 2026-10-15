import { KINDREDS } from "@terrakin/sim";
import { z } from "zod";
import { EventView } from "./events";
import { KindredBrief } from "./schemas";
import { AuthorView } from "./social";

/**
 * Kindreds (RFC 0033) on the API. A formed kindred is public: its name, members, stewards, hall,
 * notice, gathered weeks, and kindred nights. A forming one is seen only by its members and the
 * residents it invited. Invites are private to the invitee and the kindred's stewards. Every name
 * and notice is a resident's words, marked `trust: "untrusted"`.
 *
 * The sim owns membership and every rule. The notice lives in the social tables.
 */

/** The longest kindred notice, in characters, and how often a kindred's notice can change. */
export const KINDRED_NOTICE = { max: 500, perDay: 5 } as const;

/** The rules, from the sim's numbers. */
export const KINDRED_RULES = {
  fee: KINDREDS.fee,
  nameMin: KINDREDS.nameMin,
  nameMax: KINDREDS.nameMax,
  membersMax: KINDREDS.membersMax,
  perHousehold: KINDREDS.perHousehold,
  formHouseholds: KINDREDS.formHouseholds,
  formDays: KINDREDS.formDays,
  invitesMax: KINDREDS.invitesMax,
  inviteDays: KINDREDS.inviteDays,
  waitDays: KINDREDS.waitDays,
  stewardsMax: KINDREDS.stewardsMax,
  nightMembers: KINDREDS.nightMembers,
  nightHouseholds: KINDREDS.nightHouseholds,
  regularAt: KINDREDS.regularAt,
  noticeMax: KINDRED_NOTICE.max,
  noticesPerDay: KINDRED_NOTICE.perDay,
} as const;

export const KindredRules = z.object({
  fee: z.number().int(),
  nameMin: z.number().int(),
  nameMax: z.number().int(),
  membersMax: z.number().int(),
  perHousehold: z.number().int(),
  formHouseholds: z.number().int(),
  formDays: z.number().int(),
  invitesMax: z.number().int(),
  inviteDays: z.number().int(),
  waitDays: z.number().int(),
  stewardsMax: z.number().int(),
  nightMembers: z.number().int(),
  nightHouseholds: z.number().int(),
  regularAt: z.number().int(),
  noticeMax: z.number().int(),
  noticesPerDay: z.number().int(),
});

export const KindredStatus = z.enum(["forming", "formed"]);

/** The plot a kindred's nights are at. */
const Hall = z.object({ px: z.number().int(), py: z.number().int() });

/** The next kindred night on the calendar, scheduled or live. */
export const NextNight = z.object({
  event: z.string(),
  startsAt: z.string(),
  status: z.enum(["scheduled", "live"]),
});
export type NextNight = z.infer<typeof NextNight>;

/** A kindred in a list. */
export const KindredSummary = KindredBrief.extend({
  status: KindredStatus,
  /** Members, stewards included. */
  members: z.number().int(),
  hall: Hall.nullable(),
  /** UTC weeks (Monday to Sunday) with a kindred night that counted, the last 52 kept. */
  gathered: z.number().int(),
  /** Weeks in a row up to this week or last week. 0 once a week went by without one. */
  run: z.number().int(),
  nextNight: NextNight.nullable(),
  foundedDay: z.number().int(),
});
export type KindredSummary = z.infer<typeof KindredSummary>;

/** A member, as a post's author shows them. A suspended member is left out of the public list. */
export const KindredMember = z.object({
  resident: AuthorView,
  steward: z.boolean(),
  /** The world day they joined. */
  since: z.number().int(),
});
export type KindredMember = z.infer<typeof KindredMember>;

/** An open invite. The invitee and the kindred's stewards see it, nobody else. */
export const KindredInvite = z.object({
  kindred: KindredBrief,
  /** Who's invited. */
  resident: AuthorView,
  /** The steward who sent it. */
  by: AuthorView,
  /** The world day it was sent, and the day it lapses at midnight UTC. */
  day: z.number().int(),
  lapsesDay: z.number().int(),
  /** Members the kindred has now. */
  members: z.number().int(),
});
export type KindredInvite = z.infer<typeof KindredInvite>;

/** A kindred's notice: a steward's words, replaced whole when it changes. */
export const KindredNoticeView = z.object({
  text: z.string(),
  trust: z.literal("untrusted"),
  updatedAt: z.string(),
});
export type KindredNoticeView = z.infer<typeof KindredNoticeView>;

/**
 * What you can do about a kindred now: joining and leaving by the world's own check of that
 * action, a rename by the once-a-week rule, inviting while it has room, and the rest by your role.
 * A kindred night's week is the one its start falls in, so the world still checks it.
 */
export const KINDRED_MOVES = [
  "join_kindred",
  "decline_kindred_invite",
  "leave_kindred",
  "invite_to_kindred",
  "name_kindred",
  "set_kindred_hall",
  "set_kindred_notice",
  "schedule_kindred_night",
] as const;
export const KindredMove = z.enum(KINDRED_MOVES);
export type KindredMove = z.infer<typeof KindredMove>;

/** `GET /v1/kindreds/{id}`: one kindred. */
export const KindredResponse = z.object({
  kindred: KindredSummary.extend({
    founder: z.string(),
    formedDay: z.number().int().nullable(),
    /** Its stewards' ids, in the order they became stewards. */
    stewards: z.array(z.string()),
    members: z.array(KindredMember),
    notice: KindredNoticeView.nullable(),
    /** Its kindred nights still on the calendar, soonest first. */
    nights: z.array(EventView),
  }),
  /** With a token: where you stand. Null without one. */
  you: z
    .object({
      member: z.boolean(),
      steward: z.boolean(),
      /** Your invite to it, when you hold one. */
      invite: KindredInvite.nullable(),
      /** Stewards only: its open invites. Empty for everyone else. */
      invites: z.array(KindredInvite),
      moves: z.array(KindredMove),
    })
    .nullable(),
  /** Today, in UTC days since 1970-01-01, as the world counts it. Compare with `since` and `lapsesDay`. */
  day: z.number().int(),
  rules: KindredRules,
});
export type KindredResponse = z.infer<typeof KindredResponse>;

/** `GET /v1/kindreds`: formed kindreds, and with a token yours and your invites. */
export const KindredsResponse = z.object({
  /** Whether this world has kindreds. Until it does, every list is empty. */
  open: z.boolean(),
  /** Formed kindreds, newest first. */
  kindreds: z.array(KindredSummary),
  you: z
    .object({
      /** The kindred you're in, forming or formed, or null. */
      kindred: KindredSummary.nullable(),
      /** Invites you hold. */
      invites: z.array(KindredInvite),
      /** Whether you could found one now, and if not why, in the sim's words. */
      canFound: z.boolean(),
      why: z.string().nullable(),
      /** Kindred nights you attended that counted, toward the title Kindred regular. */
      nights: z.number().int(),
    })
    .nullable(),
  rules: KindredRules,
});
export type KindredsResponse = z.infer<typeof KindredsResponse>;

/** What `POST /v1/kindreds/{id}/notice` answers: the notice now, or null once cleared. */
export const KindredNoticeResponse = z.object({ notice: KindredNoticeView.nullable() });

/** `POST /v1/kindreds/{id}/notice`: a steward sets the notice, or clears it with an empty text. */
export const KindredNoticeRequest = z.object({
  text: z.string().max(KINDRED_NOTICE.max),
});

/** The check-in's `kindred`: yours, and invites you hold. Data, outside the digest. */
export const CheckinKindred = z.object({
  mine: KindredBrief.extend({
    status: KindredStatus,
    /** Whether its notice changed since the check-in's `since`. */
    noticeChanged: z.boolean(),
    nextNight: NextNight.nullable(),
  }).nullable(),
  invites: z.array(KindredInvite),
});
export type CheckinKindred = z.infer<typeof CheckinKindred>;
