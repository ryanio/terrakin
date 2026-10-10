/**
 * Pets drawn in the browser (RFC 0019), from the pictures the sim keeps as data
 * (`packages/sim/src/pet-art.ts`), so a pet on a profile is the pet on the map and in a plot photo.
 * `petArt` builds an inline SVG with `createElementNS`, never markup from a string; `drawPet`
 * paints the same shapes on a canvas, for the map's sprites and the 3D views' textures.
 */

import {
  PET_BOX,
  type PetCoat,
  type PetFace,
  type PetKind,
  type PetPosture,
  type PetShape,
  petShapes,
} from "@terrakin/sim";
import { SVG_NS } from "./dom";

export interface PetArtOptions {
  pose?: PetPosture;
  face?: PetFace;
  /** Width and height in CSS pixels. 48 by default. */
  size?: number;
  /** Read out for screen readers. Without one the picture is decorative and hidden from them. */
  title?: string;
  /** Extra classes beside `pet-art`. */
  className?: string;
  /** -1 faces left. */
  facing?: 1 | -1;
}

function build(shape: PetShape): SVGElement {
  const el = document.createElementNS(SVG_NS, shape.tag);
  for (const [k, v] of Object.entries(shape.attrs)) el.setAttribute(k, String(v));
  for (const child of shape.children ?? []) el.append(build(child));
  return el;
}

/**
 * A pet as an inline SVG. Decorative (`aria-hidden`) unless `title` is given, in which case it's an
 * image with that name, put in as text.
 */
export function petArt(kind: PetKind, coat: PetCoat, opts: PetArtOptions = {}): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const size = opts.size ?? PET_BOX;
  svg.setAttribute("viewBox", `0 0 ${PET_BOX} ${PET_BOX}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("class", opts.className ? `pet-art ${opts.className}` : "pet-art");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("data-kind", kind);
  svg.setAttribute("data-coat", coat);
  if (opts.title) {
    svg.setAttribute("role", "img");
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = opts.title;
    svg.append(title);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  const parent =
    opts.facing === -1
      ? svg.appendChild(document.createElementNS(SVG_NS, "g"))
      : (svg as SVGElement);
  if (opts.facing === -1) parent.setAttribute("transform", `translate(${PET_BOX} 0) scale(-1 1)`);
  for (const shape of petShapes(kind, coat, opts.pose ?? "awake", opts.face ?? "open")) {
    parent.append(build(shape));
  }
  return svg;
}

const num = (v: string | number | undefined, fallback = 0) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Paint one shape and its children, fill then stroke, as SVG would. */
function paint(ctx: CanvasRenderingContext2D, shape: PetShape) {
  const a = shape.attrs;
  ctx.save();
  if (a.opacity !== undefined) ctx.globalAlpha *= num(a.opacity, 1);
  if (shape.tag === "g") {
    for (const child of shape.children ?? []) paint(ctx, child);
    ctx.restore();
    return;
  }
  const p =
    shape.tag === "path"
      ? new Path2D(String(a.d ?? ""))
      : (() => {
          const q = new Path2D();
          const cx = num(a.cx);
          const cy = num(a.cy);
          const rx = shape.tag === "circle" ? num(a.r) : num(a.rx);
          const ry = shape.tag === "circle" ? num(a.r) : num(a.ry);
          q.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2);
          return q;
        })();
  const fill = a.fill === undefined ? "#000000" : String(a.fill);
  if (fill !== "none") {
    ctx.fillStyle = fill;
    ctx.fill(p);
  }
  if (a.stroke !== undefined && a.stroke !== "none") {
    ctx.strokeStyle = String(a.stroke);
    ctx.lineWidth = num(a["stroke-width"], 1);
    ctx.lineJoin = (a["stroke-linejoin"] as CanvasLineJoin | undefined) ?? "miter";
    ctx.lineCap = (a["stroke-linecap"] as CanvasLineCap | undefined) ?? "butt";
    ctx.stroke(p);
  }
  ctx.restore();
}

/**
 * Paint a pet on a canvas in its 48 by 48 box, from the current transform's origin. Scale the
 * context first to draw it bigger or smaller, and flip it to face left.
 */
export function drawPet(
  ctx: CanvasRenderingContext2D,
  kind: PetKind,
  coat: PetCoat,
  pose: PetPosture = "awake",
  face: PetFace = "open",
) {
  for (const shape of petShapes(kind, coat, pose, face)) paint(ctx, shape);
}
