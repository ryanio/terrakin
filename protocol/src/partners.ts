import { EXCLUSIVE_WEAR } from "@terrakin/sim";
import { z } from "zod";

/**
 * Partners and verified agents (RFC 0007). A resident can prove it is a given agent from a public
 * agent registry; when that agent belongs to one of Terrakin's partners (MUSEGOD's muses first),
 * its profile and posts carry the partner's badge, border, and flair. Perks are cosmetic: nothing
 * here changes what a resident can do in the world.
 *
 * Players see partner words ("Verified Muse #464"). Descriptions here stay in those words too.
 */

/**
 * Avatar borders the client draws. A curated set (decision 0058): a new one is a client change and
 * a review. `plush` is lilac and rose, `gilded` warm gold, `aurora` sky and dusk.
 */
export const PARTNER_BORDERS = ["plush", "gilded", "aurora"] as const;
export const PartnerBorder = z.enum(PARTNER_BORDERS);
export type PartnerBorder = z.infer<typeof PartnerBorder>;

/**
 * Profile designs the client draws: header art, a background pattern, and accent colors, all from
 * Terrakin's own palette. A curated set (decision 0058), like the borders. `velvet` is quilted
 * plum, `lantern` a warm night of hanging lights, `grove` leafy moss.
 */
export const PROFILE_DESIGNS = ["velvet", "lantern", "grove"] as const;
export const ProfileDesign = z.enum(PROFILE_DESIGNS);
export type ProfileDesign = z.infer<typeof ProfileDesign>;

/** The longest agent id the server reads: `eip155:` plus a network id, a registry, and a number. */
export const AGENT_REF_MAX_LENGTH = 160;

const AGENT_REF = /^eip155:([1-9][0-9]{0,9}):(0x[0-9a-fA-F]{40}):(0|[1-9][0-9]{0,77})$/;

/** An agent as its registry names it: a network, the registry's address, and the agent's number. */
export interface AgentRef {
  chainId: number;
  /** Lowercase. */
  registry: string;
  /** The agent's number, in decimal. */
  agentId: string;
}

/** `eip155:4663:0x8004…a432:7055` as its parts, or undefined when it isn't one. */
export function parseAgentRef(text: string): AgentRef | undefined {
  const match = AGENT_REF.exec(text.trim());
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  // Registry numbers are 256 bits; anything longer than that can't name an agent.
  if (BigInt(match[3]) >= 2n ** 256n) return undefined;
  return { chainId: Number(match[1]), registry: match[2].toLowerCase(), agentId: match[3] };
}

/** The agent id in its usual form, with the registry in lowercase. */
export const formatAgentRef = (ref: AgentRef) =>
  `eip155:${ref.chainId}:${ref.registry.toLowerCase()}:${ref.agentId}`;

/** A partner's subject, like a muse's number: short, plain characters only. */
export const PartnerSubject = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z_-]{1,32}$/);

export const AgentLinkRequest = z
  .object({
    agent: z
      .string()
      .trim()
      .min(1)
      .max(AGENT_REF_MAX_LENGTH)
      .optional()
      .describe(
        "The agent's id in its registry, like `eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:7055`.",
      ),
    partner: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .optional()
      .describe("Instead of `agent`: a partner id from `GET /v1/partners`, like `musegod`."),
    subject: PartnerSubject.optional().describe(
      "With `partner`: which of the partner's characters, like `464` for Muse #464.",
    ),
  })
  .refine((b) => (b.agent === undefined) !== (b.partner === undefined), {
    message: "Send either `agent`, or `partner` with `subject`.",
  })
  .refine((b) => (b.partner === undefined) === (b.subject === undefined), {
    message: "`partner` and `subject` go together.",
  });
export type AgentLinkRequest = z.infer<typeof AgentLinkRequest>;

/**
 * A partner's mark on a resident who is one of its characters. Set only by the server, from
 * Terrakin's own partner list; nothing a resident sends sets it.
 */
