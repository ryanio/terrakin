/**
 * Residents at a stage (decision 0147): a visitor, someone settled on a plot with a home, someone
 * with coins and things, a pet, a maintainer, or a human with an AI of their own. Each is built
 * through the real API: joining, settling, and building are the actions a person sends, and only
 * what play takes days to reach (coins, things, staff) comes from the server's test routes, which
 * answer only when it runs with `TERRAKIN_TEST_CLOCK=1`.
 *
 * It takes any `Http`, so Playwright specs use it through `persona` in `support.ts` and people and
 * agents use it from the command line through `scripts/persona.ts`, against `pnpm dev:test`.
 */

/** One request to the server, answered with its status and parsed body. */
export interface Http {
  call(
    method: "GET" | "POST",
    path: string,
    opts?: { token?: string; data?: unknown },
  ): Promise<{ status: number; body: unknown }>;
}

/** An `Http` over `fetch`, for a server at `base` (`http://localhost:8787`). */
export function fetchHttp(base: string): Http {
  return {
    async call(method, path, { token, data } = {}) {
      const res = await fetch(new URL(path, base), {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(data === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
  };
}

export interface PersonaSpec {
  name: string;
  kind?: "human" | "agent";
  color?: string;
  /** Claim a free plot. */
  plot?: boolean;
  /** Claim it downtown rather than across the water, since only a downtown plot can be sold. */
  downtown?: boolean;
  /** Build the starter home on the plot (claims one too), which leaves you on your hearth. */
  home?: boolean;
  /** Coins from the treasury. */
  coins?: number;
  /** Stacks of things by kind: `{ wood: 5, tomato_seed: 2 }`. */
  stacks?: Record<string, number>;
  /** Adopt a pet (builds a home first). */
  pet?: { kind: string; coat: string; name: string };
  /** Make them a maintainer, for the staff app and staff-only buttons. */
  staff?: boolean;
  /** For a human: join an AI with this name and link it to them as its owner. */
  agent?: string;
}

/** A resident built by `makePersona`. */
export interface Persona {
  id: string;
  token: string;
  name: string;
  /** The plot they settled, if any. */
  plot?: [number, number];
  /** Their AI, when the spec asked for one. */
  agent?: { id: string; token: string; name: string };
}

/** Named stages to start from. A spec's own fields go on top. */
export const PRESETS = {
  /** Joined, standing in the Commons, no plot. */
  visitor: {},
  /** A plot with the starter home, standing on the hearth: Build works. */
  settled: { home: true },
  /** Settled, with coins and a little of everything a kitchen, a planter, and a workbench take. */
  stocked: {
    home: true,
    coins: 500,
    stacks: {
      wood: 10,
      stone: 10,
      tomato_seed: 3,
      herb_seed: 3,
      strawberry_seed: 3,
      tomato: 4,
      herb: 4,
      strawberry: 4,
      sugar: 4,
      jar: 4,
      lantern: 1,
    },
  },
  /** Settled, with a dog. */
  pet: { home: true, pet: { kind: "dog", coat: "golden", name: "Rex" } },
  /** Settled, and a maintainer. */
  staff: { home: true, staff: true },
  /** Settled, with an AI of their own. */
  owner: { home: true, agent: "Pip" },
} as const satisfies Record<string, Omit<PersonaSpec, "name">>;

export type PresetName = keyof typeof PRESETS;

export const isPreset = (name: string): name is PresetName => Object.hasOwn(PRESETS, name);

async function expectOk(
  what: string,
  answer: Promise<{ status: number; body: unknown }>,
): Promise<Record<string, unknown>> {
  const { status, body } = await answer;
  const ok = status < 300 && (body as { ok?: boolean } | null)?.ok !== false;
  if (!ok) throw new Error(`${what}: ${status} ${JSON.stringify(body)}`);
  return (body ?? {}) as Record<string, unknown>;
}

/** Join as a new resident: `POST /v1/session`. */
export async function joinOver(
  http: Http,
  name: string,
  { kind = "human", color }: { kind?: "human" | "agent"; color?: string } = {},
): Promise<{ id: string; token: string }> {
  const data = color === undefined ? { name, kind } : { name, kind, color };
  const body = await expectOk(`join ${name}`, http.call("POST", "/v1/session", { data }));
  return { id: String(body.residentId), token: String(body.token) };
}

/** A world action as a resident. The body says whether the rules took it: check `ok`. */
export async function actOver(http: Http, token: string, action: unknown) {
  return (await http.call("POST", "/v1/actions", { token, data: action })).body as {
    ok?: boolean;
  } & Record<string, unknown>;
}

/** How far `smoke.spec.ts` walks west and north from spawn before it claims where it stands. */
export const SMOKE_STEPS = 5;

/**
 * The plot `smoke.spec.ts` claims by walking onto it: `SMOKE_STEPS` west and north of spawn, the
 * middle of the world (the sim's `spawnTile`). It can't pick another, so no free list offers it.
 */
export function walkedOnto(config: { width: number; height: number; plotSize: number }) {
  const at = (side: number) => Math.floor(side / 2) - SMOKE_STEPS;
  return [
    Math.floor(at(config.width) / config.plotSize),
    Math.floor(at(config.height) / config.plotSize),
  ];
}

/**
 * Unclaimed plots, skipping the Commons and the plot `smoke.spec.ts` walks onto. The search starts
 * in `corner` and goes a row at a time, so specs that run side by side ask for different corners.
 */
export async function freePlotsOver(
  http: Http,
  n: number,
  corner: "bottom-right" | "bottom-left" | "top-right" = "bottom-right",
): Promise<[number, number][]> {
  const world = (await http.call("GET", "/v1/world")).body as {
    config: { width: number; height: number; plotSize: number };
    plots: { px: number; py: number }[];
    commons: { px: number; py: number };
    lands?: {
      home: { width: number; height: number };
      list: { plots: { px: number; py: number }[] }[];
    };
  };
  const { width, height, plotSize } = world.config;
  const taken = new Set(world.plots.map((p) => `${p.px},${p.py}`));
  taken.add(`${world.commons.px},${world.commons.py}`);
  taken.add(walkedOnto(world.config).join(","));
  // The water between lands is no plot (RFC 0038), so leave it out rather than offer a slot
  // `settle` refuses. This is the sim's `landedFrom` written out, because this file has no imports:
  // `scripts/persona.ts` loads it as it is, outside the bundler. A world of one grid has no
  // `lands`, and every slot in one is land.
  const lands = world.lands;
  const slots = new Set((lands?.list ?? []).flatMap((l) => l.plots.map((p) => `${p.px},${p.py}`)));
  const dry = (px: number, py: number) =>
    !lands ||
    (px >= 0 &&
      py >= 0 &&
      ((px * plotSize < lands.home.width && py * plotSize < lands.home.height) ||
        slots.has(`${px},${py}`)));
  const span = (size: number, backwards: boolean) => {
    const all = Array.from({ length: size / plotSize }, (_, i) => i);
    return backwards ? all.reverse() : all;
  };
  const out: [number, number][] = [];
  for (const py of span(height, corner !== "top-right")) {
    for (const px of span(width, corner !== "bottom-left")) {
      if (out.length < n && !taken.has(`${px},${py}`) && dry(px, py)) out.push([px, py]);
    }
  }
  return out;
}

/**
 * Settle the first of `plots` that's still free when asked, and return it. Another resident can
 * take a free plot between reading the world and settling it; then the next one is tried.
 */
export async function settleFreeOver(
  http: Http,
  token: string,
  plots: readonly (readonly [number, number])[],
): Promise<[number, number]> {
  let last: unknown;
  for (const [px, py] of plots.slice(0, 5)) {
    last = await actOver(http, token, { type: "settle", px, py });
    if ((last as { ok?: boolean }).ok) return [px, py];
  }
  throw new Error(`Couldn't settle any of ${plots.length} free plots: ${JSON.stringify(last)}`);
}

/** Build a resident to `spec`, step by step, and say who they are. Throws on any refusal. */
export async function makePersona(http: Http, spec: PersonaSpec): Promise<Persona> {
  const who = await joinOver(http, spec.name, {
    ...(spec.kind ? { kind: spec.kind } : {}),
    ...(spec.color ? { color: spec.color } : {}),
  });
  const out: Persona = { ...who, name: spec.name };
  const home = spec.home || spec.pet !== undefined;
  if (spec.plot || home) {
    const corner = spec.downtown ? "bottom-left" : "bottom-right";
    out.plot = await settleFreeOver(http, who.token, await freePlotsOver(http, 5, corner));
  }
  if (home) {
    await expectOk(
      "build the starter home",
      http.call("POST", "/v1/actions", {
        token: who.token,
        data: { type: "build_starter_home" },
      }),
    );
  }
  const stacks = spec.stacks && Object.keys(spec.stacks).length > 0 ? spec.stacks : undefined;
  if (spec.coins || stacks) {
    await expectOk(
      "grant coins and things (is the server running with TERRAKIN_TEST_CLOCK=1?)",
      http.call("POST", "/v1/test/grant", {
        data: {
          residentId: who.id,
          ...(spec.coins ? { coins: spec.coins } : {}),
          ...(stacks ? { stacks } : {}),
        },
      }),
    );
  }
  if (spec.pet) {
    await expectOk(
      "adopt a pet",
      http.call("POST", "/v1/actions", {
        token: who.token,
        data: { type: "adopt_pet", ...spec.pet },
      }),
    );
  }
  if (spec.staff) {
    await expectOk(
      "make a maintainer (is the server running with TERRAKIN_TEST_CLOCK=1?)",
      http.call("POST", "/v1/test/maintainer", { data: { residentId: who.id } }),
    );
  }
  if (spec.agent) {
    const agent = await joinOver(http, spec.agent, { kind: "agent" });
    const claim = await expectOk(
      "make a claim code",
      http.call("POST", "/v1/owner/claims", { token: who.token }),
    );
    await expectOk(
      "accept the claim code",
      http.call("POST", "/v1/owner/accept", { token: agent.token, data: { code: claim.code } }),
    );
    out.agent = { ...agent, name: spec.agent };
  }
  return out;
}

/**
 * Switch recipes you learn on in this world now (RFC 0024): everyone already here keeps every
 * recipe, and residents made after it start with the base and free picks. Once per world: a second
 * call is refused. Test servers only (`POST /v1/test/open-recipes`).
 */
export async function openRecipesOver(http: Http): Promise<void> {
  await expectOk(
    "open recipes (is the server running with TERRAKIN_TEST_CLOCK=1?)",
    http.call("POST", "/v1/test/open-recipes"),
  );
}

/**
 * Switch levels on in this world now (RFC 0029): everyone already here gets a first for each kind
 * in their collection book, and from then on deeds earn points. Once per world: a second call is
 * refused. Test servers only (`POST /v1/test/open-levels`).
 */
export async function openLevelsOver(http: Http): Promise<void> {
  await expectOk(
    "open levels (is the server running with TERRAKIN_TEST_CLOCK=1?)",
    http.call("POST", "/v1/test/open-levels"),
  );
}

/** Switch circles on now (RFC 0033), unless the world has them. Coins must be open. */
export async function openCirclesOver(http: Http): Promise<void> {
  const world = (await http.call("GET", "/v1/world")).body as { circlesOpen?: boolean };
  if (world.circlesOpen) return;
  await expectOk(
    "open circles (is the server running with TERRAKIN_TEST_CLOCK=1?)",
    http.call("POST", "/v1/test/open-circles"),
  );
}

/**
 * Open the next land beyond downtown now (RFC 0038), unless this world already has one, so a test
 * world has an island, the water round it, and the bridge across to look at. The count is what
 * opens one in a real world. Test servers only (`POST /v1/test/open-land`).
 */
export async function openLandOver(http: Http): Promise<void> {
  const world = (await http.call("GET", "/v1/world")).body as { lands?: unknown };
  if (world.lands) return;
  await expectOk(
    "open a land (is the server running with TERRAKIN_TEST_CLOCK=1?)",
    http.call("POST", "/v1/test/open-land"),
  );
}

/**
 * Put plots on sale in this world now (RFC 0039), with the plot cap at 3, opening the next land
 * first when there's none, since the market waits for one. No adapter sets the switch, so this is
 * the only way a world sells plots for now; once per world, so where it's on this does nothing.
 * Test servers only (`POST /v1/test/open-plot-market`).
 */
export async function openPlotMarketOver(http: Http): Promise<void> {
  const world = (await http.call("GET", "/v1/world")).body as { plotMarketOpen?: boolean };
  if (world.plotMarketOpen) return;
  await openLandOver(http);
  await expectOk(
    "open the plot market (is the server running with TERRAKIN_TEST_CLOCK=1?)",
    http.call("POST", "/v1/test/open-plot-market"),
  );
}

/**
 * Put clay out and let kilns fire pots in this world now (RFC 0047). Only the Worker sets the
 * switch, so this is how a test world gets pottery; once per world, so in a world where it's
 * already on this does nothing. Test servers only (`POST /v1/test/open-clay`).
 */
export async function openClayOver(http: Http): Promise<void> {
  const world = (await http.call("GET", "/v1/world")).body as { clayOpen?: boolean };
  if (world.clayOpen) return;
  await expectOk(
    "open clay (is the server running with TERRAKIN_TEST_CLOCK=1?)",
    http.call("POST", "/v1/test/open-clay"),
  );
}

/**
 * Switch the town's jobs on in this world now (RFC 0030), opening levels first when they aren't,
 * since jobs need them. The switch is once per world, so in a world where they're already open
 * this does nothing. Test servers only (`POST /v1/test/open-jobs`).
 */
export async function openJobsOver(http: Http): Promise<void> {
  const world = (await http.call("GET", "/v1/world")).body as {
    levelsOpen?: boolean;
    jobsOpen?: boolean;
  };
  if (world.jobsOpen) return;
  if (!world.levelsOpen) await openLevelsOver(http);
  await expectOk(
    "open jobs (is the server running with TERRAKIN_TEST_CLOCK=1?)",
    http.call("POST", "/v1/test/open-jobs"),
  );
}

/**
 * The most days `jobDayOver` moves the clock. Every job in the first edition that isn't held to a
 * season or a holiday comes up sooner: within 35 days from any day, the longest waits beside a
 * holiday, which takes every other turn of its lane.
 */
const JOB_DAY_MOST = 60;

/** The most days `POST /v1/test/advance-day` moves the clock in one call. */
const ADVANCE_MOST = 400;

/** Move the test clock on `days` days and answer the world's day after, or throw. */
async function advance(http: Http, days: number): Promise<number | null> {
  const moved = await http.call("POST", `/v1/test/advance-day?days=${days}`);
  if (moved.status !== 200) throw new Error("the clock didn't move: is this a test server?");
  return (moved.body as { day?: number | null }).day ?? null;
}

/**
 * Move the world's clock on, a day at a time, until `job` is on the board, and say how many days
 * that took (0 when it's up today). The board is a function of the day, so a spec or a person who
 * wants one job in particular has to be on a day that has it. It moves the clock for everyone:
 * only for a spec with a server of its own.
 *
 * A test world kept across restarts (`.dev-test-world/`) can be days ahead of the restarted test
 * clock, and the world's day never goes back, so a day on the clock moves nothing until it
 * catches up. The clock first catches up with the world's day, read from `GET /v1/world`.
 */
export async function jobDayOver(http: Http, job: string): Promise<number> {
  const world = (await http.call("GET", "/v1/world")).body as {
    day?: number;
    time?: { nowMs?: number };
  };
  // The server clock's UTC day, as the sim's `utcDay` reads it.
  const clockDay =
    world.time?.nowMs === undefined ? undefined : Math.floor(world.time.nowMs / 864e5);
  let behind = world.day === undefined || clockDay === undefined ? 0 : world.day - clockDay;
  while (behind > 0) {
    const step = Math.min(behind, ADVANCE_MOST);
    await advance(http, step);
    behind -= step;
  }
  let day = world.day ?? null;
  for (let days = 0; days <= JOB_DAY_MOST; days++) {
    const board = (await http.call("GET", "/v1/jobs")).body as { jobs?: { id: string }[] };
    if (board.jobs?.some((j) => j.id === job)) return days;
    const next = await advance(http, 1);
    if (day !== null && (next === null || next <= day)) {
      throw new Error(
        `The world's day stayed at ${day} when the clock moved a day on, so no other day's board can come up. Stop pnpm dev:test, delete .dev-test-world/, and start it again for a fresh test world.`,
      );
    }
    day = next;
  }
  throw new Error(`${job} didn't come up in ${JOB_DAY_MOST} days: are jobs open here?`);
}

/** A preset with a spec's own fields on top: `stage("stocked", { name: "Ivy", coins: 50 })`. */
export function stage(preset: PresetName, spec: PersonaSpec): PersonaSpec {
  const base: Omit<PersonaSpec, "name"> = PRESETS[preset];
  const stacks = { ...base.stacks, ...spec.stacks };
  return { ...base, ...spec, ...(Object.keys(stacks).length > 0 ? { stacks } : {}) };
}

/**
 * JavaScript that signs a page in as `p` and opens `path`, to run in a browser's console or with a
 * browser tool. It writes the same keys the app does (`savedToken` in `net.ts`).
 */
export function signInScript(p: Pick<Persona, "id" | "token">, path = "/world"): string {
  return [
    `localStorage.setItem("terrakin.token", ${JSON.stringify(p.token)});`,
    `localStorage.setItem("terrakin.resident", ${JSON.stringify(p.id)});`,
    `location.href = ${JSON.stringify(path)};`,
  ].join(" ");
}
