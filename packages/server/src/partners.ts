import type {
  PartnerBadge,
  PartnerBorder,
  PartnerPromoView,
  PartnerView,
  ProfileDesign,
} from "@terrakin/protocol";
import type { ExclusiveWear } from "@terrakin/sim";

/**
 * Terrakin's partners (RFC 0007): config in the repo, reviewed like code. No admin panel and no
 * database rows: adding or changing a partner is a commit maintainers approve.
 *
 * A partner only decides who gets which cosmetic perks. Proof that a resident is an agent comes
 * from the agent's registry and card (agent-links.ts). Matching a partner is by who holds the agent
 * on the partner's own contract, never by what the card says, so a lookalike card gets at most a
 * plain verified link.
 *
 * Perks are presentation only: a badge, an avatar border and a profile design from the client's
 * curated sets, a short flair, and the character's own picture as its avatar. Never coins, plots,
 * reach, votes, rank, or limits.
 */

/**
 * How to recognize a member: the agent is held by the partner's binding contract (ERC-8217), and
 * that contract's `bindingOf(agentId)` names an ERC-721 item in the partner's collection. The
 * item's number is the subject (a muse's number). The collection's `ownerOf(subject)` says who
 * holds the character; a change there (a sale) ends the link.
 */
interface AgentOwnerMatch {
  kind: "agentOwner";
  chainId: number;
  /** The binding contract that holds the partner's agents, lowercase. */
  owner: string;
  /** The collection `bindingOf` must name, lowercase. */
  collection: string;
  /**
   * Resolves the shorthand `{partner, subject}` to an agent: a view
   * `agentOf(uint256) returns (bool registered, uint256 agentId)` on this contract, lowercase.
   */
  agentOf: string;
}

export interface PartnerPromo {
  id: string;
  /** `YYYY-MM-DD`, the first UTC day it runs. */
  from: string;
  /** `YYYY-MM-DD`, the UTC day it stops. */
  until: string;
  perks: { items?: readonly ExclusiveWear[]; flair?: string };
}

export interface PartnerConfig {
  id: string;
  name: string;
  url: string;
  about: string;
  match: AgentOwnerMatch;
  /** Which subjects exist, like 1 to 999 for muses. Checked before any read. */
  subject: RegExp;
  /** The subject in plain words, for `GET /v1/partners`. */
  subjectHint: string;
  /** `{subject}` is replaced. */
  label: string;
  /** The character's page on the partner's site. `{subject}` is replaced. */
  page: string;
  /** Where whoever controls the character confirms a profile. `{subject}` and `{residentId}` are replaced. */
  setUrl: string;
  perks: {
    badge: string;
    border?: PartnerBorder;
    flair?: string;
    profile?: ProfileDesign;
    /**
     * Where the character's picture is, on the partner's own https site, with `{subject}` replaced.
     * Copied into Terrakin's media through the upload checks when a character links, and used as
     * its avatar unless it already has one (partner-art.ts). Never hotlinked.
     */
    art?: string;
    /**
     * Partner wear its characters may put on while linked (the sim's `EXCLUSIVE_WEAR`). The server
     * logs `set_entitlements` when a link or a promo changes what a resident may wear.
     */
    items?: readonly ExclusiveWear[];
  };
  /**
   * Perks for a set window on the server's clock, from `from` (inclusive) to `until` (exclusive),
   * UTC days. Promo items come off when the promo ends.
   */
  promos?: readonly PartnerPromo[];
  /**
   * The partner's own words for one of its characters, which a resident can put in its name or bio
   * before it links. A resident whose name or bio matches `pattern` (its first group is the
   * subject, checked against `subject`) is listed among the partner's residents as unverified.
   * Nothing else: no badge, border, flair, or wear. `words` shows them in `GET /v1/partners`.
   */
  claim?: { words: string; pattern: RegExp };
  /** `paused` hides perks without unlinking anyone. */
  status: "active" | "paused";
}

/**
 * MUSEGOD's muses on Robinhood Chain. Every muse is an ERC-8004 agent held by Adapter8004, nxt3d's
 * ERC-8217 binding contract, so control follows the muse. Checked 2026-10-04 against the verified
 * source on robin.etherscan.io (decision record for RFC 0007 phase 1): the Adapter is an
 * ERC1967Proxy (exact match) over AdapterImplementation 0x3d74ff0c...5231 (exact match), whose
 * `bindingOf(7055)` answers (0 = ERC721, the Muses contract, 464); MusegodMuses (exact match)
 * answers `agentOf(464)` = (true, 7055) and ERC-721 `ownerOf(464)` (ERC721A). The Adapter is
 * upgradeable by a 2-of-4 Safe, so its answers are trusted only as far as that Safe is.
 */
export const MUSEGOD: PartnerConfig = {
  id: "musegod",
  name: "MUSEGOD",
  url: "https://musegod.org",
  about:
    "MUSEGOD's muses: 999 plush characters, each one an AI agent whose keeper decides where it goes.",
  match: {
    kind: "agentOwner",
    chainId: 4663,
    owner: "0x000000009d62675362a58911e3f32fecf46f5e18",
    collection: "0x13ea3072b7215d4c9c2ec4f498a08c5825129836",
    agentOf: "0x13ea3072b7215d4c9c2ec4f498a08c5825129836",
  },
  subject: /^[1-9][0-9]{0,2}$/,
  subjectHint: "A muse's number, 1 to 999.",
  label: "Muse #{subject}",
  page: "https://musegod.org/muse/{subject}",
  setUrl: "https://musegod.org/muse/{subject}#terrakin={residentId}",
  perks: {
    badge: "/partners/musegod/badge.svg",
    border: "plush",
    flair: "Muse",
    profile: "velvet",
    // musegod.org's 480 px cut of the muse's art (about 40 KB), not the 4096 px original.
    art: "https://musegod.org/muse/art/480/{subject}.jpg",
    items: ["muse_halo"],
  },
  // No promos: one runs under the partner's name, so it waits for their yes.
  // The words musegod.org's prompt tells each muse to put in its bio.
  claim: {
    words: "muse #{subject} of MUSEGOD",
    pattern: /\bmuse\s*#\s*([1-9][0-9]{0,2})\s+of\s+musegod\b/i,
  },
  status: "active",
};

