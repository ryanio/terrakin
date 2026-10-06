/**
 * The world's build bar (RFC 0016): three tabs. Blocks are the free blocks and the hearth, always
 * there. Paths lists every path and floor with what a tile takes. Furniture lists the workbench's
 * furniture, then the shop's decor, with how many you hold. A line under the tabs names the pick
 * and what it costs or how many you have.
 *
 * What you hold comes from your things once, then from the counts each `inventory` event carries.
 * A pick the server would refuse (furniture you hold none of, a path you can't pay for) stays
 * pickable so its line can say why, and the world holds back the tap; the checks are the sim's own
 * (`groundShort`), never a copy (decision 0052). The counting is pure, so tests pin it.
 */
import {
  DECOR_KINDS,
  type DecorKind,
  FURNITURE_KINDS,
  type FurnitureKind,
  GROUND_INFO,
  GROUND_KINDS,
  type GroundKind,
  groundCostWords,
  groundShort,
  ITEM_INFO,
  isDecorKind,
  isFurnitureKind,
  type StackKind,
} from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import { groundArt } from "@terrakin/ui/ground-art";
import { itemArt } from "@terrakin/ui/item-art";
import { needsLine, thingCount } from "./things";

export const PALETTE_TABS = ["blocks", "ground", "furniture"] as const;
export type PaletteTab = (typeof PALETTE_TABS)[number];
/** What each tab says. */
export const PALETTE_TAB_WORDS: Record<PaletteTab, string> = {
  blocks: "Blocks",
  ground: "Paths",
  furniture: "Furniture",
};

/** A block you hold before you place it: decor from the shop, or furniture from a workbench. */
export type HeldKind = DecorKind | FurnitureKind;
/** Every held block, in the Furniture tab's order: furniture, then the shop's decor. */
export const HELD_KINDS: readonly HeldKind[] = [...FURNITURE_KINDS, ...DECOR_KINDS];

/** What you hold, by kind, as far as the build bar needs: kinds at 0 are left out. */
export type Holdings = ReadonlyMap<string, number>;

/** Holdings from your things' stacks. */
export function holdingsFromStacks(stacks: readonly { kind: string; count: number }[]): Holdings {
  const out = new Map<string, number>();
  for (const s of stacks) if (s.count > 0) out.set(s.kind, s.count);
  return out;
}

/**
 * The holdings after an inventory event's changes, each of which carries the count held after
 * it. The same map back when nothing changed, so the bar isn't redrawn.
 */
export function withChanges(
  holdings: Holdings,
  changes: readonly { kind: string; count: number }[] | undefined,
): Holdings {
  const moved = (changes ?? []).filter((c) => (holdings.get(c.kind) ?? 0) !== c.count);
  if (moved.length === 0) return holdings;
  const next = new Map(holdings);
  for (const c of moved) {
    if (c.count > 0) next.set(c.kind, c.count);
    else next.delete(c.kind);
  }
  return next;
}

/** How many of a kind you hold. */
export const heldOf = (holdings: Holdings, kind: string) => holdings.get(kind) ?? 0;

/** "Paper lantern, 3 left", or "Table, none left". */
export function heldLabel(kind: HeldKind, n: number): string {
  return `${ITEM_INFO[kind].name}, ${n > 0 ? n : "none"} left`;
}

/** Where to get one more of a held block, in plain words. */
export function heldSource(kind: HeldKind): string {
  if (isDecorKind(kind)) return "Buy one at the town shop.";
  return `Make one at a workbench from ${needsLine(kind)}.`;
}

/** The line under the tabs for a held block. */
export function heldLine(kind: HeldKind, n: number): string {
  const name = ITEM_INFO[kind].name;
  return n > 0 ? `${name}: ${n} left.` : `${name}: none yet. ${heldSource(kind)}`;
}

/** Whether you can lay one more tile of a kind, by the sim's own check. */
export function canLay(kind: GroundKind, holdings: Holdings): boolean {
  return groundShort(kind, (k: StackKind) => heldOf(holdings, k)).length === 0;
}

/** The line under the tabs for a path or floor: what a tile takes, and what you're short of. */
export function groundLine(kind: GroundKind, holdings: Holdings): string {
  const { name } = GROUND_INFO[kind];
  const cost = groundCostWords(kind);
  if (cost === "free") return `${name}: free. Tap a tile to lay it, tap it again to lift it.`;
  const short = groundShort(kind, (k: StackKind) => heldOf(holdings, k));
  if (short.length === 0) return `${name}: ${cost} a tile. You have enough.`;
  const missing = short.map((s) => thingCount(s.kind, s.count)).join(" and ");
  return `${name}: ${cost} a tile. You need ${missing} more.`;
}

/** The line under the tabs for a free block or the hearth. */
export function blockLine(kind: string): string {
  if (kind === "hearth") return "Hearth: your home tile, where Home brings you.";
  const name = kind.charAt(0).toUpperCase() + kind.slice(1);
  return `${name}: free. Tap a tile to place it, tap a block to remove it.`;
}

/** Which tab a pick lives on. */
export function tabOf(pick: string): PaletteTab {
  if ((GROUND_KINDS as readonly string[]).includes(pick)) return "ground";
  if (isDecorKind(pick) || isFurnitureKind(pick)) return "furniture";
  return "blocks";
}

// ---------- painting ----------

/**
 * One choice in a row: a chip with a picture, and a count badge when it has one. A dimmed one
 * still picks, so the line under the tabs can say why the world would refuse it; its label says
 * so too.
 */
function choice(
  attrs: Record<string, string>,
  label: string,
  picture: Element,
  opts: { count?: number; dim: boolean; picked: boolean },
): HTMLButtonElement {
  return h(
    "button",
    {
      class: opts.dim ? "palette-choice dim" : "palette-choice",
      attrs: {
        type: "button",
        ...attrs,
        "aria-label": label,
        "aria-pressed": String(opts.picked),
      },
    },
    h("span", { class: "chip palette-chip" }, picture),
    opts.count === undefined
      ? null
      : h("span", {
          class: "decor-count",
          attrs: { "aria-hidden": "true" },
          text: String(opts.count),
        }),
  );
}

/** Fill the Paths row: every kind, dimmed where you can't pay for a tile. */
export function paintGroundRow(row: HTMLElement, holdings: Holdings, picked: string): void {
  row.replaceChildren(
    ...GROUND_KINDS.map((kind) =>
      choice(
        { "data-ground": kind },
        `${GROUND_INFO[kind].name}, ${groundCostWords(kind)}${canLay(kind, holdings) ? "" : ", not enough"}`,
        groundArt(kind, { size: 32 }),
        { dim: !canLay(kind, holdings), picked: kind === picked },
      ),
    ),
  );
}

/** Fill the Furniture row: every held block in catalog order, with how many you hold. */
export function paintHeldRow(row: HTMLElement, holdings: Holdings, picked: string): void {
  row.replaceChildren(
    ...HELD_KINDS.map((kind) => {
      const n = heldOf(holdings, kind);
      return choice({ "data-block": kind }, heldLabel(kind, n), itemArt(kind, { size: 30 }), {
        ...(n > 0 ? { count: n } : {}),
        dim: n === 0,
        picked: kind === picked,
      });
    }),
  );
}
