const COLOR = /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d{1,4})\))$/i;

/** A color from the palette, or a plain grey if anything else ever arrives. */
export function safeColor(value: string): string {
  return COLOR.test(value) ? value : "#b3ab9b";
}
