import { readFileSync } from "node:fs";
import {
  apply,
  CHAT_EARSHOT,
  type Command,
  canonicalJson,
  countOf,
  createWorld,
  DEFAULT_CONFIG,
  FURNITURE_KINDS,
  FURNITURE_RECIPES,
  fnv1a,
  GAME_RULES,
  GAMES,
  GROUND_INFO,
  GROUND_KINDS,
  groundCostWords,
  HAIR_COLORS,
  HAIR_STYLES,
  ITEM_INFO,
  ITEM_KINDS,
  PATTERNS,
  PET_COATS,
  PET_KINDS,
  PETS,
  PUTTER,
  SEASONS,
  SHOP_CATALOG,
  type ShopSku,
  type StackKind,
  spawnTile,
  THEMES,
  TOWN_ACTOR,
  WEAR_ITEMS,
  WEATHERS,
} from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { CATALOG_VIEW } from "./catalog";
import { catalogBlock, furnitureBlock, replaceGenerated, skillApiBlock } from "./docs";
import { GAME_TIMES, ordinal } from "./games";
import { buildOpenApi } from "./openapi";
import {
  compileRoutes,
  errorStatus,
  isReservedHandle,
  markdownError,
  markdownErrorCode,
  PUTTER_LIMITS,
  RATE_LIMITS,
  ROUTE_WORDS,
  ROUTES,
  type RouteSpec,
  responseProblem,
} from "./routes";
import { TakedownRequest } from "./safety";
import {
  ACTION_TYPES,
  Action,
  ClientMessage,
  CreateSessionRequest,
  ERROR_CODES,
  WorldEvent,
  WorldSnapshot,
} from "./schemas";
import { PAGES, type SitePage } from "./site";
import {
  findMentions,
  HANDLE_PATTERN,
  HandleInput,
  NotificationView,
  TakedownView,
  TERRAKIN_ACTOR,
  UpdateProfileRequest,
} from "./social";

/** The routes in the public documents: everything but Terrakin's internal staff routes. */
const PUBLIC_ROUTES = (ROUTES as readonly RouteSpec[]).filter((r) => !r.internal);

describe("mentions", () => {
  const handles = (text: string) => findMentions(text).map((m) => m.handle);

  it("finds handles next to punctuation, in any case, and says where they are", () => {
    expect(handles("(@wren), @Ash! @moss. @fern's @sky_2? @oak:")).toEqual([
      "wren",
      "ash",
      "moss",
      "fern",
      "sky_2",
      "oak",
    ]);
    expect(findMentions("hi @Wren!")).toEqual([{ handle: "wren", start: 3, end: 8 }]);
    expect(handles("@wren\n@ash")).toEqual(["wren", "ash"]);
  });

  it("skips emails, URLs, doubled signs, and tokens of the wrong shape", () => {
    expect(handles("mail a@bcd.com or wren@ash.org")).toEqual([]);
    expect(handles("https://example.com/@wren")).toEqual([]);
    expect(handles("@@wren")).toEqual([]);
    expect(handles("éa@wren")).toEqual([]);
    expect(handles("@ab @1wren @_wren")).toEqual([]);
    // Too long to be a handle: not cut down to one either.
    expect(handles(`@${"a".repeat(21)}`)).toEqual([]);
    expect(handles(`@${"a".repeat(20)}`)).toEqual(["a".repeat(20)]);
    expect(handles("@wrenñ")).toEqual([]);
  });

  it("keeps markup around a mention as plain text positions", () => {
    const text = "<b>@wren</b>";
    expect(findMentions(text)).toEqual([{ handle: "wren", start: 3, end: 8 }]);
  });
});

describe("handles", () => {
  it("accepts any case at the edge and stores lowercase", () => {
    expect(HandleInput.safeParse("Wren_2").success).toBe(true);
    expect(HandleInput.safeParse("2wren").success).toBe(false);
    expect(UpdateProfileRequest.safeParse({ handle: "ab" }).success).toBe(false);
    expect(HANDLE_PATTERN.test("wren_2")).toBe(true);
    expect(HANDLE_PATTERN.test("Wren")).toBe(false);
  });

  it("reserves every word in our URLs and staff-sounding names", () => {
    for (const word of ROUTE_WORDS) {
      if (HANDLE_PATTERN.test(word)) expect(isReservedHandle(word), word).toBe(true);
    }
    expect(ROUTE_WORDS).toEqual(expect.arrayContaining(["residents", "notifications", "handle"]));
    for (const word of ["admin", "terrakin", "townsfolk", "official", "terrakin_team", "admin2"]) {
      expect(isReservedHandle(word), word).toBe(true);
    }
    for (const word of ["wren", "moss_and_fern", "modern", "teammate"]) {
      expect(isReservedHandle(word), word).toBe(false);
    }
  });
});

const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");

