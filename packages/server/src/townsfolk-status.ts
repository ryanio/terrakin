import {
  REACTION_KEYS,
  type ReactionKey,
  type TownsfolkActivityResponse,
} from "@terrakin/protocol";
import { SUMMARY_DAYS } from "./ai-spend";
import type { ChatterService, Said } from "./chatter";
import type { SocialService } from "./social-service";
import type { TownsfolkTips } from "./townsfolk-tips";

/**
 * What staff see of the townsfolk runners: chatter's and tips' lines on the staff overview, and
 * `GET /v1/admin/townsfolk`. `Api` holds the runners and answers through these.
 */

/** The staff overview's tips line: the mode and the last run's counts. */
export function tipsStatus(tips: TownsfolkTips | undefined) {
  const last = tips?.lastRun() ?? null;
  return {
    mode: tips?.mode ?? ("off" as const),
    lastRun: last
      ? { at: new Date(last.at).toISOString(), day: last.day, mode: last.mode, ...last.result }
      : null,
  };
}

/** The staff overview's chatter line: settings, today's use, the last run, and dry-run drafts. */
export function chatterStatus(chatter: ChatterService | undefined) {
  const usage = chatter?.usage() ?? { calls: 0, tokens: 0, microUsd: 0 };
  const paused = chatter?.pausedUntil() ?? null;
  const last = chatter?.lastRun() ?? null;
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    mode: chatter?.mode ?? ("off" as const),
    gate: chatter?.config.gate ?? ("quiet" as const),
    perRun: chatter?.config.perRun ?? 0,
    model: chatter?.config.model ?? "",
    callsToday: usage.calls,
    callsPerDay: chatter?.config.callsPerDay ?? 0,
    tokensToday: usage.tokens,
    tokensPerDay: chatter?.config.tokensPerDay ?? 0,
    microUsdToday: usage.microUsd,
    microUsdPerDay: chatter?.config.microUsdPerDay ?? 0,
    pausedUntil: paused === null ? null : iso(paused),
    lastRun: last ? { at: iso(last.at), result: last.result } : null,
    participation: chatter?.participation(SUMMARY_DAYS) ?? {
      notes: 0,
      answered: 0,
      replies: 0,
      reactions: 0,
    },
    drafts: (chatter?.drafts() ?? []).map((d) => ({ ...d, at: iso(d.at) })),
  };
}

/**
 * What the townsfolk are doing, for `GET /v1/admin/townsfolk`: chatter's settings and today's use,
 * each townsfolk resident's day, the latest things they did with the posts and residents they
 * touched, and the last coin tips.
 */
export function townsfolkActivity(
  social: SocialService,
  chatter: ChatterService | undefined,
  tips: TownsfolkTips | undefined,
): TownsfolkActivityResponse {
  const status = chatterStatus(chatter);
  const iso = (ms: number) => new Date(ms).toISOString();
  const log = chatter?.activity() ?? [];
  const lastAt = new Map<string, number>();
  for (const e of log) if (!lastAt.has(e.residentId)) lastAt.set(e.residentId, e.at);
  const postOf = (id: string) => {
    const post = id ? social.post(id) : undefined;
    return post ? { id: post.id, author: post.author, text: post.text.slice(0, 280) } : null;
  };
  const reactions: readonly string[] = REACTION_KEYS;
  const reactionOf = (key: string) => (reactions.includes(key) ? (key as ReactionKey) : null);
  const said = (s: Said) => ({
    model: s.model,
    action: s.action,
    outcome: s.outcome,
    text: s.text,
    post: postOf(s.postId),
    resident: s.residentId ? (social.authorView(s.residentId) ?? null) : null,
    reaction: reactionOf(s.reaction),
  });
  return {
    chatter: {
      mode: status.mode,
      gate: status.gate,
      perRun: status.perRun,
      model: status.model,
      callsToday: status.callsToday,
      callsPerDay: status.callsPerDay,
      microUsdToday: status.microUsdToday,
      microUsdPerDay: status.microUsdPerDay,
      compare: chatter?.config.compare ?? 0,
      comparedToday: chatter?.comparedToday() ?? 0,
      mentions: chatter?.answersMentions ?? false,
      pausedUntil: status.pausedUntil,
      lastRun: status.lastRun,
      participation: status.participation,
    },
    tips: tipsStatus(tips),
    townsfolk: (chatter?.roster() ?? []).flatMap((id) => {
      const resident = social.authorView(id);
      if (!resident || !chatter) return [];
      const at = lastAt.get(id);
      return [
        { resident, today: chatter.doneToday(id), lastAt: at === undefined ? null : iso(at) },
      ];
    }),
    activity: log.flatMap((e) => {
      const by = social.authorView(e.residentId);
      if (!by) return [];
      return [
        {
          at: iso(e.at),
          by,
          action: e.action,
          live: e.live,
          text: e.text,
          post: postOf(e.postId),
          resident: e.targetId ? (social.authorView(e.targetId) ?? null) : null,
          reaction: reactionOf(e.reaction),
          mention: e.mention,
        },
      ];
    }),
    compare: (chatter?.comparisons() ?? []).flatMap((c) => {
      const by = social.authorView(c.residentId);
      if (!by) return [];
      return [{ at: iso(c.at), by, kind: c.kind, first: said(c.first), second: said(c.second) }];
    }),
  };
}
