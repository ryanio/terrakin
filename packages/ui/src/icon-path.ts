/**
 * An icon from the map in `icons.ts` as a `Path2D` on Lucide's 24 by 24 grid, for a canvas to
 * stroke the same glyph the buttons show: scale the context by `size / 24` and stroke it with
 * Lucide's round caps and joins. Built once per icon.
 */
import { ICONS, type IconName } from "./icons";

const paths = new Map<IconName, Path2D>();

const num = (v: string | number | undefined) => Number(v ?? 0);

export function iconPath(name: IconName): Path2D {
  let path = paths.get(name);
  if (path) return path;
  path = new Path2D();
  for (const [tag, attrs] of ICONS[name]) {
    const a = attrs as Record<string, string | number | undefined>;
    if (tag === "path") path.addPath(new Path2D(String(a.d)));
    else if (tag === "circle") {
      path.moveTo(num(a.cx) + num(a.r), num(a.cy));
      path.arc(num(a.cx), num(a.cy), num(a.r), 0, Math.PI * 2);
    } else if (tag === "ellipse") {
      path.moveTo(num(a.cx) + num(a.rx), num(a.cy));
      path.ellipse(num(a.cx), num(a.cy), num(a.rx), num(a.ry), 0, 0, Math.PI * 2);
    } else if (tag === "rect") {
      path.roundRect(num(a.x), num(a.y), num(a.width), num(a.height), num(a.rx));
    } else if (tag === "line") {
      path.moveTo(num(a.x1), num(a.y1));
      path.lineTo(num(a.x2), num(a.y2));
    } else if (tag === "polyline" || tag === "polygon") {
      const points = String(a.points)
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      for (let i = 0; i + 1 < points.length; i += 2) {
        if (i === 0) path.moveTo(points[i] as number, points[i + 1] as number);
        else path.lineTo(points[i] as number, points[i + 1] as number);
      }
      if (tag === "polygon") path.closePath();
    }
  }
  paths.set(name, path);
  return path;
}
