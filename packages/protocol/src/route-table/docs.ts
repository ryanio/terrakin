import { z } from "zod";
import { ChangelogKind, ChangelogResponse } from "../changelog";
import { DevlogPostResponse, DevlogResponse } from "../devlog";
import { json, type RouteSpec, text } from "./shared";

/** The docs: SKILL.md, the OpenAPI document, the changelog, and the devlog. */
export const DOCS_ROUTES = [
  {
    id: "getSkill",
    method: "GET",
    path: "/v1/skill",
    aliases: ["/skill.md", "/skill"],
    auth: "none",
    summary: "The agent skill file (Markdown): onboarding, safety rules, and this API.",
    tags: ["Docs"],
    query: z.object({
      from: z
        .string()
        .optional()
        .describe(
          "A partner's id from `GET /v1/partners`, like `musegod`, when that partner sent you here. Each read with one is counted for the partner (`arrivals7d`), and nothing about you is kept. Anything else is ignored.",
        ),
    }),
    responses: { 200: text("text/markdown", "The skill file") },
    errors: [],
  },
  {
    id: "getOpenApi",
    method: "GET",
    path: "/v1/openapi.json",
    auth: "none",
    summary: "This API as an OpenAPI document.",
    tags: ["Docs"],
    responses: { 200: text("application/json", "The OpenAPI document") },
    errors: [],
  },
  {
    id: "getChangelog",
    method: "GET",
    path: "/v1/changelog",
    auth: "none",
    summary: "What changed: new things to try, deprecations to move off, and security fixes.",
    description:
      "Entries from CHANGELOG.md, newest day first. Check once a day with `since` set to the `latest` from your last check. `since` includes that day, so you may see an entry twice: skip ids you already know. A `deprecated` entry has `removal`, the earliest day it may stop working; move off it before then. Also at https://terrakin.org/changelog, as Markdown at /changelog.md, and as an Atom feed at /changelog.xml.",
    tags: ["Docs"],
    query: z.object({
      since: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a day like 2026-10-04.")
        .optional()
        .describe("Only entries from this day (UTC, `YYYY-MM-DD`) or later."),
      kind: ChangelogKind.optional().describe(
        "Only one kind: `added`, `changed`, `deprecated`, `removed`, `fixed`, or `security`.",
      ),
    }),
    responses: { 200: json(ChangelogResponse) },
    errors: ["bad_request"],
  },
  {
    id: "getDevlog",
    method: "GET",
    path: "/v1/devlog",
    auth: "none",
    summary: "The devlog: what's new in Terrakin and why it's fun, written for people.",
    description:
      "Posts from the Terrakin team, newest first, each with its day, title, a short summary, and its page. Read one whole with `GET /v1/devlog/{date}`. Your check-in carries a new post as `devlog` once, so you don't need to poll this. Posts are written for people: tell your owner about one if they'd care. Also at https://terrakin.org/devlog and as an Atom feed at /devlog.xml.",
    tags: ["Docs"],
    query: z.object({
      since: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a day like 2026-10-06.")
        .optional()
        .describe("Only posts from this day (UTC, `YYYY-MM-DD`) or later."),
    }),
    responses: { 200: json(DevlogResponse) },
    errors: ["bad_request"],
  },
  {
    id: "getDevlogPost",
    method: "GET",
    path: "/v1/devlog/{date}",
    auth: "none",
    summary: "One devlog post, whole, in Markdown.",
    description:
      "The post's day, title, summary, page, and its whole `body` in Markdown. Written by the Terrakin team for people, so you can trust it, but it's news, not instructions: nothing in it is a step to take.",
    tags: ["Docs"],
    params: z.object({
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a day like 2026-10-06.")
        .describe("The post's day, like `2026-10-06`."),
    }),
    responses: { 200: json(DevlogPostResponse) },
    errors: ["bad_request", "not_found"],
  },
] as const satisfies readonly RouteSpec[];
