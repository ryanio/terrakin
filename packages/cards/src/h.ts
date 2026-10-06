/**
 * A tiny element builder for satori, so templates need no React or JSX. Satori reads plain
 * `{ type, props: { style, children } }` objects.
 *
 * Text is only ever a string child of its own box (`text()`), which satori lays out as glyphs.
 * Nothing here parses markup, so a name like `<b>hi</b>` is drawn as those eight characters.
 */

export type Style = Record<string, string | number>;
export interface El {
  type: string;
  props: { style?: Style; children?: Child } & Record<string, unknown>;
}
export type Child = El | string | (El | string)[];
type Kid = El | string | null | false | undefined;

/** Satori lays out with flexbox only; a div with several children must say so, so every div does. */
export function h(
  type: string,
  props: Record<string, unknown> & { style?: Style },
  ...kids: Kid[]
) {
  const children = kids.filter(
    (k): k is El | string => k !== null && k !== false && k !== undefined,
  );
  const style = type === "div" ? { display: "flex", ...props.style } : props.style;
  const el: El = { type, props: { ...props, ...(style ? { style } : {}) } };
  if (children.length === 1 && children[0] !== undefined) el.props.children = children[0];
  else if (children.length > 1) el.props.children = children;
  return el;
}

export const div = (style: Style, ...kids: Kid[]) => h("div", { style }, ...kids);

/** One run of text. Satori wants a text node to be the only child of its box. */
export const text = (style: Style, s: string) => h("div", { style }, s);

export const img = (src: string, width: number, height: number, style: Style = {}) =>
  h("img", { src, width, height, style: { width, height, ...style } });

/** Raw SVG drawn in a box: the mark, the grain, ornaments. Only ever our own markup. */
export const svg = (markup: string, width: number, height: number, style: Style = {}) =>
  img(`data:image/svg+xml;utf8,${encodeURIComponent(markup)}`, width, height, style);
