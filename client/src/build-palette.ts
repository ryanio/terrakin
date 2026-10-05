/**
 * The town shop's decor in the world's build palette (RFC 0008). A lantern, frame, fence post, or
 * bench shows up as a choice only while you hold one, with how many you have. Placing one is a
 * plain `place`; the server takes it from your things and says so in an `inventory` event, whose
 * counts keep these buttons current without asking again. The counting is pure, so tests pin it.
 */
import { DECOR_KINDS, type DecorKind, ITEM_INFO, isDecorKind } from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import { itemArt } from "@terrakin/ui/item-art";
import { stackCount } from "./things";

/** How many of each decor kind you hold. Kinds you hold none of are left out. */
export type DecorCounts = ReadonlyMap<DecorKind, number>;

/** Decor counts from your things' stacks, in catalog order. */
export function decorFromStacks(stacks: readonly { kind: string; count: number }[]): DecorCounts {
  const out = new Map<DecorKind, number>();
  for (const kind of DECOR_KINDS) {
    const n = stackCount(stacks, kind);
    if (n > 0) out.set(kind, n);
  }
  return out;
}

/**
 * The counts after an inventory event's changes, each of which carries the count held after it.
 * The same map back when no decor changed.
 */
export function withDecorChanges(
  counts: DecorCounts,
  changes: readonly { kind: string; count: number }[] | undefined,
): DecorCounts {
  const decor = (changes ?? []).filter((c) => isDecorKind(c.kind));
  if (decor.length === 0) return counts;
  const next = new Map(counts);
  for (const c of decor) next.set(c.kind as DecorKind, c.count);
  return decorFromStacks([...next].map(([kind, count]) => ({ kind, count })));
}

/** "Paper lantern, 3 left", or "Paper lantern, none left". */
export function decorLabel(kind: DecorKind, n: number): string {
  return `${ITEM_INFO[kind].name}, ${n > 0 ? n : "none"} left`;
}

/**
 * The decor buttons to show, in catalog order: what you hold, plus any in `keep` you've run out
 * of, at 0. Keeping those until the palette closes stops the other buttons from sliding under
 * your finger when you place your last one.
 */
export function decorChoices(
  counts: DecorCounts,
  keep: ReadonlySet<DecorKind>,
): [DecorKind, number][] {
  return DECOR_KINDS.flatMap((kind): [DecorKind, number][] => {
    const n = counts.get(kind) ?? 0;
    return n > 0 || keep.has(kind) ? [[kind, n]] : [];
  });
}

/**
 * Put one button per decor choice at the start of the palette, before the free blocks, so what
 * you bought is in reach without scrolling on a phone. Replaces the ones from last time. One you
 * have none of is shown greyed out and can't be picked.
 */
export function paintDecorChoices(
  palette: HTMLElement,
  choices: readonly [DecorKind, number][],
  selected: string,
): void {
  for (const old of palette.querySelectorAll(".decor-choice, .palette-divider")) old.remove();
  if (choices.length === 0) return;
  const buttons = choices.map(([kind, n]) =>
    h(
      "button",
      {
        class: "decor-choice",
        attrs: {
          type: "button",
          "data-block": kind,
          "aria-label": decorLabel(kind, n),
          "aria-pressed": String(kind === selected),
          disabled: n === 0,
        },
      },
      h("span", { class: "chip decor-chip" }, itemArt(kind, { size: 28 })),
      h("span", { class: "decor-count", attrs: { "aria-hidden": "true" }, text: String(n) }),
    ),
  );
  palette.prepend(
    ...buttons,
    h("span", { class: "palette-divider", attrs: { "aria-hidden": "true" } }),
  );
}
