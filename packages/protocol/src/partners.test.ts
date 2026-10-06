import { describe, expect, it } from "vitest";
import { buildOpenApi } from "./openapi";
import { AgentLinkRequest, formatAgentRef, parseAgentRef } from "./partners";

describe("agent ids", () => {
  it("reads eip155:<network>:<registry>:<number>, with the registry in lowercase", () => {
    const ref = parseAgentRef(" eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:7055 ");
    expect(ref).toEqual({
      chainId: 4663,
      registry: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
      agentId: "7055",
    });
    expect(ref && formatAgentRef(ref)).toBe(
      "eip155:4663:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:7055",
    );
  });

  it.each([
    "7055",
    "eip155:4663:0x8004:7055",
    "eip155:0:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:7055",
    "eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:07055",
    "eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:-1",
    "solana:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:1",
    `eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:${"9".repeat(78)}`,
  ])("refuses %s", (text) => {
    expect(parseAgentRef(text)).toBeUndefined();
  });

  it("takes either an agent or a partner with a subject, never both or half", () => {
    const ok = (body: unknown) => AgentLinkRequest.safeParse(body).success;
    expect(ok({ agent: "eip155:1:0x0:1" })).toBe(true);
    expect(ok({ partner: "musegod", subject: "464" })).toBe(true);
    expect(ok({})).toBe(false);
    expect(ok({ partner: "musegod" })).toBe(false);
    expect(ok({ subject: "464" })).toBe(false);
    expect(ok({ agent: "x", partner: "musegod", subject: "464" })).toBe(false);
    expect(ok({ partner: "musegod", subject: "4 6 4" })).toBe(false);
  });
});

describe("partner copy in the API reference", () => {
  it("uses partner words, never crypto words (RFC 0007)", () => {
    const doc = buildOpenApi() as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    const partnerText = JSON.stringify([
      doc.paths["/v1/agent-link"],
      doc.paths["/v1/partners"],
      doc.paths["/v1/partners/{id}/residents"],
      ...[
        "PartnerBadge",
        "PartnerView",
        "PartnersResponse",
        "PartnerResidentView",
        "PartnerResidentWeek",
        "PartnerResidentsResponse",
        "AgentLinkView",
        "AgentLinkResponse",
      ].map((name) => doc.components.schemas[name]),
    ]);
    expect(partnerText).toContain("agent-link");
    expect(partnerText).not.toMatch(/\b(?:nft|wallet|token|holder|chain|onchain|blockchain)s?\b/i);
  });
});
