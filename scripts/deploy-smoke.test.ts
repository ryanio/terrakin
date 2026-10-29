import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { RENDERS_PER_MINUTE } from "../packages/server/src/og";
import { WORLD_SWITCHES } from "../packages/server/src/world-switches";
import {
  ask,
  checkBuild,
  checkFile,
  checkHealth,
  checkHome,
  checkPicture,
  checkWorld,
  type Draws,
  drawLine,
  EXTRA_PICTURES,
  firstSteps,
  type Got,
  type Io,
  PICTURE_TRIES,
  pictureDraw,
  pictureSteps,
  run,
  SNAPSHOT_FIELDS,
  type Step,
  shownSwitches,
  workerSwitches,
} from "./deploy-smoke";

const got = (o: Partial<Got> & { text?: string } = {}): Got => ({
  status: 200,
  type: "",
  location: "",
  cacheControl: "",
  workerBuild: "",
  cacheStatus: "",
  body: new TextEncoder().encode(o.text ?? ""),
  ...o,
});
const json = (value: unknown) => got({ type: "application/json", text: JSON.stringify(value) });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe("the Worker's switches", () => {
  const options = workerSwitches(
    readFileSync(new URL("../packages/server/cloudflare/worker.ts", import.meta.url), "utf8"),
  );

  it("come from worker.ts, and each has a row saying where the snapshot shows it", () => {
    expect(options).toEqual(expect.arrayContaining(["recipes", "levels"]));
    expect(options.filter((option) => !Object.hasOwn(SNAPSHOT_FIELDS, option))).toEqual([]);
    expect(Object.keys(SNAPSHOT_FIELDS).filter((row) => !options.includes(row))).toEqual([]);
    expect(shownSwitches(options)).toEqual(
      expect.arrayContaining([
        { option: "recipes", field: "recipesOpen" },
        { option: "levels", field: "levelsOpen" },
      ]),
    );
  });

  it("takes the world's options set to true, the shared ones where it spreads them, a trailing comment or not", () => {
    const source = [
      "const service = new WorldService({",
      "  store: new SqlStore(sql, (fn) => {",
      "    inner: true,",
      "  }),",
      "  ...WORLD_SWITCHES,",
      "  levels: true, // RFC 0029 {",
      "  market: false,",
      "  townsfolk,",
      "});",
      "const other = { later: true };",
    ].join("\n");
    const shared = Object.keys(WORLD_SWITCHES).filter(
      (name) => name !== "jobEdition" && name !== "pageEdition",
    );
    expect(workerSwitches(source)).toEqual([...shared, "levels"]);
  });

  it("fails loudly on a Worker whose world isn't built where it looks", () => {
    expect(() => workerSwitches("export default {}")).toThrow();
  });
});

describe("checkHealth", () => {
  it("wants a 200 with a seq", () => {
    expect(checkHealth(json({ ok: true, seq: 12 })).problems).toEqual([]);
    expect(checkHealth(json({ ok: true })).problems).toEqual(["it has no `seq`"]);
    expect(checkHealth({ ...json({ ok: true, seq: 12 }), status: 500 }).problems).toHaveLength(1);
  });
});

describe("checkBuild", () => {
  const deployed = "0b4e1c2d-5a6f-4e7d-9c8b-1a2b3c4d5e6f";
  const health = (build: string | undefined, worker: string) => ({
    ...json({ ok: true, seq: 12, ...(build === undefined ? {} : { build }) }),
    workerBuild: worker,
  });

  it("passes only when the world and the Worker both run the deployed build", () => {
    expect(checkBuild(health(deployed, deployed), deployed)).toEqual({
      problems: [],
      note: `seq 12, the Worker and the world on ${deployed}`,
    });
  });

  it("says which build the world still runs, or that it names none", () => {
    expect(checkBuild(health("old-build", deployed), deployed).problems).toEqual([
      `the World object runs build old-build, not the deployed ${deployed}: Cloudflare hasn't restarted it on the new build yet`,
    ]);
    expect(checkBuild(health(undefined, deployed), deployed).problems[0]).toContain(
      "names no build",
    );
  });

  it("fails a Worker that isn't the deployed one, and a health that fails as health", () => {
    expect(checkBuild(health(deployed, "old-build"), deployed).problems).toEqual([
      `the Worker that answered is build old-build, not the deployed ${deployed}`,
    ]);
    expect(checkBuild(health(deployed, ""), deployed).problems).toHaveLength(1);
    expect(checkBuild({ ...health(deployed, deployed), status: 500 }, deployed).problems).toEqual(
      expect.arrayContaining([expect.stringContaining("500")]),
    );
  });
});

