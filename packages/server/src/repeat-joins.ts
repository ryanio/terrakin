import { socialActors } from "./newcomers";
import type { SqlExec } from "./sql-store";

/**
 * The social side of clearing the old repeat joins (issue #46, decision 0230). The world picks the
 * records (`WorldService.repeatJoinsToRetire`) and the sim takes them out; these read and clear
 * the social tables, which the sim can't see.
 */

/**
 * Everyone who used their record outside the world: everything the newcomer funnel counts as
 * social (posts, reactions, reposts, follows, gestures they chose to send, praise, letters,
 * notices), and a handle, a bio or picture, an upload, an owner link either way, an agent link, an
 * X account, a block, a report, a pat, an admire, or saying they're going to an event. A record
 * in here is never retired.
 */
export function socialUsers(sql: SqlExec): Set<string> {
  const used = socialActors(sql);
  const rows = sql.exec(
    `SELECT resident_id AS id FROM handles
     UNION SELECT resident_id FROM profiles
       WHERE bio != '' OR COALESCE(avatar, '') != '' OR COALESCE(banner, '') != ''
     UNION SELECT owner FROM media
     UNION SELECT agent_id FROM owner_links
     UNION SELECT owner_id FROM owner_links
     UNION SELECT resident_id FROM agent_links
     UNION SELECT resident_id FROM x_links
     UNION SELECT blocker FROM blocks
     UNION SELECT reporter FROM reports
     UNION SELECT patter FROM pet_pats
     UNION SELECT admirer FROM plot_admires
     UNION SELECT resident_id FROM event_going`,
  );
  for (const row of rows) used.add(String(row.id));
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
