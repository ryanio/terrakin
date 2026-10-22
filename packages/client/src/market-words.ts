/**
 * Words both markets share: things for sale at `/market`, and plots for sale beside them
 * (RFC 0039). Pure, so the item market's view and the plots section import it without importing
 * each other, and the tests pin it.
 */
import { coins } from "./purse";

/**
 * What a listing's button does for the viewer: buy it, take it back (their own), or nothing
 * (signed out). A thing's lot and a plot share it.
 */
export function listingAction(
  l: { price: number; seller: { id: string } },
  viewerId: string | null,
  balance: number | null,
): { kind: "buy" | "take" | "none"; text: string; can: boolean } {
  if (viewerId === null || balance === null) return { kind: "none", text: "", can: false };
  if (l.seller.id === viewerId) return { kind: "take", text: "Take back", can: true };
  if (balance < l.price)
    return { kind: "buy", text: `${coins(l.price - balance)} short`, can: false };
  return { kind: "buy", text: `Buy for ${coins(l.price)}`, can: true };
}