describe("takedown notices", () => {
  const notice = {
    id: "n_1",
    type: "takedown",
    trust: "untrusted",
    actor: TERRAKIN_ACTOR,
    count: 1,
    postId: null,
    excerpt: "",
    system: true,
    takedown: {
      what: "listing",
      rule: "spam",
      outcome: "returned",
      id: "l_1",
      kind: "lemon_jam",
      count: 3,
    },
    read: false,
    createdAt: "2026-10-05T12:00:00.000Z",
  };

  it("parse as a notification whose actor is a stand-in no resident or handle can be", () => {
    expect(NotificationView.parse(notice)).toEqual(notice);
    expect(isReservedHandle(TERRAKIN_ACTOR.id)).toBe(true);
    expect(TERRAKIN_ACTOR.id).not.toMatch(/^r_/);
  });

  it("leave older notifications as they were: both new fields are optional", () => {
    const { system: _system, takedown: _takedown, ...plain } = notice;
    expect(NotificationView.parse({ ...plain, type: "follow" })).not.toHaveProperty("takedown");
  });

  it("only cite a rule from the report reasons, and say where the thing is", () => {
    expect(TakedownView.safeParse({ ...notice.takedown, rule: "rudeness" }).success).toBe(false);
    expect(TakedownView.safeParse({ ...notice.takedown, outcome: "gone" }).success).toBe(false);
    expect(
      TakedownView.safeParse({ what: "pictures", rule: "other", outcome: "removed" }).success,
    ).toBe(true);
  });

  it("let staff name the rule, or leave it to the reports", () => {
    expect(TakedownRequest.parse({ reason: "Slur", rule: "hate" })).toEqual({
      reason: "Slur",
      rule: "hate",
    });
    expect(TakedownRequest.parse({ reason: "Slur" })).toEqual({ reason: "Slur" });
    expect(TakedownRequest.safeParse({ reason: "Slur", rule: "rude" }).success).toBe(false);
  });
});

describe("SKILL.md stays in sync with the schemas", () => {
  it.each(ACTION_TYPES)("documents the %s action", (type) => {
    expect(skill).toContain(`### ${type}`);
  });

  it("states the chat earshot the server uses", () => {
    expect(skill).toContain(`within ${CHAT_EARSHOT} tiles`);
  });

  it.each(ERROR_CODES)("documents the %s error code", (code) => {
    expect(skill).toContain(`| \`${code}\` |`);
  });

  it("quotes the town shop's prices as the sim has them", () => {
    // "`lantern` 40", "`umbrella` 60": every price SKILL.md names next to a sku.
    const quoted = [...skill.matchAll(/`([a-z_]+)` (\d+)/g)].filter(([, sku]) =>
      Object.hasOwn(SHOP_CATALOG, sku ?? ""),
    );
    expect(quoted.length).toBeGreaterThanOrEqual(7);
    for (const [, sku, price] of quoted) {
      expect(Number(price), sku).toBe(SHOP_CATALOG[sku as ShopSku].price);
    }
  });

  it("lists every pet kind with the sim's coats, and the sim's grooming fee", () => {
    // "| `cat` | `ginger`, `tabby`, `black`, `calico` |": the Pets section's table.
    for (const kind of PET_KINDS) {
      const row = PET_COATS[kind].map((coat) => `\`${coat}\``).join(", ");
      expect(skill).toContain(`| \`${kind}\` | ${row} |`);
    }
    expect(skill).toContain(`a new coat for ${PETS.groomFee} coins`);
  });
});

describe("Action", () => {
  it("accepts valid actions and trims chat", () => {
    expect(Action.parse({ type: "chat", text: "  hi  " })).toEqual({ type: "chat", text: "hi" });
    expect(Action.safeParse({ type: "place", x: 1, y: 2, block: "stone" }).success).toBe(true);
  });

  it("rejects unknown types, bad blocks, and oversized chat", () => {
    expect(Action.safeParse({ type: "teleport", x: 1, y: 1 }).success).toBe(false);
    expect(Action.safeParse({ type: "place", x: 1, y: 2, block: "gold" }).success).toBe(false);
    expect(Action.safeParse({ type: "place", x: 1.5, y: 2, block: "wood" }).success).toBe(false);
    expect(Action.safeParse({ type: "chat", text: "x".repeat(281) }).success).toBe(false);
    expect(Action.safeParse({ type: "chat", text: "   " }).success).toBe(false);
  });
});

