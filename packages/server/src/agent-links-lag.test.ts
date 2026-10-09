import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentLinkService } from "./agent-links";
import { Moderation } from "./moderation";
import { nodeSql } from "./node-sql";
import { recordTelemetry } from "./test-support";

const telemetry = recordTelemetry();
const { gauges } = telemetry;
beforeEach(telemetry.start);
afterEach(telemetry.stop);

const sql = nodeSql();

describe("recheck lag", () => {
  it("reports how far behind the oldest due link is, in seconds", async () => {
    const now = Date.UTC(2026, 9, 5, 12);
    const links = new AgentLinkService(
      { sql, now: () => now, moderation: new Moderation() },
      {
        call: async () => ({ ok: false, missing: false }),
        readCard: async () => ({ ok: false, bad: false, message: "down" }),
      },
    );
    expect(await links.recheckDue()).toBe(0);
    expect(gauges).toEqual([]);
    sql.exec(
      `INSERT INTO agent_links (resident_id, chain_id, registry, agent_id, name, linked_at,
        checked_at, due_at) VALUES ('r_0123456789abcdef', 4663, '0x8004', '1', '', 0, 0, ?)`,
      now - 90_000,
    );
    expect(await links.recheckDue()).toBe(1);
    expect(gauges).toEqual([{ name: "agent_link.recheck_lag_seconds", value: 90 }]);
  });
});
