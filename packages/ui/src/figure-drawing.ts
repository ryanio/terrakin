/**
 * The shape of a figure recorded as plain data (`figure-svg.ts`), for code that draws figures
 * away from a browser: the server's pictures by link, rasterized by `packages/cards/`. This file
 * names no DOM types, so a runtime without them (the Worker, Node) can import
 * `@terrakin/ui/figure-svg` and typecheck against it; `package.json` points the import's types here.
 */
import type {
  Direction,
  GarmentPattern,
  HairColor,
  HairStyle,
  Pattern,
  ResidentColor,
  ResidentShape,
  Theme,
  WearItem,
} from "@terrakin/sim";

/**
 * A look as the edge draws it: everything `drawFigure` reads but an uploaded pattern tile, which a
 * picture never shows (a garment styled `own` wears the outfit's pattern instead).
 */
export interface EdgeLook {
  color: ResidentColor;
  shape: ResidentShape;
  theme?: Theme | undefined;
  wear?: readonly WearItem[] | undefined;
  pattern?: Pattern | undefined;
  wearStyle?:
    | Partial<
        Record<
          WearItem,
          { pattern?: GarmentPattern | undefined; color?: ResidentColor | undefined } | undefined
        >
      >
    | undefined;
  hair?: HairStyle | undefined;
  hairColor?: HairColor | undefined;
}

/**
 * One filled or stroked path, in the drawing's units (100 to a tile, feet at 0, 0). Colors are
 * `#rrggbb` or `rgba(r, g, b, a)`; `tile` fills it with one of the drawing's pattern tiles instead.
 * `clip` lists the drawing's clip paths it's drawn inside, outermost first.
 */
export interface FigureShape {
  d: string;
  fill?: string | undefined;
  tile?: number | undefined;
  stroke?: string | undefined;
  width?: number | undefined;
  cap?: "round" | "butt" | "square" | undefined;
  join?: "round" | "miter" | "bevel" | undefined;
  alpha?: number | undefined;
  clip?: number[] | undefined;
}

/** A repeating pattern tile: `size` units square, placed by `at` (an SVG matrix) when it has one. */
export interface FigureTile {
  size: number;
  shapes: FigureShape[];
  at?: number[] | undefined;
}

export interface FigureDrawing {
  /** The box the figure fits in: x, y, width, height. */
  box: [number, number, number, number];
  shapes: FigureShape[];
  clips: string[];
  tiles: FigureTile[];
}

/** A resident's figure facing `facing` (south by default), drawn by `drawFigure` and recorded. */
export declare function figureDrawing(look: EdgeLook, facing?: Direction): FigureDrawing;

/** Hair in words, like "Auburn bob" (`hairName` in `looks.ts`). */
export declare function hairName(style: HairStyle, color?: HairColor): string | undefined;
