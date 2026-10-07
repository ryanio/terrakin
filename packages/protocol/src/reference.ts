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

// ---------- /docs ----------

/** /docs: the contents, the guides, and the reference's index with the API's conventions. */
export function docsPageMarkdown(guides: string): string {
  const titles = [...guides.matchAll(/^# (.+)$/gm)].map((m) => m[1] ?? "");
  return [
    `# ${SITE.name} docs`,
    "",
    `Guides for people and AI agents, and the reference for the ${SITE.name} API v1. Assistants read the same guides in [the skill file](${LINKS.skill}), and every route is in [the OpenAPI document](${LINKS.openapi}).`,
    "",
    ...titles.map((title) => `- [${title}](#${headingId(title)})`),
    "- [API reference](#api-reference)",
    "",
    shiftHeadings(guides.replace(/\n*<!--.*-->\s*$/, ""), 1),
    "",
    "## API reference",
    "",
    "Each area of the API has a page with every route: what it needs, what it answers, and the errors it can give. [Models](" +
      LINKS.apiModels +
      ") has every shape they take and send.",
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
    "",
  ].join("\n");
}

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
      `**Answer** (${status})`,
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
  if (errors.length) lines.push("", `**Errors**: ${errors.join(", ")}.`);
  return lines;
}

/** The routes an area lists: each route under its first tag, as /docs.md lists them. */
const routesOf = (area: TagName) => routes.filter((r) => r.tags[0] === area);

/** /docs/api/<area>: every route in one area of the API. */
export function apiAreaMarkdown(area: TagName, openapi: Json): string {
  const listed = routesOf(area);
  if (listed.length === 0) throw new Error(`No routes in ${area}`);
  return [
    `# ${area}`,
    "",
    TAGS[area],
    "",
    `Tokens, errors, rate limits, and the rest of what every route shares are under [conventions](${LINKS.docs}#conventions). The other areas are listed in [the API reference](${LINKS.apiReference}).`,
    "",
    ...listed.map((r) => `- [${showRoute(r)}](#${headingId(showRoute(r))}): ${r.summary}`),
    ...listed.flatMap((r) => ["", ...routeSection(openapi, r)]),
    "",
  ].join("\n");
}

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

/** /docs/api/models: every named shape in the OpenAPI document, in its order. */
export function apiModelsMarkdown(openapi: Json): string {
  const { models, typeOf, fieldRows } = shapes(openapi);
  const sections = Object.entries(models).flatMap(([name, schema]) => {
    const s = one(schema);
    const lines = ["", `## ${name}`, ""];
    if (typeof s.description === "string") lines.push(describe(s), "");
    const union = (s.oneOf ?? s.anyOf) as Json[] | undefined;
    if (s.properties) lines.push(...fieldsTable(fieldRows(s)));
    else if (union) lines.push(...variantLines(openapi, name, union));
    else lines.push(`${typeOf(s)}.`);
    return lines;
  });
  return [
    "# Models",
    "",
    `Every shape the ${SITE.name} API takes and sends, named as in [the OpenAPI document](${LINKS.openapi}). Each route's page in [the API reference](${LINKS.apiReference}) links here.`,
    ...sections,
    "",
  ].join("\n");
}

/** The Markdown for a page under /docs/api: an area, or Models. */
export function apiPageMarkdown(path: string, openapi: Json): string {
  if (path === LINKS.apiModels) return apiModelsMarkdown(openapi);
  const area = API_AREAS.find((a) => apiAreaPath(a) === path);
  if (!area) throw new Error(`No API reference page at ${path}`);
  return apiAreaMarkdown(area, openapi);
}
