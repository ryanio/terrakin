import { describe, expect, it } from "vitest";
import { type Entry, renderIndex, replacedByOf } from "./kb";

const decision = (n: string, status: string, replacedBy?: string): Entry => ({
  kind: "decision",
  file: `decisions/${n}-x.md`,
  title: `Decision ${n}`,
  date: "2026-10-01",
  status,
  tags: [],
  ...(replacedBy
    ? { replacedBy: { number: replacedBy, file: `decisions/${replacedBy}-y.md` } }
    : {}),
});

const handoff = (day: string): Entry => ({
  kind: "handoff",
  file: `handoffs/2026-10-${day}-1200-h.md`,
  title: `Handoff ${day}`,
  date: `2026-10-${day}`,
  tags: [],
});

describe("the knowledge index", () => {
  it("reads what replaced a decision from its Superseded by line", () => {
    const body =
      "---\nstatus: superseded\n---\n\nSuperseded by [decision 0373](0373-every.md): more.\n";
    expect(replacedByOf(body, "decisions")).toEqual({
      number: "0373",
      file: "decisions/0373-every.md",
    });
    expect(replacedByOf("---\nstatus: accepted\n---\n\n# Title\n", "decisions")).toBeUndefined();
  });

  it("lists binding decisions first, then superseded and rejected ones with what replaced them", () => {
    const index = renderIndex([
      decision("0001", "accepted"),
      decision("0002", "superseded", "0004"),
      decision("0003", "rejected"),
      decision("0004", "accepted"),
    ]);
    const [binding, retired] = index.split("### Superseded");
    expect(binding).toContain("decisions/0001-x.md");
    expect(binding).toContain("decisions/0004-x.md");
    expect(binding).not.toContain("decisions/0002-x.md");
    expect(binding).not.toContain("decisions/0003-x.md");
    expect(retired).toContain("· superseded by [0004](decisions/0004-y.md)");
    expect(retired).toContain("decisions/0003-x.md) · 2026-10-01 · rejected");
  });

  it("lists the newest 3 handoffs and points to the folder for the rest", () => {
    const index = renderIndex(["01", "02", "03", "04", "05"].map(handoff));
    const shown = index.split("\n").filter((l) => l.startsWith("- [Handoff"));
    expect(shown.map((l) => l.slice(3, 13))).toEqual(["Handoff 05", "Handoff 04", "Handoff 03"]);
    expect(index).toContain("The other 2 are in [handoffs/](handoffs/).");
    expect(renderIndex([handoff("01")])).not.toContain("The other");
  });
});
