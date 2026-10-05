/**
 * DOM helpers for the feed pages. Text always goes in through `textContent` (strings passed as
 * children become text nodes), so player and agent text can never become markup.
 */

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

const SVG = "http://www.w3.org/2000/svg";

/** Line icons, 24x24, stroke 1.7 (the `.icon` class). Path data is ours, never player text. */
const ICONS = {
  feed: ["M5 6.5h14", "M5 12h14", "M5 17.5h9"],
  world: [
    "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z",
    "M3.8 9.5h16.4M3.8 14.5h16.4",
    "M12 3.5c2.2 2.3 3.2 5.1 3.2 8.5s-1 6.2-3.2 8.5c-2.2-2.3-3.2-5.1-3.2-8.5s1-6.2 3.2-8.5z",
  ],
  sparkle: [
    "M11 3.5c.6 4.3 2.4 6.1 6.5 6.6-4.1.6-5.9 2.4-6.5 6.6-.6-4.2-2.4-6-6.5-6.6 4.1-.5 5.9-2.3 6.5-6.6z",
    "M18.5 15v5M16 17.5h5",
  ],
  heart: [
    "M12 19.5s-7.5-4.3-7.5-9.6A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.3c0 5.3-7.5 9.6-7.5 9.6z",
  ],
  reply: ["M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4.5 19.5l1.3-4.2A7.5 7.5 0 1 1 20 11.5z"],
  share: [
    "M12 15V4",
    "M8 7.5 12 3.5l4 4",
    "M7 11H6a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18 11h-1",
  ],
  copy: [
    "M10 8.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 8.5 18v-8A1.5 1.5 0 0 1 10 8.5z",
    "M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5",
  ],
  link: [
    "M10 13.5a4 4 0 0 0 5.7.3l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.3 1.3",
    "M14 10.5a4 4 0 0 0-5.7-.3l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3",
  ],
  cube: ["M12 3.5 19.5 7.7v8.6L12 20.5l-7.5-4.2V7.7z", "M4.5 7.7 12 12l7.5-4.3", "M12 12v8.5"],
  attach: [
    "M19 11.5 12.2 18.3a4.5 4.5 0 0 1-6.4-6.4l7.1-7.1a3 3 0 0 1 4.2 4.2l-7.1 7.1a1.5 1.5 0 0 1-2.1-2.1L14.4 7.5",
  ],
  image: [
    "M6 4.5h12A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5z",
    "M4.5 16l4.5-4.5 4 4 2.5-2.5 4 4",
    "M15 9.5h.01",
  ],
  close: ["M6.5 6.5l11 11M17.5 6.5l-11 11"],
  back: ["M19 12H6", "M11 6.5 5.5 12l5.5 5.5"],
  arrow: ["M5 12h13", "M13 6l6 6-6 6"],
  up: ["M12 19V6", "M6.5 11.5 12 6l5.5 5.5"],
  chevronLeft: ["M14.5 6.5 9 12l5.5 5.5"],
  chevronRight: ["M9.5 6.5 15 12l-5.5 5.5"],
  pin: [
    "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z",
    "M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  ],
  plus: ["M12 5.5v13M5.5 12h13"],
  check: ["M5.5 12.5l4 4 9-9"],
  quote: ["M5 18.5V13a5 5 0 0 1 5-5", "M14 18.5V13a5 5 0 0 1 5-5"],
  play: ["M8 5.5v13l10.5-6.5z"],
  mail: [
    "M5 5.5h14A1.5 1.5 0 0 1 20.5 7v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17V7A1.5 1.5 0 0 1 5 5.5z",
    "M4 7l8 6 8-6",
  ],
  more: ["M6 12h.01", "M12 12h.01", "M18 12h.01"],
  key: [
    "M14.5 13.5a5 5 0 1 0-4.6-3L3.5 17v3.5H7v-2h2v-2h2l1.4-1.4a5 5 0 0 0 2.1.4z",
    "M16.5 7.5h.01",
  ],
  userPlus: [
    "M10 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    "M3.5 20.5a6.5 6.5 0 0 1 13 0",
    "M19 8v6M16 11h6",
  ],
  town: ["M3.5 9.5 12 4.5l8.5 5", "M4.5 20h15", "M6.5 11v6.5M10.2 11v6.5M13.8 11v6.5M17.5 11v6.5"],
  camera: [
    "M4.5 8.5A1.5 1.5 0 0 1 6 7h2.2l1.3-2h5l1.3 2H18a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 18 19H6a1.5 1.5 0 0 1-1.5-1.5z",
    "M12 16a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z",
  ],
  repost: [
    "M5 11V9.5A2.5 2.5 0 0 1 7.5 7H18",
    "M15 4l3 3-3 3",
    "M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5H6",
    "M9 20l-3-3 3-3",
  ],
  star: ["M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.8l-5.1 2.7 1-5.7-4.1-4 5.7-.8z"],
  bell: ["M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z", "M10 20.5a2 2 0 0 0 4 0"],
  smile: [
    "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z",
    "M8.8 14a4 4 0 0 0 6.4 0",
    "M9.3 10h.01M14.7 10h.01",
  ],
  at: [
    "M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z",
    "M15.5 12v1.3a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.3 6.7",
  ],
  coin: [
    "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z",
    "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z",
  ],
  follow: [
    "M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    "M3.5 19.5a6.5 6.5 0 0 1 13 0",
    "M18.5 8v6M15.5 11h6",
  ],
  sprout: [
    "M12 20.5V11",
    "M12 11c0-3.5-2.5-5.5-6.5-5.5 0 3.5 2.5 5.5 6.5 5.5z",
    "M12 13.5c0-3 2.2-5 5.5-5 0 3-2.2 5-5.5 5z",
  ],
  gift: [
    "M4.5 9.5h15v3h-15z",
    "M6 12.5v8h12v-8",
    "M12 9.5v11",
    "M12 9.5C10 9.5 8 8.7 8 7a2 2 0 0 1 4 0 2 2 0 0 1 4 0c0 1.7-2 2.5-4 2.5",
  ],
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, className = "icon"): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
