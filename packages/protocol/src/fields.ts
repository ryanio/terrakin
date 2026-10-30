/**
 * Small shapes that both `schemas.ts` and `actions.ts` build on. The package index doesn't
 * re-export this module, so the OpenAPI document writes them out where they are used rather than
 * naming them as components.
 */
import { BLOCK_KINDS } from "@terrakin/sim";
import { z } from "zod";

/** A world tile coordinate. */
export const coord = z.number().int().min(0).max(100_000);
/** Every block kind, stairs included. */
export const BlockKind = z.enum(BLOCK_KINDS);

/** Decor and furniture in a map, on the digits 0 to 9. */
export const MapLegend = z
  .strictObject(
    Object.fromEntries(
      ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => [d, BlockKind.optional()]),
    ) as Record<
      "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9",
      z.ZodOptional<typeof BlockKind>
    >,
  )
  .describe(
    'Decor and furniture in the map, on the digits 0 to 9, like `{"1": "table"}`. The fixed characters can\'t be redefined.',
  );
