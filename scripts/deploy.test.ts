import { describe, expect, it } from "vitest";
import { checkDeploy } from "./deploy";

const head = "a".repeat(40);
const main = "b".repeat(40);

describe("checkDeploy", () => {
  it("deploys the tip of main from a clean tree", () => {
    expect(checkDeploy({ head, main: head, dirty: false, ci: false, newer: [] })).toEqual({
      go: true,
    });
  });

  it("refuses a laptop HEAD that isn't the tip of main", () => {
    expect(
      checkDeploy({ head, main, dirty: false, ci: false, newer: ["Fix a thing"] }),
    ).toMatchObject({
      go: false,
      skip: false,
    });
  });

  it("skips in CI once main has moved on", () => {
    expect(
      checkDeploy({ head, main, dirty: false, ci: true, newer: ["Fix a thing"] }),
    ).toMatchObject({
      go: false,
      skip: true,
    });
  });

  it("deploys in CI when every newer commit skips CI, since those commits get no run", () => {
    const docs = ["Docs: a note [skip ci]", "Learning: a thing\n\nskip-checks: true"];
    expect(checkDeploy({ head, main, dirty: false, ci: true, newer: docs })).toEqual({ go: true });
    expect(
      checkDeploy({ head, main, dirty: false, ci: true, newer: [...docs, "Ship a feature"] }),
    ).toMatchObject({ go: false, skip: true });
    expect(checkDeploy({ head, main, dirty: false, ci: false, newer: docs })).toMatchObject({
      go: false,
      skip: false,
    });
  });

  it("skips in CI when HEAD isn't behind main", () => {
    expect(checkDeploy({ head, main, dirty: false, ci: true, newer: null })).toMatchObject({
      go: false,
      skip: true,
    });
  });

  it("refuses a dirty tree, even at the tip of main", () => {
    expect(checkDeploy({ head, main: head, dirty: true, ci: false, newer: [] })).toMatchObject({
      go: false,
      skip: false,
    });
    expect(checkDeploy({ head, main: head, dirty: true, ci: true, newer: [] })).toMatchObject({
      go: false,
      skip: false,
    });
  });
});