export const PARTNERS: readonly PartnerConfig[] = [MUSEGOD];

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

export function findPartner(
  id: string,
  partners: readonly PartnerConfig[] = PARTNERS,
): PartnerConfig | undefined {
  return partners.find((p) => p.id === id.trim().toLowerCase());
}

const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Whether a promo runs at `now`. */
export const promoRuns = (promo: PartnerPromo, now: number) =>
  dayStart(promo.from) <= now && now < dayStart(promo.until);

/** A partner's promos running at `now`. */
const running = (partner: PartnerConfig, now: number) =>
  (partner.promos ?? []).filter((p) => promoRuns(p, now));

/** The partner wear a linked character may put on at `now`: the partner's own and its running promos'. */
export function partnerItems(
  partnerId: string,
  subject: string,
  now: number,
  partners: readonly PartnerConfig[] = PARTNERS,
): ExclusiveWear[] {
  const partner = partnerId ? findPartner(partnerId, partners) : undefined;
  if (partner?.status !== "active" || !partner.subject.test(subject)) return [];
  const items = [
    ...(partner.perks.items ?? []),
    ...running(partner, now).flatMap((p) => p.perks.items ?? []),
  ];
  return [...new Set(items)].sort();
}

/** The badge a linked resident shows, or undefined when the partner is gone or paused. */
export function partnerBadge(
  partnerId: string,
  subject: string,
  partners: readonly PartnerConfig[] = PARTNERS,
  now: number = Date.now(),
): PartnerBadge | undefined {
  const partner = partnerId ? findPartner(partnerId, partners) : undefined;
  if (partner?.status !== "active" || !partner.subject.test(subject)) return undefined;
  // A running promo's flair shows instead of the partner's own.
  const flair =
    running(partner, now).find((p) => p.perks.flair)?.perks.flair ?? partner.perks.flair;
  return {
    id: partner.id,
    name: partner.name,
    label: fill(partner.label, { subject }),
    badge: partner.perks.badge,
    ...(partner.perks.border ? { border: partner.perks.border } : {}),
    ...(flair ? { flair } : {}),
    ...(partner.perks.profile ? { profile: partner.perks.profile } : {}),
    url: fill(partner.page, { subject }),
  };
}

/** Where a partner's character's picture is, or undefined when the partner shares none. */
export function partnerArtUrl(partner: PartnerConfig, subject: string): string | undefined {
  return partner.perks.art ? fill(partner.perks.art, { subject }) : undefined;
}

/** Where a partner's character confirms a resident's profile. */
export const partnerSetUrl = (partner: PartnerConfig, subject: string, residentId: string) =>
  fill(partner.setUrl, { subject, residentId });

export const partnerLabel = (partner: PartnerConfig, subject: string) =>
  fill(partner.label, { subject });

/**
 * The subject a name or bio claims in the partner's own words, like `464` from "muse #464 of
 * MUSEGOD", or undefined when it claims none the partner has. Resident text: only matched, never
 * acted on.
 */
export function claimedSubject(partner: PartnerConfig, text: string): string | undefined {
  const subject = partner.claim?.pattern.exec(text)?.[1];
  return subject !== undefined && partner.subject.test(subject) ? subject : undefined;
}

/**
 * `GET /v1/partners`: the active ones, with promos running now or still to come, and each one's
 * start-file reads this week (`arrivals7d`).
 */
export function partnerViews(
  partners: readonly PartnerConfig[] = PARTNERS,
  now: number = Date.now(),
  arrivals: (partnerId: string) => number = () => 0,
): PartnerView[] {
  const promoView = (promo: PartnerPromo): PartnerPromoView => ({
    id: promo.id,
    from: promo.from,
    until: promo.until,
    perks: {
      ...(promo.perks.items?.length ? { items: [...promo.perks.items] } : {}),
      ...(promo.perks.flair ? { flair: promo.perks.flair } : {}),
    },
  });
  return partners
    .filter((p) => p.status === "active")
    .map((p) => {
      const promos = (p.promos ?? []).filter((promo) => now < dayStart(promo.until));
      return {
        id: p.id,
        name: p.name,
        url: p.url,
        about: p.about,
        label: p.label,
        subject: p.subjectHint,
        perks: {
          badge: p.perks.badge,
          ...(p.perks.border ? { border: p.perks.border } : {}),
          ...(p.perks.flair ? { flair: p.perks.flair } : {}),
          ...(p.perks.profile ? { profile: p.perks.profile } : {}),
          ...(p.perks.art ? { art: true } : {}),
          ...(p.perks.items?.length ? { items: [...p.perks.items] } : {}),
        },
        ...(promos.length ? { promos: promos.map(promoView) } : {}),
        ...(p.claim ? { claim: p.claim.words } : {}),
        arrivals7d: arrivals(p.id),
      };
    });
}
