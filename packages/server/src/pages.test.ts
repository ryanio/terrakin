import { describe, expect, it } from "vitest";
import { askWorld, IMMUTABLE, pageHeaders, repeatable, worldRestarted } from "./pages";

describe("pageHeaders", () => {
  it("lets browsers keep only the build's hashed files for good", () => {
    expect(pageHeaders("/assets/reference-DXW_AsQ9.js", "text/javascript")).toEqual({
      "cache-control": IMMUTABLE,
    });
    expect(pageHeaders("/assets/docs-BXsBDB6I.css", "text/css")["cache-control"]).toBe(IMMUTABLE);
    // The single-page fallback under /assets/ is never immutable.
    expect(
      pageHeaders("/assets/gone-0000aaaa.js", "text/html; charset=utf-8")["cache-control"],
    ).toBe(undefined);
    // Pages and unhashed files revalidate.
    expect(pageHeaders("/docs", "text/html")["cache-control"]).toBe(undefined);
    expect(pageHeaders("/favicon.svg", "image/svg+xml")["cache-control"]).toBe(undefined);
    expect(pageHeaders("/brand/mark.svg", "image/svg+xml")["cache-control"]).toBe(undefined);
  });
});

describe("askWorld", () => {
  const lost = () => Object.assign(new Error("Network connection lost."), { retryable: true });
  const read = () => new Request("https://terrakin.org/v1/world");

  it("sends a read again when the world object was restarting", async () => {
    let tries = 0;
    const outcomes: string[] = [];
    const answer = await askWorld(
      () => {
        tries += 1;
        if (tries === 1) return Promise.reject(lost());
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
      { repeat: repeatable(read()), onLost: (_err, outcome) => outcomes.push(outcome) },
    );
    expect(tries).toBe(2);
    expect(answer?.status).toBe(200);
    expect(outcomes).toEqual(["retried"]);
  });

  it("sends a read again when the world object's answer broke as its body came", async () => {
    // The one error this reached Sentry as: a GET /v1/world whose stream died after its headers,
    // which the retry never saw because the call itself had already settled.
    const broke = () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"residents":'));
            c.error(lost());
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    let tries = 0;
    const outcomes: string[] = [];
    const answer = await askWorld(
      () => {
        tries += 1;
        return Promise.resolve(
          tries === 1 ? broke() : new Response('{"residents":[]}', { status: 200 }),
        );
      },
      { repeat: repeatable(read()), onLost: (_err, outcome) => outcomes.push(outcome) },
    );
    expect(tries).toBe(2);
    expect(outcomes).toEqual(["retried"]);
    // The answer comes back whole, body and headers, for the caller to pass on.
    expect(await answer?.text()).toBe('{"residents":[]}');
    expect(answer?.status).toBe(200);
  });

  it("keeps an answer's headers, and lets one with no body through untouched", async () => {
    const sent = new Response('{"ok":true}', {
      status: 201,
      headers: { "content-type": "application/json", "x-terrakin-worker-build": "abc" },
    });
    const answer = await askWorld(() => Promise.resolve(sent), {
      repeat: true,
      onLost: () => {},
    });
    expect(answer?.status).toBe(201);
    expect(answer?.headers.get("x-terrakin-worker-build")).toBe("abc");
    expect(await answer?.text()).toBe('{"ok":true}');
    // A socket upgrade and a 304 carry no body: nothing to read, and nothing that could break.
    const bodiless = new Response(null, { status: 304 });
    expect(
      await askWorld(() => Promise.resolve(bodiless), { repeat: true, onLost: () => {} }),
    ).toBe(bodiless);
  });

  it("refuses rather than retry a write, or a read whose second try broke too", async () => {
    const write = new Request("https://terrakin.org/v1/actions", { method: "POST", body: "{}" });
    let tries = 0;
    const outcomes: string[] = [];
    const send = () => {
      tries += 1;
      return Promise.reject(lost());
    };
    const onLost = (_err: unknown, outcome: string) => outcomes.push(outcome);
    expect(await askWorld(send, { repeat: repeatable(write), onLost })).toBe(undefined);
    expect(tries).toBe(1);
    expect(await askWorld(send, { repeat: repeatable(read()), onLost })).toBe(undefined);
    expect(tries).toBe(3);
    expect(outcomes).toEqual(["refused", "refused"]);
  });

  it("leaves a socket upgrade and a reopened connection to the client", () => {
    const upgrade = new Request("https://terrakin.org/v1/live", {
      headers: { upgrade: "WebSocket" },
    });
    expect(repeatable(upgrade)).toBe(false);
    expect(repeatable(read())).toBe(true);
    expect(worldRestarted(new Error("Connection closed: this Durable Object instance is no"))).toBe(
      true,
    );
    expect(worldRestarted(new Error("Cannot read properties of undefined"))).toBe(false);
  });

  it("passes the world object's own errors on, so a bug stays a bug", async () => {
    const boom = new TypeError("Cannot read properties of undefined (reading 'href')");
    await expect(
      askWorld(() => Promise.reject(boom), { repeat: true, onLost: () => {} }),
    ).rejects.toThrow(boom);
  });
});
