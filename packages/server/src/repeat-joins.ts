import { socialActors } from "./newcomers";
import { idsFrom, type SqlExec } from "./sql-store";

/**
 * The social side of clearing the old repeat joins (issue #46, decision 0230). The world picks the
 * records (`WorldService.repeatJoinsToRetire`) and the sim takes them out; these read and clear
 * the social tables, which the sim can't see.
 */

/**
 * Everyone who used their record outside the world: everything the newcomer funnel counts as
 * social (posts, reactions, reposts, follows, gestures they chose to send, praise, letters,
 * notices), and a handle, a bio or picture, an upload, an owner link either way, an agent link, an
 * X account, a block, a report, a pat, an admire, or saying they're going to an event. And any
 * sign that its token or link key was used, reads included: a `last_calls` row (every
 * authenticated call writes one, `AwayLog.called`, since 2026-10-06), and the rows that show use
 * from before then: a check-in (`checkin_log`, kept 7 days, and `checkin_suggestions`), an invite,
 * an agent link ask or attempt, an owner or re-key code (`owner_codes`, `owner_rekeys` either
 * way), or an X code. A record in here is never retired.
 */
export function socialUsers(sql: SqlExec): Set<string> {
  const used = socialActors(sql);
  for (const id of idsFrom(sql, [
    "SELECT resident_id FROM handles",
    "SELECT resident_id FROM profiles WHERE bio != '' OR COALESCE(avatar, '') != '' OR COALESCE(banner, '') != ''",
    "SELECT owner FROM media",
    "SELECT agent_id FROM owner_links",
    "SELECT owner_id FROM owner_links",
    "SELECT resident_id FROM agent_links",
    "SELECT resident_id FROM x_links",
    "SELECT blocker FROM blocks",
    "SELECT reporter FROM reports",
    "SELECT patter FROM pet_pats",
    "SELECT admirer FROM plot_admires",
    "SELECT resident_id FROM event_going",
    "SELECT resident FROM last_calls",
    "SELECT resident_id FROM checkin_log",
    "SELECT resident_id FROM checkin_suggestions",
    "SELECT inviter FROM invites",
    "SELECT resident_id FROM agent_link_asks",
    "SELECT resident_id FROM agent_link_attempts",
    "SELECT resident_id FROM owner_codes",
    "SELECT agent_id FROM owner_rekeys",
    "SELECT owner_id FROM owner_rekeys",
    "SELECT resident_id FROM x_codes",
  ])) {
    used.add(id);
  }
  return used;
}

/**
 * Drop what the social tables hold about retired records: their profile rows, every follow to or
 * from them (the welcome routine followed each one), the gestures and streaks with them, their
 * notifications, and their collection book. Moderation rows (reports, suspensions, quarantine, the
 * moderation log) stay. Running it again changes nothing.
 */
export function forgetRetired(sql: SqlExec, ids: readonly string[]) {
  for (const id of ids) {
    for (const [statement, binds] of [
      ["DELETE FROM follows WHERE follower = ? OR followee = ?", 2],
      ["DELETE FROM profiles WHERE resident_id = ?", 1],
      ["DELETE FROM gestures WHERE sender = ? OR recipient = ?", 2],
      ["DELETE FROM streaks WHERE a = ? OR b = ?", 2],
      [
        "DELETE FROM notification_actors WHERE notification_id IN (SELECT id FROM notifications WHERE recipient = ?)",
        1,
      ],
      ["DELETE FROM notifications WHERE recipient = ?", 1],
      ["DELETE FROM notification_log WHERE recipient = ? OR actor = ?", 2],
      ["DELETE FROM collection WHERE resident = ?", 1],
    ] as const) {
      sql.exec(statement, ...Array.from({ length: binds }, () => id));
    }
  }
}