describe("checkWorld", () => {
  const switches = [{ option: "levels", field: "levelsOpen" }];
  const world = {
    seq: 5,
    levelsOpen: true,
    residents: [{ id: "r_aa" }, { id: "../v1/admin" }, { name: "no id" }],
    townsfolkResidents: [{ id: "r_bb" }],
    plots: [
      { px: 3, py: 4, ownerId: "r_aa" },
      { px: 5, py: 5 },
      { px: -1, py: 2, ownerId: "r_bb" },
    ],
  };

  it("passes a world with the Worker's switches and picks three pictures from it", () => {
    const outcome = checkWorld(json(world), switches, "seed");
    expect(outcome.problems).toEqual([]);
    const paths = (outcome.next ?? []).map((step) => step.path);
    // The only plot with an owner and whole coordinates, and only ids that are safe in a path.
    expect(paths[0]).toBe("/og/plot/3-4.png");
    expect(paths[1]).toMatch(/^\/og\/look\/r_(aa|bb)\.png$/);
    expect(paths[2]).toMatch(/^\/og\/near\/r_(aa|bb)\.png$/);
    // Then one more map, around the other resident, asked once and only while nothing was drawn.
    expect(paths.slice(3)).toEqual([expect.stringMatching(/^\/og\/near\/r_(aa|bb)\.png$/)]);
    expect(paths[3]).not.toBe(paths[2]);
    expect((outcome.next ?? []).map((step) => step.tries)).toEqual([
      PICTURE_TRIES,
      PICTURE_TRIES,
      PICTURE_TRIES,
      1,
    ]);
  });

  it("fails a world missing a switch the Worker sets, by name", () => {
    const { levelsOpen: _, ...without } = world;
    const { problems } = checkWorld(json(without), switches, "seed");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("it has no `levelsOpen`, which the Worker's `levels` switch");
    expect(problems[0]).toContain("run the check again");
    // On the deployed build no restart is coming, so it says so instead.
    const [onBuild] = checkWorld(json(without), switches, "seed", { onBuild: true }).problems;
    expect(onBuild).toContain("though the World object runs the deployed build");
  });

  it("fails a body that isn't a world, and a world with nobody to draw", () => {
    expect(checkWorld(got({ type: "application/json", text: "<html>" }), [], "s").problems).toEqual(
      ["its body isn't a JSON object"],
    );
    expect(checkWorld(json({ residents: [], plots: [] }), [], "s").problems).toHaveLength(1);
  });
});

describe("checkPicture", () => {
  it("passes a PNG", () => {
    expect(checkPicture(got({ type: "image/png", body: PNG })).problems).toEqual([]);
  });

  it("counts a PNG by whether the Worker drew it for this request", () => {
    const draws: Draws = { drawn: 0, cached: 0, unsaid: 0 };
    const png = (cacheStatus: string) => got({ type: "image/png", body: PNG, cacheStatus });
    expect(checkPicture(png("terrakin; fwd=miss"), draws).note).toContain("drawn now");
    expect(checkPicture(png("terrakin; hit"), draws).note).toContain("from the cache");
    expect(checkPicture(png(""), draws).note).toContain("didn't say");
    // A failed answer counts for nothing.
    checkPicture(
      got({ status: 302, location: "/og.png", cacheStatus: "terrakin; fwd=miss" }),
      draws,
    );
    expect(draws).toEqual({ drawn: 1, cached: 1, unsaid: 1 });
  });

  it("fails the redirect to the static card a Worker that can't draw sends", () => {
    const { problems } = checkPicture(
      got({ status: 302, location: "/og.png", cacheControl: "no-store" }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("redirected to /og.png");
  });

  it("fails a 200 that isn't a PNG, by its type or by its bytes", () => {
    expect(checkPicture(got({ type: "text/html", body: PNG })).problems).toHaveLength(1);
    expect(checkPicture(got({ type: "image/png", text: "<html>" })).problems).toHaveLength(1);
  });
});

describe("pictureDraw", () => {
  it("reads the Worker's entry in Cache-Status, and a later cache's replay as cached", () => {
    expect(pictureDraw("terrakin; fwd=miss")).toBe("drawn");
    expect(pictureDraw("Terrakin; fwd=miss, SomeProxy; fwd=uri-miss")).toBe("drawn");
    expect(pictureDraw("terrakin; hit")).toBe("cached");
    expect(pictureDraw("terrakin; fwd=miss, SomeProxy; hit")).toBe("cached");
    expect(pictureDraw("")).toBe("unsaid");
    expect(pictureDraw("SomeProxy; fwd=miss")).toBe("unsaid");
    expect(pictureDraw("terrakin")).toBe("unsaid");
  });
});

describe("drawLine", () => {
  it("says a draw was proved, or plainly that it couldn't be, and nothing with no pictures", () => {
    expect(drawLine({ drawn: 1, cached: 2, unsaid: 0 })).toEqual({
      proved: true,
      line: "The Worker drew 1 of the 3 pictures for this run, so it can draw.",
    });
    const none = drawLine({ drawn: 0, cached: 3, unsaid: 0 });
    expect(none?.proved).toBe(false);
    expect(none?.line).toMatch(
      /^Couldn't prove the Worker can draw: .*every one came from the cache/,
    );
    expect(drawLine({ drawn: 0, cached: 2, unsaid: 1 })?.line).toContain("didn't say for 1");
    expect(drawLine({ drawn: 0, cached: 0, unsaid: 2 })?.line).toContain("said for none");
    expect(drawLine({ drawn: 0, cached: 0, unsaid: 0 })).toBeUndefined();
  });
});

describe("ask", () => {
  it("hands back the redirect to the static card instead of following it to a PNG", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/og.png") {
        res.writeHead(200, { "content-type": "image/png" }).end(PNG);
      } else {
        res.writeHead(302, { location: "/og.png", "cache-control": "no-store" }).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const answer = await ask(`http://127.0.0.1:${port}`, "/og/plot/3-4.png");
      expect(answer).toMatchObject({ status: 302, location: "/og.png", cacheControl: "no-store" });
      expect(checkPicture(answer).problems).toHaveLength(1);
    } finally {
      server.close();
    }
  });
});

