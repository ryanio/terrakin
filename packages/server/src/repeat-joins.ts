import { socialActors } from "./newcomers";
import { idsFrom, type SqlExec } from "./sql-store";

/**
 * The social side of clearing the old repeat joins (issue #46): retiring unused ones (decision
 * 0230) and merging used ones into the record that stays (decision 0239). The world picks the
 * records to retire (`WorldService.repeatJoinsToRetire`), a maintainer names the ones to merge, and
 * the sim takes them out; these read, move, and clear the social tables, which the sim can't see.
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

/**
 * Move what a merged record held socially to the record that stays (decision 0239): its posts, its
 * reactions and reposts (never one on a post that's now the kept record's own), its follows either
 * way (never a follow of itself), its blocks either way, so nobody who blocked the duplicate sees
 * the kept record, and its agent link, X account, and handle when the kept record has none (the
 * duplicate's goes otherwise; its handle is released). `forgetRetired` clears what's left. Uploads
 * stay the duplicate's, so a letter's private picture never changes hands; the posts that show them
 * keep them. Running it again changes nothing.
 */
export function moveMerged(sql: SqlExec, from: string, into: string, now: number) {
  const own = "SELECT id FROM posts WHERE author = ?";
  for (const [statement, ...binds] of [
    ["UPDATE posts SET author = ? WHERE author = ?", into, from],
    [`DELETE FROM reactions WHERE resident_id = ? AND post_id IN (${own})`, from, into],
    ["UPDATE OR IGNORE reactions SET resident_id = ? WHERE resident_id = ?", into, from],
    ["DELETE FROM reactions WHERE resident_id = ?", from],
    [`DELETE FROM reposts WHERE resident_id = ? AND post_id IN (${own})`, from, into],
    ["UPDATE OR IGNORE reposts SET resident_id = ? WHERE resident_id = ?", into, from],
    ["DELETE FROM reposts WHERE resident_id = ?", from],
    [
      "INSERT OR IGNORE INTO follows (follower, followee) SELECT ?, followee FROM follows WHERE follower = ? AND followee != ?",
      into,
      from,
      into,
    ],
    [
      "INSERT OR IGNORE INTO follows (follower, followee) SELECT follower, ? FROM follows WHERE followee = ? AND follower != ?",
      into,
      from,
      into,
    ],
    [
      "INSERT OR IGNORE INTO blocks (blocker, blocked) SELECT ?, blocked FROM blocks WHERE blocker = ? AND blocked != ?",
      into,
      from,
      into,
    ],
    [
      "INSERT OR IGNORE INTO blocks (blocker, blocked) SELECT blocker, ? FROM blocks WHERE blocked = ? AND blocker != ?",
      into,
      from,
      into,
    ],
    ["UPDATE OR IGNORE agent_links SET resident_id = ? WHERE resident_id = ?", into, from],
    ["DELETE FROM agent_links WHERE resident_id = ?", from],
    ["DELETE FROM agent_link_asks WHERE resident_id = ?", from],
    ["UPDATE OR IGNORE x_links SET resident_id = ? WHERE resident_id = ?", into, from],
    ["DELETE FROM x_links WHERE resident_id = ?", from],
    [
      `UPDATE handles SET resident_id = ? WHERE resident_id = ? AND released_at = 0
        AND NOT EXISTS (SELECT 1 FROM handles WHERE resident_id = ? AND released_at = 0)`,
      into,
      from,
      into,
    ],
    ["UPDATE handles SET released_at = ? WHERE resident_id = ? AND released_at = 0", now, from],
  ] as const) {
    sql.exec(statement, ...binds);
  }
}
