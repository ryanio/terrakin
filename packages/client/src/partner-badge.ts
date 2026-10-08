/**
 * Verified characters on a profile (RFC 0007): "Verified Muse #464" with the partner's mark, which
 * opens a sheet saying where it was confirmed, or a quiet "Verified agent" for an agent with no
 * partner. The server decides all of it; this only draws `partner` and `agentLink`. Names from an
 * agent's card are text, and the only link out is the partner page from Terrakin's own config.
 */
import {
  type PartnerBadge,
  PROFILE_DESIGNS,
  type ProfileDesign,
  type ProfileView,
} from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { partnerMark, verifiedLabel } from "@terrakin/ui/people";
import { tip } from "@terrakin/ui/tooltip";
import { openOverlay, sheet } from "@terrakin/ui/ui";

/** The partner's own site for its character, only when it is an https address. */
function partnerPage(partner: PartnerBadge): { href: string; host: string } | null {
  if (!URL.canParse(partner.url)) return null;
  const url = new URL(partner.url);
  if (url.protocol !== "https:") return null;
  return { href: url.href, host: url.hostname };
}

/**
 * The partner profile design a character's profile wears (header art, a background pattern, and
 * accent colors), or null. Only ids from the curated set; anything else draws the usual profile.
 */
export function profileDesign(profile: Pick<ProfileView, "partner">): ProfileDesign | null {
  const design = profile.partner?.profile;
  return design && (PROFILE_DESIGNS as readonly string[]).includes(design) ? design : null;
}

/** The line under a profile's name, or null when they linked no agent. */
export function verifiedRow(profile: ProfileView): HTMLElement | null {
  const { partner, agentLink } = profile;
  if (partner) {
    return h(
      "div",
      { class: "verified-row" },
      h(
        "button",
        {
          class: "verified-chip",
          attrs: { type: "button", "aria-haspopup": "dialog" },
          on: { click: () => openVerifiedSheet(profile.name, partner) },
        },
        partnerMark(partner),
        h("span", { text: verifiedLabel(partner) }),
      ),
    );
  }
  if (!agentLink) return null;
  return h(
    "div",
    { class: "verified-row" },
    tip(
      h(
        "span",
        { class: "verified-agent" },
        icon("check", "icon verified-agent-icon"),
        h("span", { text: "Verified agent" }),
      ),
      "Their agent's card names this profile, checked about every hour.",
    ),
  );
}

function openVerifiedSheet(name: string, partner: PartnerBadge) {
  const page = partnerPage(partner);
  const { dialog, close } = sheet(
    {
      id: "verified-sheet-title",
      title: verifiedLabel(partner),
      className: "verified-sheet",
      closeOnBackdrop: true,
    },
    h(
      "div",
      { class: "sheet-body" },
      h("p", {
        class: "sheet-lede",
        text: `${name} is ${partner.name}'s ${partner.label}. Whoever keeps the character confirmed this profile, and Terrakin checks it again about every hour.`,
      }),
      page
        ? h(
            "a",
            {
              class: "pill-button verified-out",
              attrs: { href: page.href, target: "_blank", rel: "noopener noreferrer" },
            },
            icon("link"),
            h("span", { text: `Linked on ${page.host}` }),
          )
        : null,
    ),
  );
  openOverlay(dialog);
  close.focus();
}
