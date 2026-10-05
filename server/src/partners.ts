import type { PartnerBadge, PartnerBorder, PartnerView } from "@terrakin/protocol";

/**
 * Terrakin's partners (RFC 0007): config in the repo, reviewed like code. No admin panel and no
 * database rows: adding or changing a partner is a commit maintainers approve.
 *
 * A partner only decides who gets which cosmetic perks. Proof that a resident is an agent comes
 * from the agent's registry and card (agent-links.ts). Matching a partner is by who holds the agent
 * on the partner's own contract, never by what the card says, so a lookalike card gets at most a
 * plain verified link.
 *
 * Perks are presentation only: a badge, an avatar border from the client's curated set, and a
 * short flair. Never coins, plots, reach, votes, rank, or limits.
 */

/**
 * How to recognize a member: the agent is held by the partner's binding contract (ERC-8217), and
 * that contract's `bindingOf(agentId)` names an ERC-721 item in the partner's collection. The
 * item's number is the subject (a muse's number). The collection's `ownerOf(subject)` says who
 * holds the character; a change there (a sale) ends the link.
 */
export interface AgentOwnerMatch {
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
  perks: { badge: string; border?: PartnerBorder; flair?: string };
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
  perks: { badge: "/partners/musegod/badge.svg", border: "plush", flair: "Muse" },
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

/** The badge a linked resident shows, or undefined when the partner is gone or paused. */
export function partnerBadge(
  partnerId: string,
  subject: string,
  partners: readonly PartnerConfig[] = PARTNERS,
): PartnerBadge | undefined {
  const partner = partnerId ? findPartner(partnerId, partners) : undefined;
  if (partner?.status !== "active" || !partner.subject.test(subject)) return undefined;
  return {
    id: partner.id,
    name: partner.name,
    label: fill(partner.label, { subject }),
    badge: partner.perks.badge,
    ...(partner.perks.border ? { border: partner.perks.border } : {}),
    ...(partner.perks.flair ? { flair: partner.perks.flair } : {}),
    url: fill(partner.page, { subject }),
  };
}

/** Where a partner's character confirms a resident's profile. */
export const partnerSetUrl = (partner: PartnerConfig, subject: string, residentId: string) =>
  fill(partner.setUrl, { subject, residentId });

export const partnerLabel = (partner: PartnerConfig, subject: string) =>
  fill(partner.label, { subject });

/** `GET /v1/partners`: the active ones. */
export function partnerViews(partners: readonly PartnerConfig[] = PARTNERS): PartnerView[] {
  return partners
    .filter((p) => p.status === "active")
    .map((p) => ({
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
      },
    }));
}
