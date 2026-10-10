/**
 * The floor picker's chips (RFC 0028): one per floor from the ground floor up to `top`, named
 * as people say them ("Ground floor", "Upstairs"), the one at `start` pressed, 44px like any chip
 * in a `.pick-row`. The world's build bar and the 3D home view both draw it.
 */
import { floorName } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { chips } from "@terrakin/ui/ui";

/** Fill `row` with the chips; `pick` hears each floor picked. */
export function floorChips(
  row: HTMLElement,
  top: number,
  start: number,
  pick: (floor: number) => void,
): HTMLElement {
  const floors = Array.from({ length: top + 1 }, (_, n) => String(n));
  chips(
    floors,
    String(start),
    (n) => [h("span", { text: floorName(Number(n)) })],
    (n) => pick(Number(n)),
    row,
  );
  row.setAttribute("aria-label", "Floors");
  return row;
}
