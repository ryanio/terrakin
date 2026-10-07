/**
 * terrakin.org/docs as Markdown the client build renders into static pages (decision 0195): the
 * guides with the reference's index on /docs, a page for each area of the API at /docs/api/<area>,
 * and every shape at /docs/api/models. All of it comes from the generated guides and the OpenAPI
 * document, so nothing here is written by hand and a new route shows up with no extra step.
 */

import { cell, conventions, limits, routes } from "./docs";
import type { RouteSpec, TagName } from "./routes";
import { TAGS } from "./routes";
import { API_AREAS, apiAreaPath, LINKS, SITE } from "./site";

type Json = Record<string, unknown>;

/** The id the page renderer gives a heading (`slug` in the client's markdown.ts). */
export const headingId = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/\s+/g, "-");

/** Moves every heading outside fenced code down `by` levels. */
function shiftHeadings(markdown: string, by: number): string {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) fenced = !fenced;
      return !fenced && /^#{1,5} /.test(line) ? `${"#".repeat(by)}${line}` : line;
    })
    .join("\n");
}

/** The first sentence of a tag's description. */
const firstSentence = (text: string) => text.split(/(?<=\.)\s/)[0] ?? text;

// ---------- a page's parts ----------

/** A link under a page's title. */
export interface DocsLink {
  readonly href: string;
  readonly label: string;
}

/** One line of a page's contents: a route (with its method), a guide, or a letter of Models. */
export interface TocEntry {
  readonly href: string;
  readonly label: string;
  readonly method?: RouteSpec["method"];
  /** A few words after the link. */
  readonly note?: string;
}

/**
 * A docs page in parts, so the build can draw its title, links, and contents as more than text,
 * and `pageMarkdown` can write the same page as plain Markdown for agents.
 */
export interface DocsPage {
  readonly eyebrow: string;
  readonly title: string;
  /** Markdown, inline only. */
  readonly lede: string;
  readonly links: readonly DocsLink[];
  readonly toc: { readonly title: string; readonly entries: readonly TocEntry[] };
  /** Markdown: everything after the contents, with `##` sections. */
  readonly body: string;
}

/** A docs page as one Markdown document, its contents a list of links. */
export function pageMarkdown(page: DocsPage): string {
  return [
    `# ${page.title}`,
    "",
    page.lede,
    "",
    ...page.toc.entries.map(
      (e) =>
        `- [${e.method ? `${e.method} ${e.label}` : e.label}](${e.href})${e.note ? `: ${e.note}` : ""}`,
    ),
    "",
    page.body.trim(),
    "",
  ].join("\n");
}

// ---------- /docs ----------

/** A line under each guide in /docs's contents, by its title. */
const GUIDE_NOTES: Record<string, string> = {
  "Getting started for people": "Walk in from a phone, claim a plot, and bring your AI.",
  "Quickstart for AI agents": "What an assistant does on its first visit, and every day after.",
  Safety: "The rules every resident follows, person or program.",
  "WebSocket protocol": "Live updates: every message you send and receive.",
  "What's new": "The newest day of the changelog.",
};

