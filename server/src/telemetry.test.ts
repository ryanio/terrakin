import type { Breadcrumb, ErrorEvent, StreamedSpanJSON } from "@sentry/core";
import { describe, expect, it } from "vitest";
import {
  BACKGROUND_SAMPLE_RATE,
  FORCED_TRACES_PER_MINUTE,
  ForcedTraceBudget,
  scrubText,
  sentryOptions,
  TRACES_SAMPLE_RATE,
  templatePath,
} from "./telemetry";

const TOKEN = "Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4cXV1eHF1dXhxdXg";
const LINK_KEY = `k_${TOKEN}`;
const TRACE_ID = "0123456789abcdef0123456789abcdef";

const options = sentryOptions("https://key@example.ingest.sentry.io/1", "v1");

describe("templatePath", () => {
  it("names API paths by their route template", () => {
    expect(templatePath("/v1/posts/p_0123456789abcdef")).toBe("/v1/posts/{id}");
    expect(templatePath("/v1/residents/by-handle/ada?x=1")).toBe(
      "/v1/residents/by-handle/{handle}",
    );
    expect(templatePath(`/v1/act/${LINK_KEY}/say`)).not.toContain(LINK_KEY);
    expect(templatePath("/v1/health")).toBe("/v1/health");
  });

  it("templates page, card, and media paths", () => {
    expect(templatePath("/r/r_0123456789abcdef/3d")).toBe("/r/{id}/3d");
    expect(templatePath("/u/ada")).toBe("/u/{handle}");
    expect(templatePath("/claim/abcd-efgh-jkmn-pqrs")).toBe("/claim/{code}");
    expect(templatePath("/i/xyz123")).toBe("/i/{code}");
    expect(templatePath("/og/post/p_0123456789abcdef.png")).toBe("/og/post/{id}.png");
    expect(templatePath("/media/m_0123456789abcdef")).toBe("/media/{id}");
    expect(templatePath(`/v1/act/${LINK_KEY}/nowhere`)).toBe("/v1/act/{key}/nowhere");
  });

  it("keeps plain paths and asset names", () => {
    expect(templatePath("/docs")).toBe("/docs");
    expect(templatePath("/assets/index-B1x2y3z4.js")).toBe("/assets/index-B1x2y3z4.js");
  });
});

