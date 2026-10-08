/**
 * zod's classic schemas carry the code that turns a schema into JSON Schema (`toJSONSchema` and a
 * processor for each schema type), because every schema type hooks it in when it's built. The app
 * only parses and never asks for JSON Schema, so the client build gives zod a stand-in for those
 * two modules (decision 0231). Only `aggregateChecks`, which a schema's `minLength` and friends
 * read, stays real.
 */

/** The modules `zod/v4/classic/schemas.js` imports the JSON Schema code from. */
export const JSON_SCHEMA_MODULES = {
  processors: "../core/json-schema-processors.js",
  toJsonSchema: "../core/to-json-schema.js",
} as const;

const NONE =
  'const none = () => { throw new Error("The app is built without JSON Schema (decision 0231)."); };';

/**
 * The stand-in for the processors: the real `aggregateChecks` from `real`, and every other name
 * that `classicSource` (zod's classic schemas) reads off the module, as a function that throws.
 */
export function processorsStub(classicSource: string, real: string): string {
  const names = new Set<string>();
  for (const [, name] of classicSource.matchAll(/(?<![\w-])processors\.([A-Za-z_$][\w$]*)/g)) {
    if (name) names.add(name);
  }
  names.delete("aggregateChecks");
  return [
    `export { aggregateChecks } from ${JSON.stringify(real)};`,
    NONE,
    ...[...names].sort().map((n) => `export const ${n} = none;`),
  ].join("\n");
}

/** The stand-in for `to-json-schema.js`: its two method makers make methods that throw. */
export const TO_JSON_SCHEMA_STUB = [
  NONE,
  "export const createToJSONSchemaMethod = () => none;",
  "export const createStandardJSONSchemaMethod = () => none;",
].join("\n");
