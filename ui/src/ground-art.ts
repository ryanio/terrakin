/**
 * Paths and floors (RFC 0016) drawn from the sim's `GROUND_LOOK`: shapes in tile units that the
 * world map, the build palette, the 3D views' ground texture, and the plot photos all draw, so a
 * cobble path looks the same everywhere. `paintGround` draws a tile on a canvas; `groundArt` builds
 * a swatch as an SVG with `createElementNS`, never markup from a string.
 */
import { GROUND_INFO, GROUND_LOOK, type GroundKind, type GroundMark } from "@terrakin/sim";

/**
 * One tile of ground at (`left`, `top`), `w` by `h` pixels. A kind with no fill (stepping stones)
 * leaves what's under it showing.
 */
export function paintGround(
  ctx: CanvasRenderingContext2D,
  kind: GroundKind,
  left: number,
  top: number,
  w: number,
  h: number,
): void {
  const look = GROUND_LOOK[kind];
  const u = Math.min(w, h);
  if (look.fill) {
    ctx.fillStyle = look.fill;
    ctx.fillRect(left, top, w, h);
  }
  for (const m of look.marks) paintMark(ctx, m, left, top, w, h, u);
}

function paintMark(
  ctx: CanvasRenderingContext2D,
  m: GroundMark,
  left: number,
  top: number,
  w: number,
  h: number,
  u: number,
) {
  switch (m.shape) {
    case "rect":
      ctx.fillStyle = m.fill;
      ctx.beginPath();
      ctx.roundRect(left + m.x * w, top + m.y * h, m.w * w, m.h * h, m.r * u);
      ctx.fill();
      return;
    case "circle":
      ctx.fillStyle = m.fill;
      ctx.beginPath();
      ctx.arc(left + m.cx * w, top + m.cy * h, m.r * u, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "ellipse":
      ctx.fillStyle = m.fill;
      ctx.beginPath();
      ctx.ellipse(
        left + m.cx * w,
        top + m.cy * h,
        m.rx * u,
        m.ry * u,
        (m.turn * Math.PI) / 180,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      return;
    case "line":
      ctx.strokeStyle = m.stroke;
      ctx.lineWidth = Math.max(1, m.width * u);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(left + m.x1 * w, top + m.y1 * h);
      ctx.lineTo(left + m.x2 * w, top + m.y2 * h);
      ctx.stroke();
      return;
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Where a swatch's grass shows through: under stepping stones. */
const GRASS = "#a5c682";

function svgMark(m: GroundMark): SVGElement {
  const set = (el: SVGElement, attrs: Record<string, string | number>) => {
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };
  switch (m.shape) {
    case "rect":
      return set(document.createElementNS(SVG_NS, "rect"), {
        x: m.x,
        y: m.y,
        width: m.w,
        height: m.h,
        rx: m.r,
        fill: m.fill,
      });
    case "circle":
      return set(document.createElementNS(SVG_NS, "circle"), {
        cx: m.cx,
        cy: m.cy,
        r: m.r,
        fill: m.fill,
      });
    case "ellipse":
      return set(document.createElementNS(SVG_NS, "ellipse"), {
        cx: m.cx,
        cy: m.cy,
        rx: m.rx,
        ry: m.ry,
        fill: m.fill,
        transform: `rotate(${m.turn} ${m.cx} ${m.cy})`,
      });
    case "line":
      return set(document.createElementNS(SVG_NS, "path"), {
        d: `M${m.x1} ${m.y1}L${m.x2} ${m.y2}`,
        stroke: m.stroke,
        "stroke-width": m.width,
        "stroke-linecap": "round",
        fill: "none",
      });
  }
}

/**
 * A swatch of a path or floor: one tile of it, as an inline SVG (its holder rounds the corners).
 * Decorative unless `title` is given, which goes in as text.
 */
export function groundArt(
  kind: GroundKind,
  opts: { size?: number; title?: string } = {},
): SVGSVGElement {
  const look = GROUND_LOOK[kind];
  const svg = document.createElementNS(SVG_NS, "svg");
  const size = opts.size ?? 28;
  svg.setAttribute("viewBox", "0 0 1 1");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("class", "ground-art");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("data-ground-art", kind);
  if (opts.title) {
    svg.setAttribute("role", "img");
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = opts.title;
    svg.append(title);
  } else svg.setAttribute("aria-hidden", "true");
  const base = document.createElementNS(SVG_NS, "rect");
  base.setAttribute("width", "1");
  base.setAttribute("height", "1");
  base.setAttribute("fill", look.fill ?? GRASS);
  svg.append(base, ...look.marks.map(svgMark));
  return svg;
}

/** "Cobblestones", for labels. */
export const groundName = (kind: GroundKind) => GROUND_INFO[kind].name;
