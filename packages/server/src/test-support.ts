import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  Client,
  type ClientOptions,
  createTransport,
  getCurrentScope,
  setCurrentClient,
} from "@sentry/core";
import { responseProblem } from "@terrakin/protocol";
import { type Command, type Input, STOREYS, TOWN_ACTOR } from "@terrakin/sim";
import type { ApiOptions } from "./api";

/**
 * A world log, for a world with 8-tile plots, where `id` settles plot (0, 0), builds the starter
 * hut (walls from (1, 1) to (5, 5), the hearth at (3, 3)), and puts a loft over it (RFC 0028): a
 * storey bought with coins the town grants, a moss floor over the hut's middle, the hearth
 * included, and a window upstairs on a wall. Built with the sim's own commands, as a real log
 * holds them, so a test boots straight into a world with a loft. Boot a `WorldService` on a
 * `MemoryStore` holding it, and give `id` a token with `issueToken`.
 */
export function loftLog(id: string, name: string): Input[] {
  const town = (command: Command): Input => ({ actor: TOWN_ACTOR, command });
  const own = (command: Command): Input => ({ actor: id, command });
  const loft = [
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
  ] as const;
  return [
    town({ type: "new_day", day: 20_000 }),
    town({ type: "open_items" }),
    town({ type: "open_economy" }),
    own({ type: "join", name, kind: "agent" }),
    own({ type: "settle", px: 0, py: 0 }),
    own({ type: "build_starter_home" }),
    town({ type: "test_grant", to: id, coins: STOREYS.price }),
    own({ type: "add_storey", px: 0, py: 0 }),
    ...loft.map(([x, y]) => own({ type: "lay", x, y, storey: 1, ground: "moss" })),
    own({ type: "place", x: 1, y: 1, storey: 1, block: "glass" }),
  ];
}

/**
 * For tests: an `onResponse` hook that checks every REST response against the route table, and
 * the list of mismatches it found. Assert the list is empty after each test, so a schema that
 * drifts from what the server really sends fails the suite.
 */
export function responseChecker() {
  const problems: string[] = [];
  const onResponse: NonNullable<ApiOptions["onResponse"]> = (route, response) => {
    const problem = responseProblem(
      route,
      response.status,
      response.headers["content-type"],
      // Binary replies (letter images) are checked by their content type alone.
      typeof response.body === "string" ? response.body : "",
    );
    if (problem) problems.push(problem);
  };
  return { problems, onResponse };
}

/** What a test file runs after each test, newest first. */
export type Cleanup = () => void | Promise<void>;

/**
 * Start a test server on a free port, close it with the test's cleanups, and return its base URL.
 * It listens on 127.0.0.1, the address the tests dial. A server on every address (`::`) can be
 * handed a port that another program already holds on 127.0.0.1 alone (Tailscale's local API
 * does this on macOS), and then the other program answers the tests' requests.
 *
 * Idle connections stay open until the server closes. Node otherwise drops one after 6 seconds,
 * and a test that spends that long on setup can send its next request down the connection just
 * as the server drops it, which fails with ECONNRESET.
 */
export async function listenOnFreePort(server: Server, cleanups: Cleanup[]): Promise<string> {
  server.keepAliveTimeout = 0;
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  cleanups.push(() => new Promise<void>((done) => server.close(() => done())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * `call(method, path, body?, token?)` against a test server. Bytes go up as
 * `application/octet-stream`, anything else as JSON. The reply's `body` is the parsed JSON, the
 * raw text when the reply isn't JSON, or undefined when it's empty.
 */
export function jsonCaller(base: string) {
  return async (method: string, path: string, body?: unknown, token?: string) => {
    const isBytes = body instanceof Uint8Array;
    const res = await fetch(base + path, {
      method,
      headers: {
        "content-type": isBytes ? "application/octet-stream" : "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined
        ? {}
        : { body: isBytes ? new Blob([body as Uint8Array<ArrayBuffer>]) : JSON.stringify(body) }),
    });
    const text = await res.text();
    const isJson = res.headers.get("content-type")?.includes("json") ?? false;
    return {
      status: res.status,
      headers: res.headers,
      text,
      body: !text ? undefined : isJson ? JSON.parse(text) : text,
    };
  };
}

/** For tests: ABI answers a network would send, to feed a fake `ChainCall`. */
export const abi = {
  word: (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0"),
  address: (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`,
  string(text: string) {
    const bytes = new TextEncoder().encode(text);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
    return `0x${abi.word(32)}${abi.word(bytes.length)}${padded}`;
  },
  binding: (standard: number, bound: string, tokenId: number) =>
    `0x${abi.word(standard)}${bound.slice(2).toLowerCase().padStart(64, "0")}${abi.word(tokenId)}`,
  agentOf: (registered: boolean, agentId: number) =>
    `0x${abi.word(registered ? 1 : 0)}${abi.word(agentId)}`,
};

/**
 * The path of the confirm link a `GET /v1/join` page hands out (decision 0148). A test that joins
 * by link opens the join path, then this.
 */
export function confirmLinkIn(page: string): string {
  const url = /^Open: (\S+)$/m.exec(page)?.[1];
  if (!url) throw new Error(`No confirm link in:\n${page}`);
  const { pathname, search } = new URL(url);
  return pathname + search;
}

/**
 * For tests: a Sentry client that records what `report` and `gauge` in `telemetry.ts` hand it and
 * sends nothing. `start()` makes it the current client and empties the lists; `stop()` takes it
 * away again. Run them before and after each test, so no other test file sees it. `reports` holds
 * each reported error's message, `gauges` each gauge's name and value beside its attributes.
 */
export function recordTelemetry() {
  const reports: string[] = [];
  const gauges: Record<string, unknown>[] = [];
  class Recorder extends Client<ClientOptions> {
    // Public here: Client's own constructor is protected.
    constructor(options: ClientOptions) {
      super(options);
    }
    override captureException(err: unknown): string {
      reports.push(err instanceof Error ? err.message : String(err));
      return "";
    }
    eventFromException() {
      return Promise.resolve({});
    }
    eventFromMessage() {
      return Promise.resolve({});
    }
  }
  const client = new Recorder({
    integrations: [],
    stackParser: () => [],
    transport: (options) => createTransport(options, async () => ({})),
    beforeSendMetric: (metric) => {
      if (metric.type === "gauge") {
        gauges.push({ name: metric.name, value: metric.value, ...metric.attributes });
      }
      // Recorded, so never buffered or sent.
      return null;
    },
  });
  const clear = () => {
    reports.length = 0;
    gauges.length = 0;
  };
  return {
    reports,
    gauges,
    start() {
      clear();
      setCurrentClient(client);
    },
    stop() {
      getCurrentScope().setClient(undefined);
      clear();
    },
  };
}