describe("checkFile", () => {
  const file = { type: "text/markdown", has: "name: terrakin" };

  it("wants the type and the line", () => {
    const skill = got({ type: "text/markdown; charset=utf-8", text: "---\nname: terrakin\n" });
    expect(checkFile(skill, file).problems).toEqual([]);
    expect(checkFile({ ...skill, type: "text/html" }, file).problems).toHaveLength(1);
    expect(checkFile(got({ type: "text/markdown", text: "# Hi" }), file).problems).toHaveLength(1);
  });

  it("with the checkout's own file, says whether the live one is it, and passes either way", () => {
    const build = { text: "name: terrakin, this build", from: "SKILL.md" };
    const live = (text: string) =>
      checkFile(got({ type: "text/markdown", text }), { ...file, build });
    expect(live(build.text)).toEqual({
      problems: [],
      note: expect.stringMatching(/, this checkout's/),
    });
    const earlier = live("name: terrakin, the build before");
    expect(earlier.problems).toEqual([]);
    expect(earlier.note).toContain("not this checkout's SKILL.md");
    expect(earlier.note).not.toContain("before");
  });

  it("on the deployed build, fails a skill file that isn't this checkout's", () => {
    const build = { text: "name: terrakin, this build", from: "SKILL.md", onBuild: true };
    const live = (text: string) =>
      checkFile(got({ type: "text/markdown", text }), { ...file, build });
    expect(live(build.text).problems).toEqual([]);
    expect(live("name: terrakin, the build before").problems).toEqual([
      "it isn't this checkout's SKILL.md, though the World object runs the deployed build",
    ]);
  });
});

describe("checkHome", () => {
  const page = (script: string) =>
    got({
      type: "text/html",
      text: `<script>var a</script><script type="module" crossorigin src="${script}"></script>`,
    });

  it("passes the built page and then asks for its script", () => {
    const outcome = checkHome(page("/assets/index-abc.js"), "/assets/index-abc.js");
    expect(outcome.problems).toEqual([]);
    const script = outcome.next?.[0];
    expect(script?.path).toBe("/assets/index-abc.js");
    expect(script?.check(got({ type: "text/javascript" })).problems).toEqual([]);
    // A file the assets don't have answers 200 with the page itself.
    expect(script?.check(got({ type: "text/html" })).problems).toHaveLength(1);
  });

  it("fails a page with another build's script, or none", () => {
    expect(checkHome(page("/assets/index-old.js"), "/assets/index-abc.js").problems).toHaveLength(
      1,
    );
    expect(checkHome(got({ type: "text/html", text: "<p>Hi</p>" }), undefined).problems).toEqual([
      "it loads no module script from /assets/",
    ]);
  });
});

describe("run", () => {
  /** A clock that only sleeping moves, and answers by path: each ask takes the next one. */
  function io(answers: Record<string, (Got | Error)[]>) {
    let now = 0;
    const asked: string[] = [];
    const said: string[] = [];
    const io: Io = {
      ask: async (path) => {
        asked.push(path);
        const answer = answers[path]?.shift();
        if (!answer || answer instanceof Error) throw answer ?? new Error(`no answer for ${path}`);
        return answer;
      },
      sleep: async (ms) => {
        now += ms;
      },
      now: () => now,
      say: (line) => {
        said.push(line);
      },
    };
    return { io, asked, said };
  }
  const ok = got({ status: 200 });
  const bad = got({ status: 500 });
  const step = (path: string, more: Partial<Step> = {}): Step => ({
    name: path,
    path,
    check: (answer) => ({ problems: answer.status === 200 ? [] : ["not 200"] }),
    ...more,
  });

  it("asks again for what failed while the wait lasts, and only for that", async () => {
    const { io: fake, asked } = io({ "/a": [ok], "/b": [bad, new Error("reset"), ok] });
    const result = await run([step("/a"), step("/b")], fake, { waitMs: 120_000, everyMs: 30_000 });
    expect(result).toEqual({ passed: 2, failed: [] });
    expect(asked).toEqual(["/a", "/b", "/b", "/b"]);
  });

  it("stops when the wait is over", async () => {
    const { io: fake, asked } = io({ "/b": [bad, bad, bad, bad, bad, bad] });
    const result = await run([step("/b")], fake, { waitMs: 60_000, everyMs: 30_000 });
    expect(asked).toHaveLength(3);
    expect(result.failed).toEqual([{ name: "/b", path: "/b", problems: ["not 200"] }]);
    const once = io({ "/b": [bad, ok] });
    await run([step("/b")], once.io, { waitMs: 0, everyMs: 30_000 });
    expect(once.asked).toHaveLength(1);
  });

  it("never asks for a step more than its tries, however long the wait", async () => {
    const { io: fake, asked } = io({ "/pic": [bad, bad, bad, bad, bad, bad] });
    const result = await run([step("/pic", { tries: 2 })], fake, {
      waitMs: 600_000,
      everyMs: 30_000,
    });
    expect(asked).toHaveLength(2);
    expect(result.failed).toHaveLength(1);
  });

  it("asks for what an answer brings once it passes, and not when it fails", async () => {
    const bringing = (path: string) =>
      step(path, {
        check: (answer) => ({
          problems: answer.status === 200 ? [] : ["not 200"],
          next: [step(`${path}/next`)],
        }),
      });
    const { io: fake, asked } = io({ "/w": [bad, ok], "/w/next": [ok], "/h": [bad, bad] });
    const result = await run([bringing("/w"), bringing("/h")], fake, {
      waitMs: 30_000,
      everyMs: 30_000,
    });
    expect(asked).toEqual(["/w", "/h", "/w", "/h", "/w/next"]);
    expect(result).toMatchObject({ passed: 2, failed: [{ name: "/h" }] });
  });

  it("lets a step wait longer than the run, and gives what it brings the run's wait afresh", async () => {
    const { io: fake, asked } = io({
      "/h": [bad, bad, bad, bad, bad, bad, ok],
      "/w": [bad, ok],
    });
    const waiting = step("/h", {
      waitMs: 300_000,
      check: (answer) => ({
        problems: answer.status === 200 ? [] : ["not 200"],
        next: [step("/w")],
      }),
    });
    const result = await run([waiting], fake, { waitMs: 30_000, everyMs: 30_000 });
    expect(result).toEqual({ passed: 2, failed: [] });
    expect(asked).toEqual(["/h", "/h", "/h", "/h", "/h", "/h", "/h", "/w", "/w"]);
  });

  it("skips a step whose `when` says no at its turn, and counts it nowhere", async () => {
    let wanted = false;
    const { io: fake, asked } = io({ "/a": [ok], "/b": [ok] });
    const result = await run([step("/a"), step("/b", { when: () => wanted })], fake, {
      waitMs: 0,
      everyMs: 30_000,
    });
    expect(asked).toEqual(["/a"]);
    expect(result).toEqual({ passed: 1, failed: [] });
    wanted = true;
    expect(
      (
        await run([step("/b", { when: () => wanted })], io({ "/b": [ok] }).io, {
          waitMs: 0,
          everyMs: 30_000,
        })
      ).passed,
    ).toBe(1);
  });
});

describe("a run with the deployed version", () => {
  const id = "0b4e1c2d-5a6f-4e7d-9c8b-1a2b3c4d5e6f";
  const skill = "---\nname: terrakin\n";
  const world = {
    residents: [{ id: "r_aa" }, { id: "r_bb" }, { id: "r_cc" }, { id: "r_dd" }, { id: "r_ee" }],
    plots: [{ px: 3, py: 4, ownerId: "r_aa" }],
  };
  /** A live site whose World object restarts on `id` after `restartMs`, and pictures by `picture`. */
  function site(restartMs: number, picture: (path: string) => Got) {
    let now = 0;
    const asked: string[] = [];
    const said: string[] = [];
    const io: Io = {
      ask: async (path) => {
        asked.push(path);
        if (path === "/v1/health") {
          const build = now >= restartMs ? id : "the-build-before";
          return { ...json({ ok: true, seq: 1, build }), workerBuild: id };
        }
        if (path === "/v1/world") return json(world);
        if (path === "/skill.md") return got({ type: "text/markdown", text: skill });
        if (path.startsWith("/og/")) return picture(path);
        return got({ status: 404 });
      },
      sleep: async (ms) => {
        now += ms;
      },
      now: () => now,
      say: (line) => {
        said.push(line);
      },
    };
    return { io, asked, said };
  }
  const png = (cacheStatus: string) => () => got({ type: "image/png", body: PNG, cacheStatus });
  const steps = (draws: Draws, waitMs = 600_000) =>
    firstSteps({ switches: [], seed: "seed", skill, version: { id, waitMs }, draws }).filter(
      (s) => s.path === "/v1/health",
    );
  const fresh = (): Draws => ({ drawn: 0, cached: 0, unsaid: 0 });
  const options = { waitMs: 120_000, everyMs: 30_000 };

  it("asks nothing the world answers until the world runs the deployed build", async () => {
    const t = site(300_000, png("terrakin; fwd=miss"));
    const draws = fresh();
    const result = await run(steps(draws), t.io, options);
    expect(result.failed).toEqual([]);
    const firstWorld = t.asked.indexOf("/v1/world");
    // Health every 30 seconds until the restart at 5 minutes, then the world and the rest.
    expect(t.asked.slice(0, firstWorld)).toEqual(Array(11).fill("/v1/health"));
    expect(t.asked).toContain("/skill.md");
    expect(t.asked.filter((p) => p.startsWith("/og/"))).toHaveLength(3);
    expect(draws.drawn).toBe(3);
  });

  it("says plainly when the world never gets there, and asks for none of what waits on it", async () => {
    const t = site(Number.POSITIVE_INFINITY, png("terrakin; fwd=miss"));
    const result = await run(steps(fresh(), 90_000), t.io, options);
    expect(new Set(t.asked)).toEqual(new Set(["/v1/health"]));
    expect(result.failed).toEqual([
      {
        name: "build",
        path: "/v1/health",
        problems: [expect.stringContaining("runs build the-build-before, not the deployed")],
      },
    ]);
    expect(t.said).toContain(
      "       Not asked, since this failed: the world, the skill file, and the pictures, after 90 seconds of waiting for the World object to run the deployed build.",
    );
  });

  it("asks for more maps only while nothing was drawn, and never past one address's draws", async () => {
    const cached = site(0, png("terrakin; hit"));
    const none = fresh();
    expect((await run(steps(none), cached.io, options)).failed).toEqual([]);
    const pictures = (t: { asked: string[] }) => t.asked.filter((p) => p.startsWith("/og/"));
    expect(pictures(cached)).toHaveLength(3 + EXTRA_PICTURES);
    expect(none).toEqual({ drawn: 0, cached: 3 + EXTRA_PICTURES, unsaid: 0 });
    expect(drawLine(none)?.proved).toBe(false);

    // The first extra map drawn ends the extra asks.
    let asks = 0;
    const once = site(0, () => png(++asks === 4 ? "terrakin; fwd=miss" : "terrakin; hit")());
    await run(steps(fresh()), once.io, options);
    expect(pictures(once)).toHaveLength(4);

    // Every draw refused: each picture is asked its tries and no more, under the per-address cap.
    const refused = site(0, () =>
      got({ status: 302, location: "/og.png", cacheControl: "no-store" }),
    );
    const result = await run(steps(fresh()), refused.io, options);
    expect(result.failed.length).toBe(3 + EXTRA_PICTURES);
    expect(pictures(refused).length).toBeLessThanOrEqual(RENDERS_PER_MINUTE);
  });

  it("picks the extra maps among other residents than the near picture's", () => {
    const paths = pictureSteps(world, "seed").map((p) => p.path);
    const near = paths.filter((p) => p.startsWith("/og/near/"));
    expect(near).toHaveLength(1 + EXTRA_PICTURES);
    expect(new Set(near).size).toBe(near.length);
  });
});