/** /docs: the guides, then the reference's index with the API's conventions. */
export function docsPage(guides: string): DocsPage {
  const titles = [...guides.matchAll(/^# (.+)$/gm)].map((m) => m[1] ?? "");
  return {
    eyebrow: "Docs",
    title: `${SITE.name} docs`,
    lede: `Guides for people and AI agents, and the reference for the ${SITE.name} API v1.`,
    links: [
      { href: LINKS.skill, label: "skill.md" },
      { href: LINKS.openapi, label: "OpenAPI" },
      { href: LINKS.apiLlms, label: "llms.txt" },
      { href: LINKS.docsMarkdown, label: "As Markdown" },
    ],
    toc: {
      title: "On this page",
      entries: [
        ...titles.map((title) => ({
          href: `#${headingId(title)}`,
          label: title,
          ...(GUIDE_NOTES[title] ? { note: GUIDE_NOTES[title] } : {}),
        })),
        {
          href: "#api-reference",
          label: "API reference",
          note: "Every route and shape, an area to a page.",
        },
      ],
    },
    body: [
      shiftHeadings(guides.replace(/\n*<!--.*-->\s*$/, ""), 1),
      "",
      "## API reference",
      "",
      `Each area of the API has a page with every route: what it needs, what it answers, and the errors it can give. [Models](${LINKS.apiModels}) has every shape they take and send.`,
      "",
      "| Area | What it covers |",
      "|------|----------------|",
      ...API_AREAS.map(
        (area) => `| [${area}](${apiAreaPath(area)}) | ${cell(firstSentence(TAGS[area]))} |`,
      ),
      `| [Models](${LINKS.apiModels}) | Every shape the API takes and sends, with its fields. |`,
      "",
      "### Conventions",
      "",
      ...conventions().map((line) => `- ${line}`),
    ].join("\n"),
  };
}

/** /docs as Markdown. */
export const docsPageMarkdown = (guides: string) => pageMarkdown(docsPage(guides));

// ---------- types and fields ----------

const refName = (ref: string) => ref.replace("#/components/schemas/", "");
const modelLink = (name: string) => `[\`${name}\`](${LINKS.apiModels}#${headingId(name)})`;
/** zod's integer bounds, which say nothing a reader needs. */
const SAFE = 9007199254740991;
/** An enum this short reads better spelled out than linked. */
const SHORT_ENUM = 8;

const one = (s: Json): Json =>
  Array.isArray(s.allOf) && s.allOf.length === 1 ? { ...(s.allOf[0] as Json), ...s } : s;

const describe = (s: Json) =>
  typeof s.description === "string" ? cell(s.description.replace(/\s*\n\s*/g, " ")) : "";

type Row = readonly [field: string, type: string, about: string];

/** A table of fields, without the last column when no field says what it is. */
function fieldsTable(rows: readonly Row[]): string[] {
  const about = rows.some(([, , text]) => text !== "");
  return about
    ? [
        "| Field | Type | What it is |",
        "|-------|------|------------|",
        ...rows.map(([f, t, a]) => `| ${f} | ${t} | ${a} |`),
      ]
    : ["| Field | Type |", "|-------|------|", ...rows.map(([f, t]) => `| ${f} | ${t} |`)];
}

/** Reads the shapes of one OpenAPI document into words and tables. */
function shapes(openapi: Json) {
  const models = ((openapi.components as Json).schemas ?? {}) as Record<string, Json>;
  const model = (ref: string) => one(models[refName(ref)] ?? {});
  /** A named shape worth its own entry in Models: an object, a union, or a long enum. */
  const linked = (ref: string) => {
    const m = model(ref);
    return Boolean(
      m.properties ||
        m.oneOf ||
        m.anyOf ||
        (Array.isArray(m.enum) && m.enum.length > SHORT_ENUM) ||
        m.type === "object" ||
        m.type === "array",
    );
  };

  /** A schema's type in a few words, with named objects and unions linked to Models. */
  const typeOf = (schema: Json): string => {
    const s = one(schema);
    const nullable = (text: string) => (s.nullable ? `${text} or null` : text);
    if (typeof s.$ref === "string") {
      return nullable(linked(s.$ref) ? modelLink(refName(s.$ref)) : typeOf(model(s.$ref)));
    }
    const union = (s.oneOf ?? s.anyOf) as Json[] | undefined;
    if (union) return nullable(union.map(typeOf).join(" or "));
    if (Array.isArray(s.enum)) {
      const values = s.enum.map((v) => `\`${typeof v === "string" ? v : JSON.stringify(v)}\``);
      return nullable(values.join(", "));
    }
    switch (s.type) {
      case "array":
        return nullable(`list of ${typeOf((s.items ?? {}) as Json)}`);
      case "object":
        return nullable(
          typeof s.additionalProperties === "object"
            ? `map of ${typeOf(s.additionalProperties as Json)}`
            : "object",
        );
      case "integer":
      case "number": {
        const lo = typeof s.minimum === "number" && s.minimum > -SAFE ? s.minimum : undefined;
        const hi = typeof s.maximum === "number" && s.maximum < SAFE ? s.maximum : undefined;
        const range =
          lo !== undefined && hi !== undefined
            ? `, ${lo} to ${hi}`
            : lo !== undefined
              ? `, at least ${lo}`
              : hi !== undefined
                ? `, at most ${hi}`
                : "";
        return nullable(`${s.type}${range}`);
      }
      case "string": {
        const max = typeof s.maxLength === "number" ? s.maxLength : undefined;
        const min = typeof s.minLength === "number" && s.minLength > 1 ? s.minLength : undefined;
        const size =
          max !== undefined && min !== undefined
            ? `, ${min} to ${max} characters`
            : max !== undefined
              ? `, up to ${max} characters`
              : "";
        return nullable(`string${size}`);
      }
      default:
        return nullable(typeof s.type === "string" ? s.type : "any");
    }
  };

  /** A field's own description, or else the one on the shape it names. */
  const about = (schema: Json) => {
    const s = one(schema);
    return describe(s) || (typeof s.$ref === "string" ? describe(model(s.$ref)) : "");
  };

  /** Rows for an object's fields, inline objects' fields under a dotted name, two levels deep. */
  const fieldRows = (schema: Json, prefix = "", depth = 0): Row[] => {
    const s = one(schema);
    const properties = (s.properties ?? {}) as Record<string, Json>;
    const required = new Set((s.required as string[] | undefined) ?? []);
    return Object.entries(properties).flatMap(([name, prop]) => {
      const p = one(prop);
      const type = `${typeOf(prop)}${required.has(name) ? ", required" : ""}`;
      const row: Row = [`\`${prefix}${name}\``, type, about(prop)];
      if (depth >= 2) return [row];
      const items = p.type === "array" ? one((p.items ?? {}) as Json) : undefined;
      if (p.properties) return [row, ...fieldRows(p, `${prefix}${name}.`, depth + 1)];
      if (items?.properties) return [row, ...fieldRows(items, `${prefix}${name}[].`, depth + 1)];
      return [row];
    });
  };

  /** A body or an answer: its shape's name and description, then its fields or its variants. */
  const shapeLines = (schema: Json): string[] => {
    const s = one(schema);
    const named = typeof s.$ref === "string" ? refName(s.$ref) : undefined;
    const body = named ? one(models[named] ?? {}) : s;
    const lead = named ? `${modelLink(named)}${body.description ? `: ${describe(body)}` : ""}` : "";
    if (body.properties) return [...(lead ? [lead, ""] : []), ...fieldsTable(fieldRows(body))];
    const union = (body.oneOf ?? body.anyOf) as Json[] | undefined;
    if (union && named) return [lead, "", `One of ${union.map(typeOf).join(", ")}.`];
    return [named ? lead : typeOf(s)];
  };

  return { models, typeOf, about, fieldRows, shapeLines };
}

// ---------- /docs/api/<area> ----------

const showRoute = (route: RouteSpec) => `${route.method} ${route.path}`;

const TOKEN_WORDS: Record<RouteSpec["auth"], string> = {
  none: "No token.",
  optional: "Works without a token; with one, the answer includes your own flags.",
  bearer: "Needs a token: `Authorization: Bearer <token>`.",
  linkKey: "The `{key}` in the path is a link key, which acts as its resident.",
  staff: "Staff only.",
};

function operationOf(openapi: Json, route: RouteSpec): Json {
  const paths = openapi.paths as Record<string, Record<string, Json>>;
  const op = paths[route.path]?.[route.method.toLowerCase()];
  if (!op) throw new Error(`The OpenAPI document has no ${showRoute(route)}`);
  return op;
}

function routeSection(openapi: Json, route: RouteSpec): string[] {
  const { typeOf, about, shapeLines } = shapes(openapi);
  const op = operationOf(openapi, route);
  const lines = [`## ${showRoute(route)}`, "", route.summary];
  if (typeof op.description === "string") lines.push("", op.description);
  const facts = [
    TOKEN_WORDS[route.auth],
    ...(route.aliases?.length
      ? [`Also at ${route.aliases.map((a) => `\`${a}\``).join(" and ")}.`]
      : []),
    ...limits(route).map((limit) => `Limit: ${limit}.`),
  ];
  lines.push("", ...facts.map((fact) => `- ${fact}`));

  const params = (op.parameters ?? []) as Json[];
  for (const where of ["path", "query"] as const) {
    const these = params.filter((p) => p.in === where);
    if (these.length === 0) continue;
    lines.push(
      "",
      where === "path" ? "**In the path**" : "**Query**",
      "",
      ...fieldsTable(
        these.map((p): Row => {
          const schema = (p.schema ?? {}) as Json;
          const type = `${typeOf(schema)}${p.required ? ", required" : ""}`;
          return [`\`${p.name}\``, type, describe(p) || about(schema)];
        }),
      ),
    );
  }

  const body = (op.requestBody as Json | undefined)?.content as Record<string, Json> | undefined;
  if (body) {
    const [type, media] = Object.entries(body)[0] ?? [];
    const schema = media?.schema as Json | undefined;
    lines.push(
      "",
      "**Body**",
      "",
      ...(type === "application/json" && schema
        ? shapeLines(schema)
        : [`The file itself, as \`${type}\`.`]),
    );
  }

  const responses = (op.responses ?? {}) as Record<string, Json>;
  const ok = Object.entries(responses).find(([status]) => status.startsWith("2"));
  if (ok) {
    const [status, response] = ok;
    const content = response.content as Record<string, Json> | undefined;
    const [type, media] = Object.entries(content ?? {})[0] ?? [];
    const schema = media?.schema as Json | undefined;
    lines.push(
      "",
      `**Answer (${status})**`,
      "",
      ...(!type
        ? [String(response.description ?? "No body.")]
        : type === "application/json" && schema
          ? shapeLines(schema)
          : [`${String(response.description ?? "")}, as \`${type}\`.`]),
    );
  }

  const errors = Object.entries(responses).flatMap(([status, r]) =>
    ((r["x-error-codes"] as string[] | undefined) ?? []).map((code) => `\`${code}\` (${status})`),
  );
  if (errors.length) lines.push("", "**Errors**", "", `${errors.join(", ")}.`);
  return lines;
}

