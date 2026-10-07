import {
  ARCHIVE_DEFAULT_LIMIT,
  ARCHIVE_MAX_LIMIT,
  type ArchiveResponse,
  type AuthorView,
  type ProposalResponse,
  type ProposalView,
  TOWN_VIEW_LIMITS,
  type TownResponse,
} from "@terrakin/protocol";
import {
  findProposal,
  type Proposal,
  quorum,
  tally,
  townEligibility,
  townHallTiles,
  votesCast,
  type WorldState,
} from "@terrakin/sim";
import { treasuryView } from "./coins";
import { boardEvents } from "./events";
import { townShopView } from "./shop";
import type { SocialService } from "./social-service";
import { DAY_MS } from "./world-service";

/**
 * The Town Hall's read side (RFC 0004): views built from the world (proposals, votes, who may take
 * part) and the social tables (author faces, the notice board, petition answers). Every rule lives
 * in the sim; this only describes what the sim decided.
 */

const iso = (day: number) => new Date(day * DAY_MS).toISOString();

/** Someone the world knows but the social layer can't describe. Shouldn't happen; never throws. */
export const unknownAuthor = (id: string): AuthorView => ({
  id,
  name: "Unknown",
  kind: "human",
  color: "sand",
  shape: "round",
  avatar: null,
});

const FINAL = new Set(["passed", "failed", "no_quorum", "withdrawn", "voided"]);

const number = (id: string) => Number(/^t_(\d+)$/.exec(id)?.[1] ?? Number.NaN);

function proposalView(
  state: WorldState,
  social: SocialService,
  p: Proposal,
  viewer?: string,
): ProposalView {
  const voters = p.electorate?.length ?? 0;
  const voided = p.status === "voided";
  return {
    id: p.id,
    trust: "untrusted",
    kind: p.kind,
    status: p.status,
    // A voided proposal's words stay in the log, but nobody has to read them here again.
    title: voided ? "Removed by a maintainer" : p.title,
    text: voided ? "" : p.text,
    author: social.authorView(p.author) ?? unknownAuthor(p.author),
    blocks: voided ? [] : (p.blocks ?? []).map((b) => ({ ...b })),
    remove: voided ? [] : (p.remove ?? []).map((t) => ({ ...t })),
    ground: voided ? [] : (p.ground ?? []).map((g) => ({ ...g })),
    lift: voided ? [] : (p.lift ?? []).map((t) => ({ ...t })),
    ...(p.amount === undefined ? {} : { amount: p.amount }),
    ...(p.to === undefined ? {} : { to: social.authorView(p.to) ?? unknownAuthor(p.to) }),
    filedDay: p.filedDay,
    openedDay: p.openedDay ?? null,
    closesAt: p.status === "open" && p.closesDay !== undefined ? iso(p.closesDay) : null,
    closedDay: p.closedDay ?? null,
    tally: { ...tally(p), electorate: voters, quorum: quorum(voters) },
    yourVote: viewer ? (p.votes[viewer] ?? null) : null,
    canVote:
      viewer !== undefined &&
      p.status === "open" &&
      (p.electorate?.includes(viewer) ?? false) &&
      !(state.townsfolk?.includes(viewer) ?? false),
    answer: p.kind === "advisory" && p.status === "passed" ? social.petitionAnswer(p.id) : null,
  };
}

export function townView(state: WorldState, social: SocialService, viewer?: string): TownResponse {
  const proposals = state.town?.proposals ?? [];
  const open = proposals.filter((p) => p.status === "open");
  const closes = open.flatMap((p) => (p.closesDay === undefined ? [] : [p.closesDay]));
  const you = (id: string) => {
    const e = townEligibility(state, id);
    return {
      residentId: id,
      eligible: e.eligible,
      reason: e.eligible ? null : e.reason,
      message: e.eligible ? null : e.message,
      maintainer: social.isMaintainer(id),
      votes: votesCast(state, id),
    };
  };
  return {
    day: state.day ?? null,
    open: open.map((p) => proposalView(state, social, p, viewer)),
    queued: proposals
      .filter((p) => p.status === "queued")
      .map((p) => proposalView(state, social, p, viewer)),
    board: social.board(viewer),
    you: viewer && state.residents[viewer] ? you(viewer) : null,
    nextClose: closes.length > 0 ? iso(Math.min(...closes)) : null,
    hall: townHallTiles(state.config),
    limits: { ...TOWN_VIEW_LIMITS },
    treasury: treasuryView(state, (id) => social.authorView(id)),
    shop: townShopView(state),
    events: boardEvents(state, social.eventContext(viewer), viewer),
  };
}

export function proposalDetail(
  state: WorldState,
  social: SocialService,
  id: string,
  viewer?: string,
): ProposalResponse | undefined {
  const p = findProposal(state, id);
  if (!p) return undefined;
  return {
    proposal: proposalView(state, social, p, viewer),
    roll: Object.entries(p.votes)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([resident, choice]) => ({
        resident: social.authorView(resident) ?? unknownAuthor(resident),
        choice,
      })),
  };
}

/** Finished proposals, newest first. `before` is the `next` cursor from the previous page. */
export function archiveView(
  state: WorldState,
  social: SocialService,
  options: { limit?: number | undefined; before?: string | undefined },
  viewer?: string,
): ArchiveResponse {
  const asked = Math.floor(Number(options.limit));
  const limit = Number.isFinite(asked)
    ? Math.max(1, Math.min(ARCHIVE_MAX_LIMIT, asked))
    : ARCHIVE_DEFAULT_LIMIT;
  const before = Number.parseInt(options.before ?? "", 10);
  const done = (state.town?.proposals ?? [])
    .filter((p) => FINAL.has(p.status))
    .filter((p) => !Number.isFinite(before) || number(p.id) < before)
    .sort((a, b) => number(b.id) - number(a.id));
  const page = done.slice(0, limit);
  const last = page.at(-1);
  return {
    proposals: page.map((p) => proposalView(state, social, p, viewer)),
    next: done.length > limit && last ? String(number(last.id)) : null,
  };
}
