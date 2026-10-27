/**
 * What stepping into the world puts in front of someone who just made a character (issue #115,
 * decisions 0377 and 0380): the playtest read found 5 of 7 people stopped after making a
 * character, before claiming a plot, with the claim left to a button and a chip. A guest who tapped
 * Live here on an empty plot gets that plot (`settle`), with no picker; anyone else new gets the
 * Claim plot picker. Pure, so tests pin the three ways it stays away.
 */
export type ClaimOnJoin = { kind: "settle"; px: number; py: number } | { kind: "pick" };

export function claimOnJoin(o: {
  /** They made their character just now, rather than coming back to a saved one. */
  fresh: boolean;
  /** They joined from a link's place, which is kept for after: the place comes first. */
  toPlace: boolean;
  /** The world already shows a plot of theirs (a shared one counts). */
  hasPlot: boolean;
  /** The plot they stood on as a guest and asked to live on, if they did. */
  chosen?: { px: number; py: number } | undefined;
}): ClaimOnJoin | undefined {
  if (!o.fresh || o.toPlace || o.hasPlot) return undefined;
  return o.chosen ? { kind: "settle", ...o.chosen } : { kind: "pick" };
}