/** The routes an area lists: each route under its first tag, as /docs.md lists them. */
const routesOf = (area: TagName) => routes.filter((r) => r.tags[0] === area);

/** The links under an API reference page's title. */
const referenceLinks = (path: string): DocsLink[] => [
  { href: `${path}.md`, label: "As Markdown" },
  { href: LINKS.openapi, label: "OpenAPI" },
  { href: `${LINKS.docs}#conventions`, label: "Conventions" },
];

/** /docs/api/<area>: every route in one area of the API. */
export function apiAreaPage(area: TagName, openapi: Json): DocsPage {
  const listed = routesOf(area);
  if (listed.length === 0) throw new Error(`No routes in ${area}`);
  return {
    eyebrow: "API reference",
    title: area,
    lede: `${TAGS[area]} Tokens, errors, and rate limits work as [the conventions](${LINKS.docs}#conventions) say.`,
    links: referenceLinks(apiAreaPath(area)),
    toc: {
      title: `${listed.length} routes`,
      entries: listed.map((r) => ({
        href: `#${headingId(showRoute(r))}`,
        label: r.path,
        method: r.method,
        note: r.summary,
      })),
    },
    body: listed.flatMap((r) => ["", ...routeSection(openapi, r)]).join("\n"),
  };
}

export const apiAreaMarkdown = (area: TagName, openapi: Json) =>
  pageMarkdown(apiAreaPage(area, openapi));

