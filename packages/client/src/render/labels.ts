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
 * is off one side. Canvas text can't execute anything, so a name is drawn as written.
 */
export function paintPlotLabels(
  ctx: CanvasRenderingContext2D,
  labels: readonly { text: string; left: number; top: number; fade: number; mine: boolean }[],
  view: { plotPx: number; scale: number; width: number; height: number; labelTop: number },
) {
  const { plotPx, scale, width, height, labelTop } = view;
  const fontSize = Math.min(20, Math.max(12, Math.round(scale / 2.4)));
  const font = `italic 600 ${fontSize}px "Fraunces Variable", Georgia, serif`;
  const padX = fontSize * 0.7;
  const tagH = Math.round(fontSize * 1.7);
  const inset = Math.max(4, Math.round(scale * 0.22));
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const l of labels) {
    const text = fitText(ctx, font, l.text, plotPx - inset * 2 - padX * 2);
    const w = labelWidth(ctx, font, text) + padX * 2;
    // On screen where the plot is, and on the plot where the screen is.
    const onScreen = Math.min(Math.max(l.left + plotPx / 2, inset + w / 2), width - inset - w / 2);
    const x = Math.min(Math.max(onScreen, l.left + w / 2), l.left + plotPx - w / 2);
    const lowest = l.top + plotPx - tagH - inset;
    const y = Math.min(Math.max(l.top + inset, labelTop + inset), lowest);
    if (y + tagH < 0 || y > height) continue;
    ctx.globalAlpha = l.fade * 0.92;
    ctx.fillStyle = "rgba(255, 250, 240, 0.86)";
    ctx.strokeStyle = l.mine ? CLAY : PAPER_EDGE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y, w, tagH, tagH / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = l.mine ? CLAY_DEEP : INK;
    ctx.fillText(text, x, y + tagH / 2 + 0.5);
  }
  ctx.globalAlpha = 1;
}