describe("settle, starter home, and sharing actions", () => {
  it("accepts the new actions", () => {
    expect(Action.parse({ type: "settle", px: 3, py: 2 })).toEqual({
      type: "settle",
      px: 3,
      py: 2,
    });
    expect(Action.parse({ type: "build_starter_home" })).toEqual({ type: "build_starter_home" });
    expect(
      Action.safeParse({ type: "build_starter_home", walls: "stone", windows: "leaf" }).success,
    ).toBe(true);
    expect(Action.safeParse({ type: "share_plot", with: "r_0123456789abcdef" }).success).toBe(true);
    expect(Action.safeParse({ type: "unshare_plot", with: "r_0123456789abcdef" }).success).toBe(
      true,
    );
    expect(Action.parse({ type: "release" })).toEqual({ type: "release" });
  });

  it("rejects bad plot coordinates, materials, and resident ids", () => {
    const bad = [
      { type: "settle", px: -1, py: 0 },
      { type: "settle", px: 1.5, py: 0 },
      { type: "settle", px: 1 },
      { type: "build_starter_home", walls: "gold" },
      { type: "build_starter_home", windows: 3 },
      { type: "share_plot" },
      { type: "share_plot", with: "" },
      { type: "unshare_plot", with: "x".repeat(65) },
    ];
    for (const action of bad)
      expect(Action.safeParse(action).success, JSON.stringify(action)).toBe(false);
  });

  it("parses the new events, and plots with or without co-owners", () => {
    for (const event of [
      { type: "plot_shared", px: 0, py: 0, residentId: "b" },
      { type: "plot_unshared", px: 0, py: 0, residentId: "b" },
      { type: "hearth_cleared", residentId: "b" },
      { type: "plot_released", px: 0, py: 0, ownerId: "a" },
    ]) {
      expect(WorldEvent.safeParse(event).success).toBe(true);
    }
    const snapshot = {
      v: 1,
      seq: 0,
      hash: "x",
      config: { width: 12, height: 12, plotSize: 4, maxPlotsPerResident: 1, reach: 2 },
      commons: { px: 1, py: 1 },
      residents: [],
      plots: [
        { px: 0, py: 0, ownerId: "a" },
        { px: 2, py: 0, ownerId: "c", coOwners: ["a", "b"] },
      ],
      blocks: [],
    };
    expect(WorldSnapshot.safeParse(snapshot).success).toBe(true);
  });
});

describe("looks", () => {
  it("accepts a look on the profile action, with null to clear", () => {
    const capri = {
      type: "profile",
      theme: "lemon",
      pattern: "citrus",
      wear: ["straw_hat", "basket"],
      patternMedia: "m_0123456789abcdef",
      homeArt: null,
      homeModel: "m_00000000000000bb",
      hair: "bun",
      hairColor: "blonde",
    };
    expect(Action.parse(capri)).toEqual(capri);
    expect(
      Action.safeParse({ type: "profile", theme: null, wear: [], hair: null, hairColor: null })
        .success,
    ).toBe(true);
  });

  it("takes garment styles, a null to clear one, and a null to clear them all", () => {
    const good = [
      { wear: ["dress", "socks"], wearStyle: { dress: { pattern: "citrus", color: "sun" } } },
      { wearStyle: { socks: null, skirt: { pattern: "own" } } },
      { wearStyle: null },
    ];
    for (const fields of good) {
      expect(Action.safeParse({ type: "profile", ...fields }).success, JSON.stringify(fields)).toBe(
        true,
      );
    }
  });

  it("rejects unknown choices, too much to wear, and anything but an upload id", () => {
    const bad = [
      { theme: "pizza" },
      { pattern: "plaid" },
      { wear: ["cape"] },
      { wear: ["straw_hat", "apron", "basket", "skirt", "socks", "bow"] },
      { wearStyle: { cape: { pattern: "dots" } } },
      { wearStyle: { dress: { pattern: "plaid" } } },
      { wearStyle: { dress: { color: "#ff0000" } } },
      { wearStyle: { dress: { pattern: "dots", glow: true } } },
      { patternMedia: "/media/m_0123456789abcdef" },
      { homeArt: "https://example.com/home.png" },
      { homeModel: "m_0123" },
      { hair: "mullet" },
      { hair: "none" },
      { hairColor: "sun" },
      { hairColor: "#ff0000" },
    ];
    for (const fields of bad) {
      expect(Action.safeParse({ type: "profile", ...fields }).success, JSON.stringify(fields)).toBe(
        false,
      );
    }
  });

  it("takes theme, pattern, wear, and hair (not media) when joining", () => {
    const joined = CreateSessionRequest.parse({
      name: "Capri",
      kind: "human",
      theme: "lemon",
      wear: ["straw_hat"],
      hair: "curly",
      hairColor: "auburn",
      homeArt: "m_0123456789abcdef",
    });
    expect(joined).toEqual({
      name: "Capri",
      kind: "human",
      theme: "lemon",
      wear: ["straw_hat"],
      hair: "curly",
      hairColor: "auburn",
    });
  });

  it("parses residents and profile_changed with or without a look", () => {
    const resident = {
      id: "r_1",
      name: "Capri",
      kind: "human",
      color: "sun",
      shape: "round",
      note: "",
      x: 1,
      y: 2,
      online: true,
      hearth: null,
    };
    expect(WorldEvent.safeParse({ type: "joined", resident }).success).toBe(true);
    expect(
      WorldEvent.safeParse({
        type: "joined",
        resident: { ...resident, theme: "lemon", wear: ["beret"], homeArt: "m_0123456789abcdef" },
      }).success,
    ).toBe(true);
    const changed = { type: "profile_changed", residentId: "r_1", color: "sun", shape: "round" };
    expect(WorldEvent.safeParse({ ...changed, note: "" }).success).toBe(true);
    expect(WorldEvent.safeParse({ ...changed, note: "", pattern: "citrus" }).success).toBe(true);
  });

  it("gives putter's numbers as the sim and server use them", () => {
    expect(skill).toContain(`up to ${PUTTER.steps} tiles`);
    expect(skill).toContain(`within ${PUTTER.seek} tiles`);
    expect(skill).toContain(`${PUTTER_LIMITS.perDay} times a UTC day`);
  });

  it("says a place in words", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "101st",
      "111th",
      "112th",
    ]);
  });

  it("gives the games' numbers as the sim and the server's clock use them", () => {
    const { hearth_race: race, lowest_lantern: lantern } = GAME_RULES;
    const section = skill.slice(skill.indexOf("## Games"), skill.indexOf("## Town Hall"));
    for (const words of [
      `${GAME_TIMES.roundSeconds.live} seconds a round`,
      `${GAME_TIMES.roundSeconds.slow / 3600} hours a round`,
      `${GAME_TIMES.waitMinutes.live} minutes (live) or ${GAME_TIMES.waitMinutes.slow / 60} hours (slow)`,
      `${GAME_TIMES.startGraceMinutes.live} minutes (live) or ${GAME_TIMES.startGraceMinutes.slow} minutes (slow) after the table had enough`,
      `(${race.minSeats} to ${race.maxSeats} seats). A track of ${race.goal} spaces`,
      `in ${race.roundsMax} rounds`,
      `(${lantern.minSeats} to ${lantern.maxSeats} seats)`,
      `a number from 1 to ${lantern.moves.length}`,
      `sit at ${GAMES.seatsMax} tables at once`,
      `Miss ${GAMES.awayAfter} rounds in a row`,
      `open ${GAME_TIMES.awayWaitSeconds.live} seconds (live) or ${GAME_TIMES.awayWaitSeconds.slow / 60} minutes (slow)`,
      `Everyone starts at ${GAMES.ratingStart.toLocaleString("en-US")}`,
      `past ${GAMES.pairPerDay} in a UTC day or ${GAMES.pairPerWeek} in a UTC week`,
      `past ${GAMES.ratedPerDay} in a UTC day`,
      `${GAME_TIMES.townsfolkAfterMinutes === 60 ? "an hour" : `${GAME_TIMES.townsfolkAfterMinutes} minutes`} after it opened`,
    ]) {
      expect(section).toContain(words);
    }
  });

  it("documents every theme, pattern, wear item, hair style and color, weather, and season in SKILL.md", () => {
    for (const id of [
      ...THEMES,
      ...PATTERNS,
      ...WEAR_ITEMS,
      ...HAIR_STYLES,
      ...HAIR_COLORS,
      ...WEATHERS,
      ...SEASONS,
    ]) {
      expect(skill).toContain(`\`${id}\``);
    }
  });
});

