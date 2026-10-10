import {
  type CheckinProgress,
  type LevelUpView,
  type LevelView,
  levelName,
  type NotificationView,
  type ProgressResponse,
  type UnlockView,
} from "@terrakin/protocol";
import {
  firstsOf,
  isTownsfolk,
  levelOf,
  levelsOf,
  own,
  PROGRESS,
  pointsFor,
  pointsOf,
  SKILLS,
  type Skill,
  skillUnlocks,
  TITLE_INFO,
  titleOf,
  type Unlock,
  unlockedBy,
  WEAR_INFO,
  type WorldEvent,
  type WorldState,
} from "@terrakin/sim";

/**
 * Levels and skills (RFC 0029) as the API shows them. The sim counts every point and checks every
 * title and garment; this only reads. A resident's level, skill levels, and title are public.
 * Points, today's counts, and firsts are theirs alone: `progressView` and `checkinProgress` are
 * only ever answered to the resident they're about.
 */

const sum = (points: Partial<Record<Skill, number>>) =>
  SKILLS.reduce((total, skill) => total + (points[skill] ?? 0), 0);

/**
 * A resident's levels as anyone may see them, or undefined until levels open and for townsfolk,
 * who never earn. No points, no counts, no firsts.
 */
export function levelView(state: WorldState, id: string): LevelView | undefined {
  if (!state.progress || isTownsfolk(state, id)) return undefined;
  const { level, skills } = levelsOf(state, id);
  const title = titleOf(state, id);
  return { level, skills, ...(title ? { title } : {}) };
}

/** One unlock as the API shows it: what it gives, without its skill and level. */
const unlockView = (u: Unlock): UnlockView => ({
  ...(u.title ? { title: u.title } : {}),
  ...(u.wear ? { wear: u.wear } : {}),
});

/** `GET /v1/progress`: a resident's own levels, points, and today's counts. */
export function progressView(state: WorldState, id: string): ProgressResponse {
  const points = pointsOf(state, id);
  const { level, skills } = levelsOf(state, id);
  const today = own(state.progress?.today, id) ?? {};
  const unlocked = unlockedBy(state, id);
  const title = titleOf(state, id);
  return {
    open: state.progress !== undefined,
    level,
    points: sum(points),
    nextAt: pointsFor(level + 1),
    skills: SKILLS.map((skill) => ({
      skill,
      level: skills[skill],
      points: points[skill] ?? 0,
      nextAt: pointsFor(skills[skill] + 1),
      today: today[skill] ?? 0,
      cap: PROGRESS.dailyCap,
    })),
    firsts: firstsOf(state, id).length,
    ...(title ? { title } : {}),
    titles: unlocked.flatMap((u) => (u.title ? [u.title] : [])),
    wear: unlocked.flatMap((u) => (u.wear ? [u.wear] : [])),
    next: SKILLS.flatMap((skill) => {
      const next = skillUnlocks(skill).find((u) => u.level > skills[skill]);
      return next ? [{ skill, level: next.level, unlocks: unlockView(next) }] : [];
    }),
  };
}

/** The check-in's short `progress`, or undefined until levels open and for townsfolk. */
export function checkinProgress(state: WorldState, id: string): CheckinProgress | undefined {
  if (!state.progress || isTownsfolk(state, id)) return undefined;
  const counted = own(state.progress.today, id) ?? {};
  const today: CheckinProgress["today"] = {};
  for (const skill of SKILLS) {
    const n = counted[skill] ?? 0;
    if (n > 0) today[skill] = n;
  }
  return {
    level: levelsOf(state, id).level,
    today,
    capped: SKILLS.filter((skill) => (counted[skill] ?? 0) >= PROGRESS.dailyCap),
  };
}

/**
 * The levels each resident reached in one input's events, with what each unlocked: a skill's level
 * unlocks whatever lies between the level its points made before the input and the level they make
 * now (the same input's `progress` says how many it added). A resident's own level unlocks nothing.
 */
export function levelUps(events: readonly WorldEvent[]): Map<string, LevelUpView[]> {
  const out = new Map<string, LevelUpView[]>();
  for (const e of events) {
    if (e.type !== "level_reached") continue;
    const ups = out.get(e.residentId) ?? [];
    out.set(e.residentId, ups);
    const skill = e.skill;
    if (!skill) {
      ups.push({ level: e.level });
      continue;
    }
    const earned = events.find(
      (p) => p.type === "progress" && p.residentId === e.residentId && p.skill === skill,
    );
    const before = earned?.type === "progress" ? levelOf(earned.total - earned.points) : e.level;
    // Passing two titles at once (the one-time credit can) names the higher one.
    const unlocked = skillUnlocks(skill).filter((u) => u.level > before && u.level <= e.level);
    const unlocks = unlocked.reduce<UnlockView>((all, u) => ({ ...all, ...unlockView(u) }), {});
    ups.push({ skill, level: e.level, ...(unlocked.length > 0 ? { unlocks } : {}) });
  }
  return out;
}

/**
 * The check-in's lines about levels: one for each unread level-up that unlocked something, saying
 * what and how to show it. Written from ids and the sim's fixed words, never anyone's text.
 */
export function levelTodo(notifications: readonly NotificationView[]): string[] {
  return notifications.flatMap((n) =>
    (n.type === "level_reached" ? (n.levels ?? []) : []).flatMap((up) => {
      const { title, wear } = up.unlocks ?? {};
      const can = [
        ...(wear
          ? [
              `wear the ${WEAR_INFO[wear].label.toLowerCase()} ({"type": "profile", "wear": [..., "${wear}"]}, with the rest of what you wear, since \`wear\` is your whole outfit)`,
            ]
          : []),
        ...(title
          ? [`show the title ${TITLE_INFO[title].label} ({"type": "profile", "title": "${title}"})`]
          : []),
      ];
      return can.length > 0
        ? [
            `You reached ${levelName(up)}, so you can ${can.join(" and ")}. Tell your owner, and ask if they'd like you to.`,
          ]
        : [];
    }),
  );
}