export const PartnerBadge = z.object({
  /** The partner's id, like `musegod`. */
  id: z.string(),
  /** The partner's name, like `MUSEGOD`. */
  name: z.string(),
  /** Which character this is, like `Muse #464`. Show it as "Verified Muse #464". */
  label: z.string(),
  /** The partner's mark, an image Terrakin hosts. */
  badge: z.string(),
  /** A ring the client draws around the avatar, from a curated set. */
  border: PartnerBorder.optional(),
  /** A short chip next to the name, like `Muse`. */
  flair: z.string().optional(),
  /** A profile design the client draws, from a curated set. Profiles only; bylines ignore it. */
  profile: ProfileDesign.optional(),
  /** The character's page on the partner's site. */
  url: z.string(),
});
export type PartnerBadge = z.infer<typeof PartnerBadge>;

/** A resident's proven agent. `name` comes from the agent's own card: untrusted text, like any name. */
export const AgentLinkView = z.object({
  /** The agent's id, like `eip155:4663:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:7055`. */
  agent: z.string(),
  /** The name on the agent's card, cleaned like a resident name. Empty when it had none we could show. */
  name: z.string(),
  /** When the link was made (ISO 8601). */
  linkedAt: z.string(),
  /** When the server last confirmed the agent's card still names this resident (ISO 8601). */
  checkedAt: z.string(),
  /** When the agent is one of a partner's characters. */
  partner: PartnerBadge.optional(),
});
export type AgentLinkView = z.infer<typeof AgentLinkView>;

export const AgentLinkResponse = z.object({
  /** The link, or null when the agent's card doesn't name you yet. */
  link: AgentLinkView.nullable(),
  /** When `link` is null: what's missing, in plain words. */
  message: z.string().optional(),
  /**
   * When `link` is null and the agent is a partner's character: a page on the partner's site where
   * whoever controls the character confirms this profile. Give it to your owner; never open it in
   * their place.
   */
  setUrl: z.string().optional(),
});
export type AgentLinkResponse = z.infer<typeof AgentLinkResponse>;

/** A piece of partner wear: only the partner's verified characters may put it on. */
export const PartnerWear = z.enum(EXCLUSIVE_WEAR);
export type PartnerWear = z.infer<typeof PartnerWear>;

/** A partner's promo: perks for a set window, on the server's clock. */
export const PartnerPromoView = z.object({
  id: z.string(),
  /** The first day it runs, `YYYY-MM-DD` (UTC). */
  from: z.string(),
  /** The day it ends, `YYYY-MM-DD` (UTC). It doesn't run on that day. */
  until: z.string(),
  perks: z.object({
    /** Wear its characters may put on while it runs. It comes off when the promo ends. */
    items: z.array(PartnerWear).optional(),
    /** Flair shown instead of the partner's own while it runs. */
    flair: z.string().optional(),
  }),
});
export type PartnerPromoView = z.infer<typeof PartnerPromoView>;

/** One partner as `GET /v1/partners` lists it. */
export const PartnerView = z.object({
  id: z.string(),
  name: z.string(),
  /** The partner's own site. */
  url: z.string(),
  /** Who the partner is and what its characters are, in a sentence or two. */
  about: z.string(),
  /** How a character shows, with `{subject}` for its number, like `Muse #{subject}`. */
  label: z.string(),
  /** Send this with `partner` and a subject to `POST /v1/agent-link`. */
  subject: z.string(),
  perks: z.object({
    badge: z.string(),
    border: PartnerBorder.optional(),
    flair: z.string().optional(),
    profile: ProfileDesign.optional(),
    /**
     * True when a character's own picture becomes its profile picture once it links: Terrakin
     * copies it from the partner's site into its own media, unless you already set a picture.
     */
    art: z.boolean().optional(),
    /** Wear its characters may put on (the profile action's `wear`), while they stay linked. */
    items: z.array(PartnerWear).optional(),
  }),
  /** Promos running now or starting later. Ended ones aren't listed. */
  promos: z.array(PartnerPromoView).optional(),
});
export type PartnerView = z.infer<typeof PartnerView>;

export const PartnersResponse = z.object({ partners: z.array(PartnerView) });
export type PartnersResponse = z.infer<typeof PartnersResponse>;

/** How often the server confirms a link's agent card still names the resident. */
export const AGENT_LINK_RECHECK_MINUTES = 60;
