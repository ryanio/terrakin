import { JOIN_LIMITS } from "@terrakin/protocol";
import type { ResidentKind } from "@terrakin/sim";
import { RateLimiter } from "./rate-limit";
import { count, gauge } from "./telemetry";

/** Which share of the ceiling a join took: everyone's, or the vouched-for invites' own. */
export type JoinShare = "all" | "invited";

/** What a join turned away by the ceiling answers, on every door. */
export function joinsFullMessage(retryAfter: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  const wait = minutes === 1 ? "1 minute" : `${minutes} minutes`;
  return `A lot of people are moving in right now. Try again in ${wait}. You can keep looking around.`;
}

/**
 * The world-wide ceiling on new residents (RFC 0055): one token bucket every join shares, and a
 * smaller one for invites a settled resident vouches for. It is one more limit beside the per-IP
 * `sessions` bucket, which stays as it is, and it lives in memory like that one: on the Worker the
 * one World object holds it, so it covers the whole world, and an object that restarts starts full.
 *
 * `perHour` raises the main share for a test server whose browsers all join from one place; the
 * invited share keeps its own numbers.
 */
export class JoinCeiling {
  private readonly shares: Record<JoinShare, RateLimiter>;
  /** Refusals since the share last let a join through, for the `world.joins_full` gauge. */
  private readonly refused: Record<JoinShare, number> = { all: 0, invited: 0 };

  constructor(now: () => number, perHour?: number) {
    const all =
      perHour === undefined
        ? JOIN_LIMITS.all
        : {
            perSecond: perHour / 3600,
            burst: Math.max(JOIN_LIMITS.all.burst, Math.floor(perHour)),
          };
    this.shares = {
      all: new RateLimiter(all.burst, all.perSecond, now),
      invited: new RateLimiter(JOIN_LIMITS.invited.burst, JOIN_LIMITS.invited.perSecond, now),
    };
  }

  /**
   * Spend one join from `share`. Undefined when it may go ahead; otherwise the seconds until the
   * share has room again. Each refusal reports how many in a row the share has turned away, counts
   * only, so the first one is heard.
   */
  take(share: JoinShare): number | undefined {
    const took = this.shares[share].takeInfo();
    if (took.allowed) {
      this.refused[share] = 0;
      return undefined;
    }
    this.refused[share] += 1;
    gauge("world.joins_full", this.refused[share], { share });
    return took.retryAfter;
  }

  /**
   * A join went through: counted by kind and share, so a metrics query reads joins an hour with
   * people and agents apart. A counter rather than an hourly gauge, since the World object can be
   * put away between joins and would lose an hour kept in memory.
   */
  joined(kind: ResidentKind, share: JoinShare) {
    count("world.joins", { kind, share });
  }
}
