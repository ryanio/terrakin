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

/**
 * Unclaimed plots, skipping the Commons. The search starts in `corner` and goes a row at a time,
 * so specs that run side by side ask for different corners.
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
  };
  const { width, height, plotSize } = world.config;
  const taken = new Set(world.plots.map((p) => `${p.px},${p.py}`));
  taken.add(`${world.commons.px},${world.commons.py}`);
  const span = (size: number, backwards: boolean) => {
    const all = Array.from({ length: size / plotSize }, (_, i) => i);
    return backwards ? all.reverse() : all;
  };
  const out: [number, number][] = [];
  for (const py of span(height, corner !== "top-right")) {
    for (const px of span(width, corner !== "bottom-left")) {
      if (out.length < n && !taken.has(`${px},${py}`)) out.push([px, py]);
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
    out.plot = await settleFreeOver(http, who.token, await freePlotsOver(http, 5));
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