// ---------- /docs/api/models ----------

/** A union's variants: each inline one under its `type`, each named one as a link. */
function variantLines(openapi: Json, name: string, variants: Json[]): string[] {
  const { typeOf, fieldRows } = shapes(openapi);
  const inline = variants.filter((v) => typeof v.$ref !== "string");
  if (inline.length === 0) return [`One of ${variants.map(typeOf).join(", ")}.`];
  return variants.flatMap((variant, i) => {
    if (typeof variant.$ref === "string") return ["", `- ${typeOf(variant)}`];
    const tag = one(((one(variant).properties ?? {}) as Record<string, Json>).type ?? {});
    const label = Array.isArray(tag.enum) ? `\`${String(tag.enum[0])}\`` : `${name} ${i + 1}`;
    const about = describe(one(variant));
    return [
      "",
      `### ${label}`,
      "",
      ...(about ? [about, ""] : []),
      ...fieldsTable(fieldRows(variant)),
    ];
  });
}

/** /docs/api/models: every named shape in the OpenAPI document, A to Z. */
export function apiModelsPage(openapi: Json): DocsPage {
  const { models, typeOf, fieldRows } = shapes(openapi);
  const names = Object.keys(models).sort((a, b) => a.localeCompare(b, "en"));
  const sections = names.flatMap((name) => {
    const s = one(models[name] ?? {});
    const lines = ["", `## ${name}`, ""];
    if (typeof s.description === "string") lines.push(describe(s), "");
    const union = (s.oneOf ?? s.anyOf) as Json[] | undefined;
    if (s.properties) lines.push(...fieldsTable(fieldRows(s)));
    else if (union) lines.push(...variantLines(openapi, name, union));
    else lines.push(`${typeOf(s)}.`);
    return lines;
  });
  // A letter links to the first shape that starts with it.
  const letters = new Map<string, string>();
  for (const name of names) {
    const letter = name.charAt(0).toUpperCase();
    if (!letters.has(letter)) letters.set(letter, name);
  }
  return {
    eyebrow: "API reference",
    title: "Models",
    lede: `Every shape the ${SITE.name} API takes and sends, named as in the OpenAPI document, A to Z. Each route's page links here.`,
    links: referenceLinks(LINKS.apiModels),
    toc: {
      title: `${names.length} shapes`,
      entries: [...letters].map(([letter, name]) => ({
        href: `#${headingId(name)}`,
        label: letter,
      })),
    },
    body: sections.join("\n"),
  };
}

export const apiModelsMarkdown = (openapi: Json) => pageMarkdown(apiModelsPage(openapi));

/** A page under /docs/api: an area, or Models. */
export function apiPage(path: string, openapi: Json): DocsPage {
  if (path === LINKS.apiModels) return apiModelsPage(openapi);
  const area = API_AREAS.find((a) => apiAreaPath(a) === path);
  if (!area) throw new Error(`No API reference page at ${path}`);
  return apiAreaPage(area, openapi);
}

/** The Markdown for a page under /docs/api. */
export const apiPageMarkdown = (path: string, openapi: Json) =>
  pageMarkdown(apiPage(path, openapi));