describe("ClientMessage", () => {
  it("parses hello and action envelopes", () => {
    expect(
      ClientMessage.safeParse({ type: "hello", v: 1, name: "Wren", kind: "agent" }).success,
    ).toBe(true);
    expect(
      ClientMessage.safeParse({ type: "action", id: "a1", action: { type: "claim" } }).success,
    ).toBe(true);
    expect(
      ClientMessage.safeParse({ type: "action", action: { type: "claim", extra: 1 } }).success,
    ).toBe(true);
    expect(ClientMessage.safeParse({ type: "nope" }).success).toBe(false);
  });
});

describe("route table", () => {
  const table = ROUTES as readonly RouteSpec[];

  it("has unique ids and unique method + path pairs", () => {
    expect(new Set(table.map((r) => r.id)).size).toBe(table.length);
    const keys = table.flatMap((r) =>
      [r.path, ...(r.aliases ?? [])].map((p) => `${r.method} ${p}`),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(table)("$id declares what its auth, limits, and inputs can return", (route) => {
    const declared = [...(route.path.matchAll(/\{(\w+)\}/g) ?? [])].map((m) => m[1]);
    expect(Object.keys(route.params?.shape ?? {})).toEqual(declared);
    if (route.auth === "bearer" || route.auth === "linkKey") {
      expect(route.errors).toContain("unauthorized");
    }
    if (route.rateLimit) expect(route.errors).toContain("rate_limited");
    if (route.rateLimit && RATE_LIMITS[route.rateLimit].scope === "resident") {
      expect(["bearer", "linkKey"]).toContain(route.auth);
    }
    // A link key travels in the path, and only Markdown link routes take one.
    if (route.auth === "linkKey") {
      expect(declared[0]).toBe("key");
      expect(route.format).toBe("markdown");
    }
    // Repeats are recognized by resident, so a `once` route needs to know who's calling.
    if (route.once) expect(route.auth).toBe("linkKey");
    if (route.format === "markdown") {
      expect(route.method).toBe("GET");
      for (const spec of Object.values(route.responses)) {
        expect(spec).toMatchObject({ kind: "text", contentType: "text/markdown" });
      }
    }
    if (route.body) expect(route.errors).toContain("bad_request");
    // A required query parameter is refused with bad_request when it's missing.
    const required = Object.values(route.query?.shape ?? {}).some(
      (field) =>
        !(field as { safeParse: (v: unknown) => { success: boolean } }).safeParse(undefined)
          .success,
    );
    if (required) expect(route.errors).toContain("bad_request");
    expect(route.summary).not.toMatch(/[\u2013\u2014]/);
    expect(route.description ?? "").not.toMatch(/[\u2013\u2014]/);
  });

  it("matches paths, aliases, and parameters", () => {
    const match = compileRoutes(table);
    expect(match("GET", "/v1/posts/p_1")).toMatchObject({
      route: { id: "getPost" },
      params: { id: "p_1" },
    });
    expect(match("GET", "/skill.md")?.route.id).toBe("getSkill");
    expect(match("GET", "/v1/openapi.json")?.route.id).toBe("getOpenApi");
    expect(match("GET", "/v1/openapiXjson")).toBeUndefined();
    expect(match("GET", "/v1/posts/")).toBeUndefined();
    expect(match("GET", "/v1/posts/a/b")).toBeUndefined();
    expect(match("PATCH", "/v1/profile")).toBeUndefined();
    expect(match("GET", "/v1/act/k_abc/settle")).toMatchObject({
      route: { id: "linkSettle" },
      params: { key: "k_abc" },
    });
    expect(match("GET", "/v1/act/k_abc/nope")).toBeUndefined();
  });

  it("flags responses that drift from the table", () => {
    const health = table.find((r) => r.id === "getHealth");
    const ok = { ok: true, v: 1, seq: 0, hash: "x", online: 0 };
    const check = (status: number, body: unknown, type = "application/json") =>
      responseProblem(health, status, type, JSON.stringify(body));
    expect(check(200, ok)).toBeUndefined();
    expect(check(200, { ...ok, extra: 1 })).toMatch(/field \$\.extra/);
    expect(check(200, { ...ok, seq: "0" })).toBeDefined();
    expect(check(201, ok)).toMatch(/undeclared status/);
    expect(check(500, { error: { code: "internal", message: "x" } })).toBeUndefined();
    expect(check(404, { error: { code: "not_found", message: "x" } })).toMatch(/undeclared/);
    expect(check(400, { error: { code: "not_found", message: "x" } })).toMatch(/should be 404/);
  });

  it("checks Markdown errors by their code line", () => {
    const settle = table.find((r) => r.id === "linkSettle");
    const md = "text/markdown; charset=utf-8";
    const check = (status: number, body: string, type = md) =>
      responseProblem(settle, status, type, body);
    expect(check(400, markdownError("bad_request", "px: Use a whole number."))).toBeUndefined();
    expect(check(401, markdownError("unauthorized", "x", "help"))).toBeUndefined();
    expect(check(404, markdownError("not_found", "x"))).toMatch(/undeclared error code/);
    expect(check(429, markdownError("bad_request", "x"))).toMatch(/should be 400/);
    expect(check(400, "# Not done\n\nno code")).toMatch(/no error code line/);
    expect(check(400, markdownError("bad_request", "x"), "application/json")).toMatch(
      /content type/,
    );
    expect(check(200, "# Settled\n")).toBeUndefined();
    expect(markdownErrorCode(markdownError("plot_owned", "Taken."))).toBe("plot_owned");
  });
});

describe("OpenAPI", () => {
  const doc = buildOpenApi();
  const ops = Object.entries(doc.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, op]) => ({ path, method, op })),
  );

  it("has exactly one operation per route, named by its id", () => {
    expect(
      ops.map((o) => `${o.method.toUpperCase()} ${o.path} ${o.op.operationId}`).sort(),
    ).toEqual(PUBLIC_ROUTES.map((r) => `${r.method} ${r.path} ${r.id}`).sort());
  });

  it("documents every declared response and error status", () => {
    for (const route of PUBLIC_ROUTES) {
      const op = doc.paths[route.path]?.[route.method.toLowerCase()];
      const statuses = Object.keys(op?.responses as object);
      for (const status of Object.keys(route.responses)) expect(statuses).toContain(status);
      for (const code of [...route.errors, "internal" as const]) {
        expect(statuses).toContain(String(errorStatus(code)));
      }
      expect(op?.security).toEqual(
        route.auth === "none" || route.auth === "linkKey"
          ? []
          : expect.arrayContaining([{ bearer: [] }]),
      );
    }
  });

  it("names every schema it references and describes the WebSocket", () => {
    const text = JSON.stringify(doc);
    for (const [, name] of text.matchAll(/"#\/components\/schemas\/(\w+)"/g)) {
      expect(doc.components.schemas).toHaveProperty(name as string);
    }
    expect(doc.components.schemas).toHaveProperty("ClientMessage");
    expect(doc.components.schemas).toHaveProperty("ServerMessage");
    expect(doc["x-websocket"].path).toBe("/v1/live");
    expect(text).toContain('"place"');
  });

  it("matches the committed snapshot (run `pnpm gen` if not)", () => {
    const snapshot = readFileSync(new URL("../openapi.json", import.meta.url), "utf8");
    expect(JSON.parse(snapshot)).toEqual(JSON.parse(JSON.stringify(doc)));
  });
});

