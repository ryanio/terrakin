/**
 * The protocol's schemas carry descriptions (`.describe("...")`) for the OpenAPI document and
 * SKILL.md. The app only parses with them and never reads one, yet every description would ride
 * along in the first load. The client build drops each `.describe(...)` whose argument is plain
 * string literals (decision 0163); anything else, like a template with `${}` or a variable, stays.
 */

/** Where the string literal starting at `i` ends (the index after its closing quote), or -1. */
function literalEnd(code: string, i: number): number {
  const quote = code[i];
  if (quote !== '"' && quote !== "'" && quote !== "`") return -1;
  for (let j = i + 1; j < code.length; j++) {
    const c = code[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (quote === "`" && c === "$" && code[j + 1] === "{") return -1;
    if (c === quote) return j + 1;
    if (c === "\n" && quote !== "`") return -1;
  }
  return -1;
}

const space = (c: string | undefined) => c === " " || c === "\n" || c === "\t" || c === "\r";

/** Where `.describe(` plus string literals joined by `+` and a closing `)` ends, or -1. */
function describeEnd(code: string, start: number): number {
  let j = start + ".describe(".length;
  let literals = 0;
  for (;;) {
    while (space(code[j])) j++;
    const end = literalEnd(code, j);
    if (end < 0) return -1;
    literals++;
    j = end;
    while (space(code[j])) j++;
    if (code[j] !== "+") break;
    j++;
  }
  if (code[j] === ",") j++;
  while (space(code[j])) j++;
  return literals > 0 && code[j] === ")" ? j + 1 : -1;
}

/** `code` with every `.describe("...")` call on string literals removed. */
export function stripDescribe(code: string): string {
  let out = "";
  let from = 0;
  for (let at = code.indexOf(".describe(", from); at >= 0; at = code.indexOf(".describe(", from)) {
    const end = describeEnd(code, at);
    out += code.slice(from, at);
    if (end < 0) {
      out += ".describe(";
      from = at + ".describe(".length;
    } else {
      from = end;
    }
  }
  return out + code.slice(from);
}
