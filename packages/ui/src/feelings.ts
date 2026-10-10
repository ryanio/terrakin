/**
 * The feelings a figure can show (RFC 0013). One fixed list, shared by the 2D figure, the 3D peg,
 * and character bodies. It lives in `@terrakin/figure`, which other projects draw bodies with too
 * (RFC 0031), and is imported from there.
 */
export { FEELINGS, type Feeling, isFeeling } from "@terrakin/figure";
