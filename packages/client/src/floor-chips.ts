/**
 * The floor picker's chips (RFC 0028): one per floor from the ground floor up to `top`, named
 * as people say them ("Ground floor", "Upstairs"), the one at `start` pressed, 44px like any chip
 * in a `.pick-row`. The world's build bar and the 3D home view both draw it, and the 3D view adds
 * one more for the home with its roof on (RFC 0041).
 */
import { floorName } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { chips } from "@terrakin/ui/ui";

/**
 * Fill `row` with the chips; `pick` hears each floor picked. With `roof` (RFC 0041) one more chip
 * comes after them, `top + 1`, for the home with its roof on, which is how the street sees it.
 */
export function floorChips(
  row: HTMLElement,
  top: number,
  start: number,
  pick: (floor: number) => void,
  roof = false,
): HTMLElement {
  const floors = Array.from({ length: top + 1 + (roof ? 1 : 0) }, (_, n) => String(n));
  chips(
    floors,
    String(start),
    (n) => [h("span", { text: Number(n) > top ? "With its roof" : floorName(Number(n)) })],
    (n) => pick(Number(n)),
    row,
  );
  row.setAttribute("aria-label", "Floors");
  return row;
}
