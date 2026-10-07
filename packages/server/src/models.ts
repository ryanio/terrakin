/**
 * The Anthropic models Terrakin calls, by tier. Code names a tier (`MODELS.haiku`), never a model
 * id. Moving a tier to a new release is one line in `MODELS`, plus a row in `CAPABILITIES` below and
 * a `PRICES` row in `ai-spend.ts`.
 */
export const MODELS = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
} as const;

/** What a model takes in a Messages API request, so a setting never sends one a value it refuses. */
interface Capabilities {
  /**
   * The `thinking` value that turns thinking off, for a model that thinks by default. Missing when
   * the model can't turn it off, or doesn't think unless asked.
   */
  thinkingOff?: { type: "disabled" } | { type: "between_tools" };
  /** Takes `output_config.effort`. */
  effort: boolean;
  /** Takes a forced `tool_choice` (`tool` or `any`). */
  forcedTool: boolean;
  /** Takes `fallbacks: "default"`, which reruns a refused request on Anthropic's pick. */
  fallbacks: boolean;
}

/**
 * Matched by model id prefix like `PRICES`, so a dated id finds its row. The current tiers come
 * first; the rest are models a `TERRAKIN_*_MODEL` setting may still name.
 */
const CAPABILITIES: readonly (readonly [prefix: string, caps: Capabilities])[] = [
  ["claude-opus-5-5", { effort: true, forcedTool: false, fallbacks: true }],
  [
    "claude-sonnet-5-5",
    { thinkingOff: { type: "between_tools" }, effort: true, forcedTool: false, fallbacks: true },
  ],
  [
    "claude-haiku-5-5",
    { thinkingOff: { type: "disabled" }, effort: true, forcedTool: true, fallbacks: false },
  ],
  ["claude-fable-5-1", { effort: true, forcedTool: false, fallbacks: true }],
  ["claude-fable-5", { effort: true, forcedTool: true, fallbacks: false }],
  ["claude-mythos", { effort: true, forcedTool: false, fallbacks: false }],
  ["claude-opus-5", { effort: true, forcedTool: true, fallbacks: true }],
  ["claude-opus-4-8", { effort: true, forcedTool: true, fallbacks: false }],
  ["claude-opus-4-7", { effort: true, forcedTool: true, fallbacks: false }],
  ["claude-opus-4-6", { effort: true, forcedTool: true, fallbacks: false }],
  ["claude-opus-4-5", { effort: true, forcedTool: true, fallbacks: false }],
  ["claude-sonnet-5", { effort: true, forcedTool: true, fallbacks: false }],
  ["claude-sonnet-4-6", { effort: true, forcedTool: true, fallbacks: false }],
];

/** A model with no row (Haiku 4.5 among them) gets nothing it might refuse. */
const PLAIN: Capabilities = { effort: false, forcedTool: true, fallbacks: false };

/** The row for `model`: the longest prefix that is the whole id or ends at a dash in it. */
export function byPrefix<T>(rows: readonly (readonly [string, T])[], model: string): T | undefined {
  let best: readonly [string, T] | undefined;
  for (const row of rows) {
    const [prefix] = row;
    if (
      (model === prefix || model.startsWith(`${prefix}-`)) &&
      prefix.length > (best?.[0].length ?? -1)
    ) {
      best = row;
    }
  }
  return best?.[1];
}

export const capabilitiesOf = (model: string): Capabilities =>
  byPrefix(CAPABILITIES, model) ?? PLAIN;
