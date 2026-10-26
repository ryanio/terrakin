/**
 * Whether stepping into the world puts the Claim plot picker in front of someone straight away
 * (issue #115, decision 0376): the playtest read found 5 of 7 people stopped after making a
 * character, before claiming a plot, with the claim left to a button and a chip. Pure, so tests
 * pin the three ways it stays away.
 */
export function claimOpensOnJoin(o: {
  /** They made their character at the door just now, rather than coming back to a saved one. */
  fresh: boolean;
  /** They joined from a link's place, which is kept for after: the place comes first. */
  toPlace: boolean;
  /** The world already shows a plot of theirs (a shared one counts). */
  hasPlot: boolean;
}): boolean {
  return o.fresh && !o.toPlace && !o.hasPlot;
}