describe("scrubText", () => {
  it("removes tokens, link keys, codes, ids, handles, and query strings", () => {
    const text = `Bearer ${TOKEN} at /v1/act/${LINK_KEY}/say?text=hi for r_0123456789abcdef by /u/ada, code abcd-efgh-jkmn-pqrs, ${TOKEN}`;
    const out = scrubText(text);
    for (const secret of [
      TOKEN,
      LINK_KEY,
      "r_0123456789abcdef",
      "/u/ada",
      "abcd-efgh",
      "text=hi",
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain("/v1/act/{key}/say");
  });

  it("removes invite codes in paths", () => {
    expect(scrubText("GET /v1/invites/abcdefgh2345 failed")).toBe("GET /v1/invites/{code} failed");
    expect(scrubText("/v1/owner/invites/abcdefghjkmnpqrs")).toBe("/v1/owner/invites/{code}");
  });

  it("leaves ordinary messages alone", () => {
    expect(scrubText("Cannot read properties of undefined (reading 'x')")).toBe(
      "Cannot read properties of undefined (reading 'x')",
    );
  });
});

describe("sentryOptions", () => {
  it("sends nothing without a DSN", () => {
    expect(sentryOptions(undefined, undefined).dsn).toBeUndefined();
  });

  it("collects no personal data", () => {
    expect(options.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    });
  });

  it("samples background work less than requests, and follows a parent that said no", () => {
    const sample = sentryOptions(undefined, undefined, new ForcedTraceBudget()).tracesSampler;
    if (!sample) throw new Error("no sampler");
    const base = { attributes: {}, inheritOrSampleWith: (n: number) => n };
    expect(sample({ ...base, name: "world.sweep" })).toBe(BACKGROUND_SAMPLE_RATE);
    expect(sample({ ...base, name: "world.run" })).toBe(BACKGROUND_SAMPLE_RATE);
    expect(sample({ ...base, name: "GET /v1/feed" })).toBe(TRACES_SAMPLE_RATE);
    expect(sample({ ...base, name: "GET /v1/feed", parentSampled: false })).toBe(false);
  });

  it("caps the traces a caller's sentry-trace header can force", () => {
    let now = 0;
    const sample = sentryOptions(
      undefined,
      undefined,
      new ForcedTraceBudget(() => now),
    ).tracesSampler;
    if (!sample) throw new Error("no sampler");
    const forced = {
      name: "GET /v1/feed",
      parentSampled: true,
      attributes: {},
      inheritOrSampleWith: (n: number) => n,
    };
    for (let i = 0; i < FORCED_TRACES_PER_MINUTE; i++) expect(sample(forced)).toBe(true);
    // Over the cap, a forged "sampled" flag gets the ordinary rate, not every request.
    expect(sample(forced)).toBe(TRACES_SAMPLE_RATE);
    now += 60_000;
    expect(sample(forced)).toBe(true);
  });

  it("scrubs error events but keeps what links them to a trace", async () => {
    const event = {
      event_id: TRACE_ID,
      transaction: `GET /v1/act/${LINK_KEY}/say`,
      user: { ip_address: "203.0.113.9" },
      request: {
        method: "POST",
        url: `https://terrakin.org/v1/posts/p_0123456789abcdef?token=${TOKEN}`,
        headers: { authorization: `Bearer ${TOKEN}` },
        data: { text: "hello from ada" },
        query_string: `token=${TOKEN}`,
      },
      contexts: {
        trace: { trace_id: TRACE_ID, span_id: "0123456789abcdef" },
        culture: { timezone: "Europe/Lisbon" },
      },
      exception: { values: [{ type: "Error", value: `bad key ${LINK_KEY}` }] },
      breadcrumbs: [{ category: "api", message: "POST /v1/posts", data: { status: 500 } }],
    } as unknown as ErrorEvent;
    const out = await options.beforeSend?.(event, {});
    const json = JSON.stringify(out);
    for (const secret of [
      TOKEN,
      LINK_KEY,
      "203.0.113.9",
      "hello from ada",
      "p_0123456789abcdef",
      "Lisbon",
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(out?.user).toBeUndefined();
    expect(out?.request).toEqual({ method: "POST", url: "https://terrakin.org/v1/posts/{id}" });
    expect(out?.transaction).toBe("GET /v1/act/{key}/say");
    expect(out?.event_id).toBe(TRACE_ID);
    expect(out?.contexts?.trace?.trace_id).toBe(TRACE_ID);
    expect(out?.breadcrumbs?.[0]?.data).toEqual({ status: 500 });
  });

  it("scrubs span names and attributes", () => {
    const s = {
      trace_id: TRACE_ID,
      span_id: "0123456789abcdef",
      name: `GET /v1/act/${LINK_KEY}/say`,
      start_timestamp: 0,
      status: "ok",
      is_segment: true,
      attributes: {
        "url.full": `https://terrakin.org/r/r_0123456789abcdef?with=${TOKEN}`,
        "client.address": "203.0.113.9",
        "http.request.header.authorization": `Bearer ${TOKEN}`,
        "terrakin.route": "act",
        "culture.timezone": "Europe/Lisbon",
      },
    } as StreamedSpanJSON;
    const out = options.beforeSendSpan?.(s);
    expect(out?.name).toBe("GET /v1/act/{key}/say");
    expect(out?.attributes).toEqual({
      "url.full": "https://terrakin.org/r/{id}",
      "terrakin.route": "act",
    });
    expect(out?.trace_id).toBe(TRACE_ID);
  });

  it("never lets a staff sign-in or email out, in spans or in errors", async () => {
    const jwt = `eyJhbGciOiJSUzI1NiJ9.${TOKEN}.${TOKEN}`;
    const s = {
      trace_id: TRACE_ID,
      span_id: "0123456789abcdef",
      name: "POST /v1/admin/reports/dismiss",
      start_timestamp: 0,
      status: "ok",
      is_segment: true,
      attributes: {
        "http.request.header.cf-access-jwt-assertion": jwt,
        "http.request.header.x-terrakin-staff-email": "mod@example.com",
        cf_authorization: jwt,
        "terrakin.note": "dismissed by access:Mod.Person+t@example.co.uk",
      },
    } as StreamedSpanJSON;
    const span = JSON.stringify(options.beforeSendSpan?.(s));
    const event = {
      event_id: TRACE_ID,
      exception: { values: [{ type: "Error", value: "No staff role for ryan@example.com" }] },
      request: { headers: { "x-terrakin-staff-email": "ryan@example.com" } },
      extra: { "cf-access-jwt-assertion": jwt },
    } as unknown as ErrorEvent;
    const error = JSON.stringify(await options.beforeSend?.(event, {}));
    for (const out of [span, error]) {
      for (const secret of ["example.com", "example.co.uk", "Mod.Person", "eyJhbGci", TOKEN]) {
        expect(out).not.toContain(secret);
      }
    }
    expect(error).toContain("No staff role for {email}");
  });

  it("names a method-only request span by its templated path", () => {
    const s = {
      trace_id: TRACE_ID,
      span_id: "0123456789abcdef",
      name: "GET",
      start_timestamp: 0,
      status: "ok",
      is_segment: true,
      attributes: { "url.path": "/r/r_0123456789abcdef", "sentry.segment.name": "GET" },
    } as StreamedSpanJSON;
    const out = options.beforeSendSpan?.(s);
    expect(out?.name).toBe("GET /r/{id}");
    expect(out?.attributes["sentry.segment.name"]).toBe("GET /r/{id}");
  });

  it("drops console breadcrumbs and templates request URLs", () => {
    const console = { category: "console", message: "hello from ada" } as Breadcrumb;
    expect(options.beforeBreadcrumb?.(console)).toBeNull();
    const fetch = {
      category: "fetch",
      data: { url: `https://terrakin.org/v1/act/${LINK_KEY}/look?x=1`, status_code: 200 },
    } as Breadcrumb;
    expect(options.beforeBreadcrumb?.(fetch)?.data).toEqual({
      url: "https://terrakin.org/v1/act/{key}/look",
      status_code: 200,
    });
  });

  it("scrubs logs", () => {
    const log = {
      level: "error" as const,
      message: `Failed for /v1/act/${LINK_KEY}/say`,
      attributes: { token: TOKEN },
    };
    expect(options.beforeSendLog?.(log)).toEqual({
      level: "error",
      message: "Failed for /v1/act/{key}/say",
      attributes: {},
    });
  });
});
