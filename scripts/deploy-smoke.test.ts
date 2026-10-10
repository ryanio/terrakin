import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  ask,
  checkFile,
  checkHealth,
  checkHome,
  checkPicture,
  checkWorld,
  type Got,
  type Io,
  PICTURE_TRIES,
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

  it("takes only the world's own options set to true, a trailing comment or not", () => {
    const source = [
      "const service = new WorldService({",
      "  store: new SqlStore(sql, (fn) => {",
      "    inner: true,",
      "  }),",
      "  days: true,",
      "  levels: true, // RFC 0029 {",
      "  market: false,",
      "  townsfolk,",
      "});",
      "const other = { later: true };",
    ].join("\n");
    expect(workerSwitches(source)).toEqual(["days", "levels"]);
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
    expect((outcome.next ?? []).map((step) => step.tries)).toEqual([
      PICTURE_TRIES,
      PICTURE_TRIES,
      PICTURE_TRIES,
    ]);
  });

  it("fails a world missing a switch the Worker sets, by name", () => {
    const { levelsOpen: _, ...without } = world;
    const { problems } = checkWorld(json(without), switches, "seed");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("it has no `levelsOpen`, which the Worker's `levels` switch");
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
      say: () => {},
    };
    return { io, asked };
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
});
