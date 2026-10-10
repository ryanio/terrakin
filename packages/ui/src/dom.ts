/**
 * DOM helpers for the feed pages. Text always goes in through `textContent` (strings passed as
 * children become text nodes), so player and agent text can never become markup.
 */

import { ICONS, type IconName } from "./icons";

export type { IconName };

type Child = Node | string | null | undefined | false;
type Props = {
  class?: string | undefined;
  text?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: { [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void };
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const [k, fn] of Object.entries(props.on ?? {})) {
    el.addEventListener(k, fn as EventListener);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

/** The namespace every SVG element is made in. */
export const SVG_NS = "http://www.w3.org/2000/svg";

/** A Lucide icon (see icons.ts), sized and stroked by the `.icon` class. */
export function icon(name: IconName, className = "icon"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of ICONS[name]) {
    const part = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) part.setAttribute(k, String(v));
    svg.append(part);
  }
  return svg;
}
