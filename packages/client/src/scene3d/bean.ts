/** The bean figure's side (decision 0442), shared by the body (`figure.ts`) and what it wears (`wear.ts`). */

/**
 * The bean's side, bottom to top, as [radius, y]: wide at the hips, narrowing up into the head so
 * body and head read as one soft shape. Wear is sized to it (`wear.ts`): about 0.255 across from y
 * 0.15 to 0.35, under the head's sphere of 0.17 at y 0.66.
 */
export const BEAN: readonly (readonly [number, number])[] = [
  [0, 0.03],
  [0.15, 0.04],
  [0.225, 0.09],
  [0.255, 0.18],
  [0.25, 0.3],
  [0.232, 0.4],
  [0.2, 0.47],
  [0.176, 0.53],
  [0.166, 0.58],
  [0.16, 0.64],
  [0, 0.67],
];
/** The radius of the bean's side at height `y`: 0 below its bottom and above its top. */
export function beanAt(y: number): number {
  if (y <= (BEAN[0]?.[1] ?? 0)) return 0;
  for (let i = 1; i < BEAN.length; i++) {
    const [r0, y0] = BEAN[i - 1] as readonly [number, number];
    const [r1, y1] = BEAN[i] as readonly [number, number];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
}
