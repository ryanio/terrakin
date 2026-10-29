import { HOUR_MS, MINUTE_MS } from "@terrakin/sim";
import { z } from "zod";

/**
 * Scene photos (RFC 0049): a photo of the world in 3D, the way people see it, taken by a headless
 * browser loading the client's `/photo` page. The request names a subject and a framing; the
 * server checks it, writes a short-lived ticket, and the page reads that ticket's scene.
 */

/** How the camera frames the subject. */
export const PHOTO_FRAMINGS = ["portrait", "near", "wide"] as const;
export const PhotoFraming = z.enum(PHOTO_FRAMINGS);
export type PhotoFraming = z.infer<typeof PhotoFraming>;

/** The subjects `portrait` takes: one resident, head to toe. */
export const PORTRAIT_SUBJECTS = ["me", "friend"] as const;

/**
 * The world-wide and per-resident caps. A render is 5 to 15 seconds of Browser Run time, and 100
 * a day keeps the month inside the included browser hours (RFC 0049, decided 2026-10-29).
 */
export const SCENE_PHOTO_LIMITS = {
  /** Renders a UTC day across the whole world. */
  perDay: 100,
  /** Renders at once. */
  atOnce: 2,
  /** How long a request waits for a free slot before `photos_busy`. */
  waitMs: 5_000,
  /** Scene photos one resident may take a UTC day, inside their daily uploads. */
  perResidentPerDay: 6,
  /**
   * Failed renders in a UTC day before no more are tried until midnight. A failure gives its slot
   * back, so this is what bounds browser time while the page or the browser is broken.
   */
  failuresPerDay: 20,
  /** How long the photo page has to load, and then to say it's ready. */
  readyMs: 15_000,
  /** How long a ticket works. */
  ticketMs: MINUTE_MS,
  /** How long a moment is kept to be photographed. */
  momentMs: HOUR_MS,
  /** How long after an event ends its guests can still photograph it. */
  afterEventMs: HOUR_MS,
  /** Name tags drawn at most; past that the stamp says how many more. */
  maxTags: 12,
} as const;

/** `retryAfter` for `photos_busy` when the renderer failed or was down. */
export const PHOTOS_OUTAGE_RETRY_SECONDS = 60;
/** `retryAfter` for `photos_busy` when both renders were taken for the whole wait. */
export const PHOTOS_BUSY_RETRY_SECONDS = 10;

const names = z
  .boolean()
  .optional()
  .describe(
    "Draw name tags over the residents in the photo. Off by default. With it on, at most 12 are drawn, each readable and clear of the others.",
  );
const framing = PhotoFraming.optional().describe(
  "`portrait` (a selfie: one resident head to toe, for an outfit or costume; `me` and `friend` only), `near` (about 9 tiles across, the default), or `wide` (the whole plot and a ring of neighbors, and an event's default).",
);
const coord = z.number().int().min(0).max(100_000);
const shared = { names, framing };

/** `POST /v1/photos`'s body. */
export const ScenePhotoRequest = z.discriminatedUnion("subject", [
  z.strictObject({ subject: z.literal("me"), ...shared }),
  z.strictObject({ subject: z.literal("plot"), px: coord, py: coord, ...shared }),
  z.strictObject({ subject: z.literal("event"), event: z.string().min(1).max(64), ...shared }),
  z.strictObject({ subject: z.literal("friend"), id: z.string().min(1).max(64), ...shared }),
  z.strictObject({ subject: z.literal("moment"), moment: z.string().min(1).max(64), ...shared }),
]);
export type ScenePhotoRequest = z.infer<typeof ScenePhotoRequest>;
export type ScenePhotoSubject = ScenePhotoRequest["subject"];

/** What a moment was. */
export const PHOTO_MOMENT_KINDS = [
  /** Made something at a workbench or kitchen. */
  "made",
  /** A pot came out of your kiln. */
  "fired",
  /** Something of yours sold at the market. */
  "sold",
  /** You put on something new: a costume, an outfit piece, a hat, or a changed look. */
  "new_look",
  /** You reached a level. */
  "level",
  /** You hosted or finished an event. */
  "hosted",
  /** You harvested a first crop of a kind. */
  "harvest",
] as const;
export const PhotoMomentKind = z.enum(PHOTO_MOMENT_KINDS);
export type PhotoMomentKind = z.infer<typeof PhotoMomentKind>;

/** One moment worth a photo, from the last hour. `thing` is a catalog name, never resident text. */
export const PhotoMoment = z.object({
  id: z.string().describe('Send it as `moment` with `subject: "moment"`.'),
  kind: PhotoMomentKind,
  thing: z
    .string()
    .optional()
    .describe("What it was about, by its catalog name: `oak table`, `cooking 3`."),
  at: z.number().int().describe("When it happened, ms since the epoch."),
});
export type PhotoMoment = z.infer<typeof PhotoMoment>;

export const PhotoMomentsResponse = z.object({ moments: z.array(PhotoMoment) });
export type PhotoMomentsResponse = z.infer<typeof PhotoMomentsResponse>;

export const PhotoTicketParams = z.object({ ticket: z.string().regex(/^pt_[0-9a-f]{32}$/) });

/**
 * What the photo page draws, read once with its ticket. The world itself comes from the public
 * snapshot; this says where to look, who may be in it, and the moment it was taken.
 */
export const PhotoScene = z.object({
  framing: PhotoFraming,
  names: z.boolean(),
  /** The tile the camera looks at, and the resident it frames when there is one. */
  focus: z.object({ x: z.number(), y: z.number(), id: z.string().optional() }),
  /** The plot the photo shows, for `wide` and for `plot`. Absent on the Commons. */
  plot: z.object({ px: z.number().int(), py: z.number().int() }).optional(),
  /**
   * The only residents drawn: everyone else is left out, as an empty tile. Nobody away, asleep,
   * suspended, or blocked either way with the photographer is in it.
   */
  shown: z.array(z.string()),
  /** The subject and the residents nearest, who keep their tags first in a crowd. */
  first: z.array(z.string()),
  /** The server's clock when the photo was asked for, and how long a world day is. */
  nowMs: z.number(),
  dayLengthMs: z.number(),
  /** The caption under the picture, built from world facts and catalog names only. */
  stamp: z.string(),
  /** A plot's name, a resident's words, shown apart from the stamp. */
  title: z.string().optional(),
  /** Hold the thing a moment was about, in hand or beside: its catalog item kind. */
  holding: z.string().optional(),
});
export type PhotoScene = z.infer<typeof PhotoScene>;
