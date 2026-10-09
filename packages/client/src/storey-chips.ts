/**
 * The storey picker's chips (RFC 0028): one per storey from the ground floor up to `top`, named
 * as people say them ("Ground floor", "Upstairs"), the one at `start` pressed, 44px like any chip
 * in a `.pick-row`. The world's build bar and the 3D home view both draw it.
 */
import { storeyName } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { chips } from "@terrakin/ui/ui";

/** Fill `row` with the chips; `pick` hears each storey picked. */
export function storeyChips(
  row: HTMLElement,
  top: number,
  start: number,
  pick: (storey: number) => void,
): HTMLElement {
  const storeys = Array.from({ length: top + 1 }, (_, n) => String(n));
  chips(
    storeys,
    String(start),
    (n) => [h("span", { text: storeyName(Number(n)) })],
    (n) => pick(Number(n)),
    row,
  );
  row.setAttribute("aria-label", "Storeys");
  return row;
}
