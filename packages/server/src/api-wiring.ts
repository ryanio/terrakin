import type { HostedEvent } from "@terrakin/sim";
import { routinesOf } from "@terrakin/sim";
import type { Api } from "./api";
import { countGuests } from "./events";
import { madeThingForReport } from "./galleries";
import { gameRatings } from "./games";
import { levelView } from "./levels";
import { listingForReport, listingRefusal } from "./market";
import { PartnerResidents } from "./partner-residents";
import { forgetRetired, moveMerged, socialUsers } from "./repeat-joins";
import { Routines } from "./routines";
import type { SocialService } from "./social-service";
import { report } from "./telemetry";

/**
 * Connect the world to the social layer, once, as the `Api` starts: the hooks each assigns on the
 * other, then the catch-ups that read both (the collection book, ended events, owner pairs, and
 * partner wear). Returns the runners built on both.
 */
export function wireSocial(
  api: Api,
  layer: SocialService,
): { routines: Routines; partnerResidents: PartnerResidents } {
  const service = api.service;
  // Coins (RFC 0008): gifts can't cross a block, and a person and their AI give each other coins
  // without the daily caps. Both facts live in the social layer, so the world asks it.
  service.blockedEither = (a, b) => layer.blockedEither(a, b);
  layer.onOwnerLink = (change, agentId, ownerId) =>
    change === "link"
      ? service.addOwnerPair(agentId, ownerId)
      : service.removeOwnerPair(agentId, ownerId);
  layer.onPost = (post) => api.postListeners.announce(post);
  // Townsfolk answer an @mention on the next minute sweep (decision 0190).
  layer.onMentioned = (postId, authorId, mentioned, borderline) =>
    api.noteMention(postId, authorId, mentioned, borderline);
  // Putter's wave (decision 0049) is an ordinary gesture, with a putter mark and its own limits.
  service.greet = (from, to) => {
    const sent = layer.together.sendGesture(from, to, { kind: "wave" }, { putter: true });
    if (!sent.ok) return false;
    service.notify(to, layer.together.liveGesture(sent.value.gesture, sent.value.streak));
    return true;
  };
  // Offline routines (RFC 0009): the sweep takes their steps, a resident here walking past an
  // away neighbor's hearth may get a wave, and every call keeps a resident's routines going.
  const routines = new Routines({ world: service, social: layer });
  // A partner's residents: who is tied to it from the social tables, and what they did from
  // both the world and the social tables.
  const partnerResidents = new PartnerResidents({
    sql: layer.sql,
    now: layer.now,
    residents: () => Object.values(service.state.residents),
    resident: (id) => layer.resident(id),
    joinedDay: (id) => service.joinedDay(id),
    hasRoutine: (id) => routinesOf(service.state, id).length > 0,
    suspended: (id) => layer.safety.suspendedUntil(id) !== undefined,
    quarantined: (id) => layer.safety.isQuarantined(id),
    credits: (sinceDay) => service.credits(sinceDay),
  });
  service.onWalked = (id) => {
    routines.greetFor(id);
  };
  // A call also tells the owner service: a working credential cancels a re-key (RFC 0025).
  service.onCall = (id) => {
    layer.away.called(id);
    api.owners?.called(id);
  };
  // Who may list in the market (decision 0056): time in Terrakin and karma live out here.
  service.listingRefusal = (id) => listingRefusal(service.state, id, api.listerFacts(id));
  service.suspended = (id) => layer.safety.suspendedUntil(id) !== undefined;
  service.onAdmired = (admirer, maker, day) => layer.karma.recordAdmire(admirer, maker, day);
  // Pets (RFC 0019): a treat logged in the world tells its owner, and a pat (a social row)
  // makes the pet look happy on every screen that shows it.
  service.onPetTreated = (owner, by, kind) => layer.petTreated(owner, by, kind);
  // Recipes (RFC 0024): a lesson logged in the world tells its learner who taught them.
  service.onRecipeTaught = (learner, teacher, recipe) =>
    layer.recipeTaught(learner, teacher, recipe);
  // Halloween (RFC 0022): a knock logged in the world tells everyone who lives at the door.
  service.onTrickOrTreated = (knocker, plot, residents) =>
    layer.trickOrTreated(knocker, plot, residents);
  layer.onPetPatted = (owner) => service.announce({ type: "pet_patted", owner });
  // Plots to visit (RFC 0020): when each plot last changed, and who visited it. The collection
  // book (RFC 0021): what each input brought anyone, filled in once from the world as it is.
  // Welcome visits (decision 0142): a person's first claim queues one; that never throws.
  service.onCommitted = (input, events) => {
    try {
      layer.plots.noteCommitted(service.state, input, events);
    } finally {
      api.welcome?.noteCommitted(input, events);
      layer.collection.noteCommitted(service.state, input, events);
    }
  };
  // Greetings (decision 0237): a person's first join queues one; that never throws.
  service.onNewResident = (id) => api.welcome?.noteJoined(id);
  try {
    layer.collection.backfill(service.state);
  } catch (err) {
    report(err, "world.collection_backfill");
  }
  // Reports on a listing (decision 0056) read it from the world.
  layer.safety.listing = (id) => listingForReport(service.state, id);
  // Reports on a thing on display, or a piece (decision 0059), read it from the world too.
  layer.safety.madeThing = (kind, id) => madeThingForReport(service.state, kind, id);
  // Purged uploads clear every piece made from them (decision 0065): the world logs it.
  layer.safety.removePiecePictures = (mediaId) => service.removePiecePictures(mediaId);
  // Appreciation coins (decision 0055): counted from reactions, logged once a day by `tick`.
  service.dailyAwards = (day) => layer.karma.awards(day);
  // Hosted events (RFC 0010): the town's events name townsfolk by handle, and each event that
  // ends leaves its host's record, with who counted decided out here (ages on the day it
  // ended, blocks).
  service.residentByHandle = (handle) => layer.residentIdByHandle(handle);
  const recordEnded = (event: HostedEvent, day: number) =>
    layer.events.recordEnded(
      event,
      day,
      countGuests(service.state, event, {
        ageDays: (id) => service.residentAgeDays(id, day),
        blockedEither: (a, b) => layer.blockedEither(a, b),
        hostsToday: (guest) => layer.events.hostsCounted(guest, day),
      }),
    );
  service.onEventEnded = recordEnded;
  // The boot's own catch-up can end events before this hook is set, and a crash can come
  // between the world's commit and the record: record each ended event that has none.
  for (const e of layer.events.unrecorded(service.state)) {
    try {
      recordEnded(e, e.closedDay ?? 0);
    } catch (err) {
      report(err, "world.event_ended");
    }
  }
  // Levels (RFC 0029): the switch's one-time credit is read from the collection book, filled in
  // above; each ended event's Hosting points go to the guests the hosting record counted; a
  // level-up tells its resident; and profiles show levels, which live in the world. An event that
  // ended before the record could be read (the boot's catch-up, a crash) is credited now.
  service.levelFirsts = () => layer.collection.firstsCredit(service.state);
  service.countedGuests = (event) => layer.events.countedGuests(event);
  service.onLevelsReached = (id, levels) => layer.levelsReached(id, levels);
  layer.levels = (id) => levelView(service.state, id);
  try {
    service.creditEndedEvents();
  } catch (err) {
    report(err, "world.levels");
  }
  // Party-game ladders (RFC 0011) live in the world; profiles show them.
  layer.gameRatings = (id) => gameRatings(service.state, id);
  service.syncOwnerPairs(layer.ownerPairs());
  // Partner wear (RFC 0007 phase 3): logged as each link changes, and caught up on a timer so
  // promos start and end on the server's clock. At boot, everything at once.
  layer.onPartnerPerks = (id) => service.syncEntitlements(id, layer.agentLinks.entitled(id));
  // A kept agent link ask finishes only while the resident's own call would get through
  // (decision 0128). Not a request, so a pause isn't counted.
  layer.agentLinks.writeBlocked = (id) => api.writeBlock(id, false) !== undefined;
  service.entitlements = () => layer.agentLinks.allEntitled();
  service.reconcileEntitlements(true);
  // Clearing the old repeat joins (decision 0230): the switch reads who used their record out
  // here, and each retired record's credentials are kept as retired before they're turned off,
  // so a caller who sends one hears why. At start, whatever a crash left is cleared again.
  service.socialUsers = () => socialUsers(layer.sql);
  service.onRetired = (ids, people) => {
    for (const id of ids) api.owners?.retireRepeatJoin(id, people.has(id));
    forgetRetired(layer.sql, ids);
  };
  service.forgetRetired(service.state.retiredRepeatJoins ?? []);
  // Merging a duplicate record (decision 0239): its credentials kept as merged before they're
  // turned off, what it held socially moved (`moveMerged`), and the rest cleared as for a retired
  // record. A partner link that moved brings its wear on the entitlements' next check. At start,
  // whatever a crash left is done again.
  service.onMerged = (from, into) => {
    api.owners?.retireMerged(from);
    moveMerged(layer.sql, from, into, service.now());
    forgetRetired(layer.sql, [from]);
  };
  for (const [from, into] of Object.entries(service.state.mergedResidents ?? {})) {
    service.forgetMerged(from, into);
  }
  return { routines, partnerResidents };
}
