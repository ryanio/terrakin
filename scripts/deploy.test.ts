import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkDeploy, deployedVersion, replayBeforeDeploy, workflowOutputs } from "./deploy";

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

describe("workflowOutputs", () => {
  it("says whether the run uploaded, and after an upload the built page's script", () => {
    expect(workflowOutputs(true, "/assets/index-abc.js", "passed", "v-1")).toBe(
      "deployed=true\nscript=/assets/index-abc.js\nreplay=passed\nversion=v-1\n",
    );
    expect(workflowOutputs(true, undefined, "off")).toBe(
      "deployed=true\nscript=\nreplay=off\nversion=\n",
    );
    expect(workflowOutputs(false, "/assets/index-abc.js", "skipped", "v-1")).toBe(
      "deployed=false\n",
    );
  });

  it("writes the names CI's deploy job hands to the smoke job, the replay check's among them", () => {
    expect(workflowOutputs(true, undefined, "skipped")).toContain("replay=skipped\n");
  });
});

describe("deployedVersion", () => {
  const id = "0b4e1c2d-5a6f-4e7d-9c8b-1a2b3c4d5e6f";

  it("reads the id from the upload's line of wrangler's output file", () => {
    const output = [
      JSON.stringify({ version: 1, type: "wrangler-session", wrangler_version: "4.148.0" }),
      "",
      JSON.stringify({ type: "deploy", version: 1, worker_name: "terrakin", version_id: id }),
      "",
    ].join("\n");
    expect(deployedVersion(output)).toBe(id);
  });

  it("finds none without an upload's line, and takes no id that could break an output line", () => {
    expect(deployedVersion("")).toBeUndefined();
    expect(deployedVersion("not json\n{}")).toBeUndefined();
    expect(deployedVersion(JSON.stringify({ type: "version-upload", version_id: id }))).toBe(
      undefined,
    );
    const forged = JSON.stringify({ type: "deploy", version_id: `${id}\nreplay=passed` });
    expect(deployedVersion(forged)).toBeUndefined();
  });
});

describe("replayBeforeDeploy", () => {
  const said: string[] = [];
  const run = (
    check: () => Promise<{ status: "passed" | "failed" | "skipped"; lines: string[] }>,
    over: { skip?: boolean; hasServiceToken?: boolean } = {},
  ) => {
    said.length = 0;
    return replayBeforeDeploy({
      skip: false,
      hasServiceToken: true,
      check,
      describeError: () => "TypeError (details left out)",
      say: (line) => said.push(line),
      ...over,
    });
  };
  const answers = (status: "passed" | "failed" | "skipped") => async () => ({
    status,
    lines: ["a line"],
  });
  const throws = async () => {
    throw new TypeError("my secret words");
  };

  it("passes a check that ran, and refuses the deploy on one that failed", async () => {
    expect(await run(answers("passed"))).toBe("passed");
    expect(said).toEqual(["Replay check: a line"]);
    expect(await run(answers("failed"))).toBe("refused");
    expect(await run(answers("failed"), { hasServiceToken: false })).toBe("refused");
  });

  it("calls a check that couldn't run skipped when CI had a token to run it with, and off without one", async () => {
    expect(await run(answers("skipped"))).toBe("skipped");
    expect(await run(throws)).toBe("skipped");
    expect(said).toEqual(["Replay check couldn't run: TypeError (details left out)"]);
    expect(await run(answers("skipped"), { hasServiceToken: false })).toBe("off");
    expect(await run(throws, { hasServiceToken: false })).toBe("off");
  });

  it("doesn't run the check when it's skipped on purpose, and that is never an alert", async () => {
    let ran = false;
    const check = async () => {
      ran = true;
      return { status: "failed" as const, lines: [] };
    };
    expect(await run(check, { skip: true })).toBe("off");
    expect(ran).toBe(false);
    expect(said).toEqual(["Replay check: skipped (TERRAKIN_SKIP_REPLAY_CHECK=1)."]);
  });

  it("hands its answer to the workflow's outputs", () => {
    const source = readFileSync(new URL("./deploy.ts", import.meta.url), "utf8");
    expect(source).toContain("await tellWorkflow(true, replayed, version);");
    expect(source).toContain(
      "workflowOutputs(deployed, deployed ? script : undefined, replay, version)",
    );
    // The version id comes from the file wrangler writes for the upload it just made.
    expect(source).toContain("WRANGLER_OUTPUT_FILE_PATH: outputFile");
  });

  it("turns the smoke job red when the replay check was skipped", () => {
    const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    expect(ci).toMatch(/if: \$\{\{ always\(\) && needs\.deploy\.outputs\.replay == 'skipped' \}\}/);
  });

  it("writes the names CI's deploy job hands to the smoke job", () => {
    const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    for (const [, name] of workflowOutputs(true, undefined, "off").matchAll(/^(\w+)=/gm)) {
      expect(ci).toContain(`${name}: \${{ steps.deploy.outputs.${name} }}`);
      expect(ci).toContain(`needs.deploy.outputs.${name}`);
    }
  });
});