describe("internal routes", () => {
  const internal = (ROUTES as readonly RouteSpec[]).filter((r) => r.internal);
  const repo = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const published = [
    "protocol/openapi.json",
    "protocol/SKILL.md",
    "client/public/llms.txt",
    "client/public/docs.md",
    "client/public/docs/llms.txt",
    "client/public/sitemap-pages.xml",
    "client/public/.well-known/ard.json",
    "client/public/.well-known/api-catalog",
    "client/public/.well-known/agent-skills/index.json",
    "client/src/docs/guides.generated.md",
    "CHANGELOG.md",
    ...(PAGES as readonly SitePage[]).flatMap((p) => (p.prose ? [`docs/site/${p.prose}.md`] : [])),
  ];

  it("covers every staff route, and only staff routes", () => {
    expect(internal.length).toBeGreaterThan(0);
    for (const route of ROUTES as readonly RouteSpec[]) {
      expect(route.internal === true, route.id).toBe(route.auth === "staff");
    }
  });

  it("never appear in anything published", () => {
    const paths = internal.flatMap((r) => [r.path, r.path.replace(/\{(\w+)\}/g, "<$1>")]);
    for (const file of published) {
      const text = repo(file);
      for (const path of paths) expect(text, `${path} in ${file}`).not.toContain(path);
      for (const word of ["/v1/admin", "admin.terrakin.org", "AdminOverview", "StaffRole"]) {
        expect(text, `${word} in ${file}`).not.toContain(word);
      }
    }
    expect(JSON.stringify(buildOpenApi())).not.toContain("/v1/admin");
  });
});

