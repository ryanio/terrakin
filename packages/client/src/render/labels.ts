import { CLAY, CLAY_DEEP, INK, PAPER_EDGE } from "./palette";

// Stable hue per owner so neighbors' plots are easy to tell apart.
export function ownerHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

const labelWidths = new Map<string, number>();
export function labelWidth(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  const key = `${font}|${text}`;
  let w = labelWidths.get(key);
  if (w === undefined) {
    if (labelWidths.size > 400) labelWidths.clear();
    w = ctx.measureText(text).width;
    labelWidths.set(key, w);
  }
  return w;
}

/** `text`, cut with an ellipsis to fit `max` pixels in the context's current font. */
function fitText(ctx: CanvasRenderingContext2D, font: string, text: string, max: number): string {
  if (labelWidth(ctx, font, text) <= max) return text;
  const chars = [...text];
  let n = chars.length - 1;
  while (n > 1 && labelWidth(ctx, font, `${chars.slice(0, n).join("").trimEnd()}…`) > max) n--;
  return `${chars.slice(0, n).join("").trimEnd()}…`;
}

/**
 * Plots' names as soft paper labels, centred along the top of each plot (decision 0121). A label
 * stays in view while its plot does: it slides down the plot when the plot's top edge is off the
 * screen or under the top bar and the visit card (`labelTop`), and along it when the plot's middle
 * is off one side. A kindred's hall (RFC 0033) carries the kindred's name on a smaller tag of its
 * own, under the plot's name or alone, and the two move as one so neither leaves the plot. Canvas
 * text can't execute anything, so a name is drawn as written.
 */
export function paintPlotLabels(
  ctx: CanvasRenderingContext2D,
  labels: readonly {
    /** The plot's name, when it has one. */
    text?: string;
    /** The kindred whose hall the plot is. */
    sub?: string;
    left: number;
    top: number;
    fade: number;
    mine: boolean;
  }[],
  view: { plotPx: number; scale: number; width: number; height: number; labelTop: number },
) {
  const { plotPx, scale, width, height, labelTop } = view;
  const fontSize = Math.min(20, Math.max(12, Math.round(scale / 2.4)));
  const font = `italic 600 ${fontSize}px "Fraunces Variable", Georgia, serif`;
  const subSize = Math.max(10, Math.round(fontSize * 0.78));
  const subFont = `600 ${subSize}px "Figtree Variable", system-ui, sans-serif`;
  const padX = fontSize * 0.7;
  const tagH = Math.round(fontSize * 1.7);
  const subH = Math.round(subSize * 1.6);
  const inset = Math.max(4, Math.round(scale * 0.22));
  const room = plotPx - inset * 2 - padX * 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const l of labels) {
    ctx.font = font;
    const text = l.text ? fitText(ctx, font, l.text, room) : "";
    const w = text ? labelWidth(ctx, font, text) + padX * 2 : 0;
    ctx.font = subFont;
    const sub = l.sub ? fitText(ctx, subFont, l.sub, room) : "";
    const sw = sub ? labelWidth(ctx, subFont, sub) + padX * 1.4 : 0;
    const wide = Math.max(w, sw);
    const mainH = text ? tagH : 0;
    const gap = text && sub ? 2 : 0;
    const total = mainH + gap + (sub ? subH : 0);
    // On screen where the plot is, and on the plot where the screen is.
    const onScreen = Math.min(
      Math.max(l.left + plotPx / 2, inset + wide / 2),
      width - inset - wide / 2,
    );
    const x = Math.min(Math.max(onScreen, l.left + wide / 2), l.left + plotPx - wide / 2);
    const lowest = l.top + plotPx - total - inset;
    const y = Math.min(Math.max(l.top + inset, labelTop + inset), lowest);
    if (y + total < 0 || y > height) continue;
    ctx.globalAlpha = l.fade * 0.92;
    ctx.lineWidth = 1;
    if (text) {
      ctx.font = font;
      ctx.fillStyle = "rgba(255, 250, 240, 0.86)";
      ctx.strokeStyle = l.mine ? CLAY : PAPER_EDGE;
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y, w, tagH, tagH / 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = l.mine ? CLAY_DEEP : INK;
      ctx.fillText(text, x, y + tagH / 2 + 0.5);
    }
    if (sub) {
      const sy = y + mainH + gap;
      ctx.font = subFont;
      ctx.fillStyle = "rgba(255, 250, 240, 0.8)";
      ctx.strokeStyle = PAPER_EDGE;
      ctx.beginPath();
      ctx.roundRect(x - sw / 2, sy, sw, subH, subH / 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.fillText(sub, x, sy + subH / 2 + 0.5);
    }
  }
  ctx.globalAlpha = 1;
}
