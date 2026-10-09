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
 *
 * The Town Hall's build editor paints the same rows with no holdings (`null`): the town builds
 * from nobody's things, so nothing there is dimmed or counted (decision 0101).
 */
import {
  BLOCK_COLORS,
  type BlockKind,
  blockNeeds,
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
function heldSource(kind: HeldKind): string {
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

/**
 * What one more of a block still needs from what you hold, by the sim's own `blockNeeds` (a pond's
 * stone, stairs' wood): empty when you can place it.
 */
export function blockShort(
  kind: BlockKind,
  holdings: Holdings,
): { kind: StackKind; count: number }[] {
  return blockNeeds(kind).flatMap(([need, n]) => {
    const missing = n - heldOf(holdings, need);
    return missing > 0 ? [{ kind: need, count: missing }] : [];
  });
}

/** The line under the tabs for stairs (RFC 0028): what they take, and what you're short of. */
export function stairsLine(holdings: Holdings): string {
  const cost = blockNeeds("stairs")
    .map(([kind, n]) => thingCount(kind, n))
    .join(" and ");
  const lead = `Stairs: ${cost}, up to the storey above. Stand on them and tap Go up.`;
  const short = blockShort("stairs", holdings);
  if (short.length === 0) return `${lead} You have enough.`;
  return `${lead} You need ${short.map((s) => thingCount(s.kind, s.count)).join(" and ")} more.`;
}

/** The line under the tabs for a free block or the hearth. */
export function blockLine(kind: string): string {
  if (kind === "hearth") {
    return "Hearth: your home. Tap a tile on your plot to set it. Home brings you back here, and your pantry arrives here: seeds the first time, then sugar and jars each day.";
  }
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
 * One choice in a row: a chip with a picture (or in a block's color), and a count badge when it
 * has one. A dimmed one still picks, so the line under the tabs can say why the world would refuse
 * it; its label says so too.
 */
function choice(
  attrs: Record<string, string>,
  label: string,
  picture: Element | null,
  opts: { count?: number; dim: boolean; picked: boolean; color?: string },
): HTMLButtonElement {
  const chip = h("span", { class: "chip palette-chip" }, picture);
  if (opts.color) chip.style.background = opts.color;
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
    chip,
    opts.count === undefined
      ? null
      : h("span", {
          class: "decor-count",
          attrs: { "aria-hidden": "true" },
          text: String(opts.count),
        }),
  );
}

/** Fill a row of plain blocks, each a chip in its color. Placing one costs nothing. */
export function paintBlockRow(row: HTMLElement, kinds: readonly BlockKind[], picked: string): void {
  row.replaceChildren(
    ...kinds.map((kind) =>
      choice({ "data-block": kind }, kind.charAt(0).toUpperCase() + kind.slice(1), null, {
        dim: false,
        picked: kind === picked,
        color: BLOCK_COLORS[kind],
      }),
    ),
  );
}

/**
 * Fill the Paths row: every kind, dimmed where you can't pay for a tile. With no holdings (a Town
 * Hall build) nothing is dimmed.
 */
export function paintGroundRow(row: HTMLElement, holdings: Holdings | null, picked: string): void {
  row.replaceChildren(
    ...GROUND_KINDS.map((kind) => {
      const { name } = GROUND_INFO[kind];
      const short = holdings !== null && !canLay(kind, holdings);
      const label =
        holdings === null
          ? name
          : `${name}, ${groundCostWords(kind)}${short ? ", not enough" : ""}`;
      return choice({ "data-ground": kind }, label, groundArt(kind, { size: 32 }), {
        dim: short,
        picked: kind === picked,
      });
    }),
  );
}

/**
 * Fill the Furniture row: every held block in catalog order, with how many you hold. With no
 * holdings (a Town Hall build) there are no counts and nothing is dimmed.
 */
export function paintHeldRow(row: HTMLElement, holdings: Holdings | null, picked: string): void {
  row.replaceChildren(
    ...HELD_KINDS.map((kind) => {
      const picture = itemArt(kind, { size: 30 });
      if (holdings === null) {
        return choice({ "data-block": kind }, ITEM_INFO[kind].name, picture, {
          dim: false,
          picked: kind === picked,
        });
      }
      const n = heldOf(holdings, kind);
      return choice({ "data-block": kind }, heldLabel(kind, n), picture, {
        ...(n > 0 ? { count: n } : {}),
        dim: n === 0,
        picked: kind === picked,
      });
    }),
  );
}
