import { describe, expect, it } from "vitest";
import { checkDeploy } from "./deploy";

const head = "a".repeat(40);
const main = "b".repeat(40);

describe("checkDeploy", () => {
  it("deploys the tip of main from a clean tree", () => {
    expect(checkDeploy({ head, main: head, dirty: false, ci: false })).toEqual({ go: true });
  });

  it("refuses a laptop HEAD that isn't the tip of main", () => {
    expect(checkDeploy({ head, main, dirty: false, ci: false })).toMatchObject({
      go: false,
      skip: false,
    });
  });

  it("skips in CI once main has moved on", () => {
    expect(checkDeploy({ head, main, dirty: false, ci: true })).toMatchObject({
      go: false,
      skip: true,
    });
  });

  it("refuses a dirty tree, even at the tip of main", () => {
    expect(checkDeploy({ head, main: head, dirty: true, ci: false })).toMatchObject({
      go: false,
      skip: false,
    });
    expect(checkDeploy({ head, main: head, dirty: true, ci: true })).toMatchObject({
      go: false,
      skip: false,
    });
  });
});