describe("generated API reference", () => {
  it("is current in SKILL.md (run `pnpm gen` if not)", () => {
    expect(replaceGenerated(skill, skillApiBlock(), "SKILL.md")).toBe(skill);
    expect(replaceGenerated(skill, catalogBlock(), "SKILL.md", "catalog")).toBe(skill);
    expect(replaceGenerated(skill, furnitureBlock(), "SKILL.md", "furniture")).toBe(skill);
  });
});

describe("GET /v1/catalog", () => {
  const kind = (k: string) => CATALOG_VIEW.kinds.find((x) => x.kind === k);

  it("says where each kind fits, how it grows, what the shop asks, and what it goes into", () => {
    expect(kind("lemon")).toMatchObject({
      family: "fruit",
      path: ["food", "fruit"],
      category: "produce",
      crop: { seed: "lemon_seed", days: 4, yield: 3, seeds: 1 },
      usedIn: ["lemon_jam", "lemonade"],
    });
    expect(kind("lemon_seed")).toMatchObject({ grows: "lemon", shop: { price: 4 } });
    expect(kind("pumpkin_seed")?.shop).toEqual({ price: 4, seasons: ["autumn"] });
    expect(kind("table")).toMatchObject({ path: ["decor", "furniture"], category: "furniture" });
    expect(kind("piece")).toMatchObject({ path: ["art"], category: "good" });
    expect(kind("piece")).not.toHaveProperty("recipe");
  });

  it("lists every kind a family recipe makes with its own recipe for craft", () => {
    expect(kind("strawberry_jam")?.recipe).toEqual({
      station: "kitchen",
      needs: [
        { kind: "strawberry", count: 3 },
        { kind: "sugar", count: 1 },
        { kind: "jar", count: 1 },
      ],
      familyRecipe: "jam",
    });
    const [jam] = CATALOG_VIEW.familyRecipes;
    expect(jam).toMatchObject({ id: "jam", name: "Jam", family: "fruit", count: 3 });
    for (const made of jam?.makes ?? []) expect(kind(made)?.recipe?.familyRecipe).toBe("jam");
    expect(CATALOG_VIEW.kinds.map((k) => k.kind)).toEqual(ITEM_KINDS);
  });

  it("is versioned by a hash of everything else in it, 8 hex characters long", () => {
    const { version, ...rest } = CATALOG_VIEW;
    // A new field joins the hash, so the version changes whenever anything an agent reads does.
    expect(Object.keys(rest)).toEqual(["families", "kinds", "familyRecipes"]);
    const { families, kinds, familyRecipes } = CATALOG_VIEW;
    expect(version).toBe(fnv1a(canonicalJson({ families, kinds, familyRecipes })));
    expect(version).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("SKILL.md starter home", () => {
  it("builds on the default world exactly as written", () => {
    expect(skill).toContain(
      "stand at (19, 11), build the outline of (17, 9) to (21, 13), leave (19, 13) open",
    );
    const world = createWorld(DEFAULT_CONFIG);
    const act = (command: Command) => {
      const result = apply(world, { actor: "muse", command });
      expect(result, JSON.stringify(command)).toMatchObject({ ok: true });
    };
    act({ type: "join", name: "Wren", kind: "agent" });

    // Walk from spawn to the center of the hut on plot (2, 1), then claim.
    const S = DEFAULT_CONFIG.plotSize;
    const [x0, y0] = [2 * S + 1, 1 * S + 1];
    const spawn = spawnTile(DEFAULT_CONFIG);
    for (let x = spawn.x; x > x0 + 2; x--) act({ type: "move", dir: "w" });
    for (let y = spawn.y; y > y0 + 2; y--) act({ type: "move", dir: "n" });
    act({ type: "claim" });

    let placed = 0;
    for (let x = x0; x <= x0 + 4; x++) {
      for (let y = y0; y <= y0 + 4; y++) {
        const edge = x === x0 || x === x0 + 4 || y === y0 || y === y0 + 4;
        const door = x === x0 + 2 && y === y0 + 4;
        if (edge && !door) {
          act({ type: "place", x, y, block: "wood" });
          placed++;
        }
      }
    }
    expect(placed).toBe(15);
    act({ type: "set_hearth", x: x0 + 2, y: y0 + 2 });
    act({ type: "move", dir: "s" });
    act({ type: "move", dir: "s" });
    expect(world.residents.muse).toMatchObject({ x: x0 + 2, y: y0 + 4 });
    act({ type: "home" });
    expect(world.residents.muse).toMatchObject({ x: x0 + 2, y: y0 + 2 });
  });
});

describe("SKILL.md building", () => {
  it("names what each path and floor takes, as the sim has it", () => {
    for (const kind of GROUND_KINDS) {
      expect(skill).toContain(
        `| \`${kind}\` | ${GROUND_INFO[kind].name} | ${groundCostWords(kind)} |`,
      );
    }
  });

  it("names what each piece of furniture is made from, as the sim has it", () => {
    for (const kind of FURNITURE_KINDS) {
      const made = (Object.entries(FURNITURE_RECIPES[kind].needs) as [StackKind, number][])
        .map(([need, n]) => countOf(need, n))
        .join(" and ");
      expect(skill).toContain(`| \`${kind}\` | ${ITEM_INFO[kind].name} | ${made} |`);
    }
  });

  it("has plans that build whole on a starter-home plot with a first planter", () => {
    const section = skill.slice(skill.indexOf("## Build: paths, furniture, and plans"));
    const plans = [...section.matchAll(/```json\n(\{"type": "build"[\s\S]*?)\n```/g)].map(
      ([, json]) => JSON.parse(json as string) as Extract<Command, { type: "build" }>,
    );
    expect(plans.length).toBe(3);
    for (const plan of plans) {
      const world = createWorld(DEFAULT_CONFIG);
      const act = (actor: string, command: Command) => {
        const result = apply(world, { actor, command });
        expect(result, JSON.stringify(command)).toMatchObject({ ok: true });
      };
      act(TOWN_ACTOR, { type: "new_day", day: 20_000 });
      act(TOWN_ACTOR, { type: "open_items" });
      act("muse", { type: "join", name: "Wren", kind: "agent" });
      act("muse", { type: "settle", px: plan.px, py: plan.py });
      act("muse", { type: "build_starter_home" });
      const S = DEFAULT_CONFIG.plotSize;
      act("muse", { type: "place", x: plan.px * S + 2, y: plan.py * S + 2, block: "planter" });
      // Hand her plenty of everything a plan could use.
      const inv = world.items?.inventories.muse;
      if (!inv) throw new Error("the first pantry fills her things");
      for (const kind of ["wood", "stone", "herb", "flower", ...FURNITURE_KINDS] as StackKind[]) {
        inv.stacks[kind] = 10;
      }
      // Off the hearth, so nothing is skipped for her standing on a tile.
      const muse = world.residents.muse;
      if (!muse) throw new Error("she joined");
      Object.assign(muse, { x: 0, y: 0 });
      const built = apply(world, { actor: "muse", command: plan });
      expect(built, JSON.stringify(plan)).toMatchObject({ ok: true });
      const placed = built.ok ? built.events.filter((e) => e.type === "block_placed").length : 0;
      const laid = built.ok ? built.events.filter((e) => e.type === "ground_laid").length : 0;
      expect(placed + laid).toBe((plan.blocks?.length ?? 0) + (plan.ground?.length ?? 0));
    }
  });
});

describe("SKILL.md Town Hall", () => {
  it("has a Commons build that files on the default world and builds whole when it passes", () => {
    const section = skill.slice(skill.indexOf("## Town Hall"));
    const [json] = [...section.matchAll(/```json\n(\{"type": "propose"[\s\S]*?)\n```/g)].map(
      ([, text]) => text as string,
    );
    if (!json) throw new Error("SKILL.md's Town Hall has no example build");
    const parsed = Action.parse(JSON.parse(json));
    if (parsed.type !== "propose") throw new Error("the example isn't a proposal");
    const { dry, ...command } = parsed;
    expect(dry).toBe(true);
    const world = createWorld(DEFAULT_CONFIG);
    const act = (actor: string, command: Command) => {
      const result = apply(world, { actor, command });
      expect(result, JSON.stringify(command)).toMatchObject({ ok: true });
      return result.ok ? result.events : [];
    };
    act(TOWN_ACTOR, { type: "new_day", day: 20_000 });
    const plots: [number, number][] = [
      [2, 1],
      [3, 1],
      [5, 1],
    ];
    for (const [i, [px, py]] of plots.entries()) {
      act(`r${i}`, { type: "join", name: `R${i}`, kind: "agent" });
      act(`r${i}`, { type: "settle", px, py });
      act(`r${i}`, { type: "build_starter_home" });
    }
    // The shop is open, and a newcomer stands where everyone arrives, on the path's tile.
    act(TOWN_ACTOR, { type: "open_economy" });
    act(TOWN_ACTOR, { type: "open_items" });
    act(TOWN_ACTOR, { type: "open_shop" });
    act("newcomer", { type: "join", name: "Wren", kind: "human" });
    expect(world.residents.newcomer).toMatchObject(spawnTile(DEFAULT_CONFIG));
    act(TOWN_ACTOR, { type: "new_day", day: 20_003 });
    act("r0", command as Command);
    for (const voter of ["r0", "r1", "r2"]) {
      act(voter, { type: "vote", proposal: "t_1", choice: "yes" });
    }
    act(TOWN_ACTOR, { type: "new_day", day: 20_005 });
    const built = act(TOWN_ACTOR, { type: "close_proposal", proposal: "t_1" }).at(-1);
    expect(built).toMatchObject({
      type: "town_built",
      placed: command.blocks,
      laid: command.ground,
      skipped: [],
    });
  });
});

describe("SKILL.md first visit garden", () => {
  it("places a planter and plants from the hearth, as written", () => {
    expect(skill).toContain("that corner is `x = px*S + 2`, `y = py*S + 2`");
    const world = createWorld(DEFAULT_CONFIG);
    const act = (actor: string, command: Command) => {
      const result = apply(world, { actor, command });
      expect(result, JSON.stringify(command)).toMatchObject({ ok: true });
    };
    act(TOWN_ACTOR, { type: "new_day", day: 20_000 });
    act(TOWN_ACTOR, { type: "open_economy" });
    act(TOWN_ACTOR, { type: "open_items" });
    act("muse", { type: "join", name: "Wren", kind: "agent" });
    act("muse", { type: "settle", px: 2, py: 1 });
    act("muse", { type: "build_starter_home" });
    // The hut set the hearth under her, which already paid today's coins and the first seeds.
    expect(apply(world, { actor: "muse", command: { type: "home" } })).toMatchObject({
      ok: false,
      rejection: { code: "already_home" },
    });
    const S = DEFAULT_CONFIG.plotSize;
    const [x, y] = [2 * S + 2, 1 * S + 2];
    act("muse", { type: "place", x, y, block: "planter" });
    act("muse", { type: "plant", x, y, seed: "flower" });
  });
});

describe("build_starter_home", () => {
  it("builds the same layout as the SKILL.md recipe with glass windows", () => {
    const S = DEFAULT_CONFIG.plotSize;
    const [x0, y0] = [2 * S + 1, 1 * S + 1];
    const actor = (world: ReturnType<typeof createWorld>) => (command: Command) => {
      const result = apply(world, { actor: "muse", command });
      expect(result, JSON.stringify(command)).toMatchObject({ ok: true });
    };

    // By hand: walk, claim, place 15 blocks with windows, set the hearth.
    const manual = createWorld(DEFAULT_CONFIG);
    const byHand = actor(manual);
    byHand({ type: "join", name: "Wren", kind: "agent" });
    const spawn = spawnTile(DEFAULT_CONFIG);
    for (let x = spawn.x; x > x0 + 2; x--) byHand({ type: "move", dir: "w" });
    for (let y = spawn.y; y > y0 + 2; y--) byHand({ type: "move", dir: "n" });
    byHand({ type: "claim" });
    for (let x = x0; x <= x0 + 4; x++) {
      for (let y = y0; y <= y0 + 4; y++) {
        const edge = x === x0 || x === x0 + 4 || y === y0 || y === y0 + 4;
        const door = x === x0 + 2 && y === y0 + 4;
        const window = (x === x0 || x === x0 + 4) && y === y0 + 2;
        if (edge && !door) byHand({ type: "place", x, y, block: window ? "glass" : "wood" });
      }
    }
    byHand({ type: "set_hearth", x: x0 + 2, y: y0 + 2 });

    // In two actions: settle lands on the hearth tile, then the server builds the rest.
    const quick = createWorld(DEFAULT_CONFIG);
    const twoSteps = actor(quick);
    twoSteps({ type: "join", name: "Wren", kind: "agent" });
    twoSteps({ type: "settle", px: 2, py: 1 });
    expect(quick.residents.muse).toMatchObject({ x: 19, y: 11 });
    twoSteps({ type: "build_starter_home" });

    expect(quick.blocks).toEqual(manual.blocks);
    expect(Object.keys(quick.blocks)).toHaveLength(15);
    expect(quick.plots).toEqual(manual.plots);
    expect(quick.residents.muse).toEqual(manual.residents.muse);
  });
});

describe("WorldSnapshot time anchor", () => {
  const base = {
    v: 1,
    seq: 0,
    hash: "x",
    config: { width: 12, height: 12, plotSize: 4, maxPlotsPerResident: 1, reach: 2 },
    commons: { px: 1, py: 1 },
    residents: [],
    plots: [],
    blocks: [],
  };

  it("accepts a snapshot without a time anchor and rejects a non-positive day length", () => {
    const good = { ...base, time: { nowMs: 1_700_000_000_000, dayLengthMs: 600_000 } };
    expect(WorldSnapshot.safeParse(good).success).toBe(true);
    const { time, ...noTime } = good;
    expect(WorldSnapshot.safeParse(noTime).success).toBe(true);
    expect(WorldSnapshot.safeParse({ ...good, time: { nowMs: 1, dayLengthMs: 0 } }).success).toBe(
      false,
    );
  });
});
