/**
 * The world's build bar (RFC 0016): three tabs. Blocks are the free blocks and the hearth, always
 * there. Paths lists every kind of path and flooring with what a tile takes. Furniture lists the workbench's
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
  type Finish,
  FLOWER_KINDS,
  FURNITURE_KINDS,
  type FurnitureKind,
  type Glaze,
  GROUND_INFO,
  GROUND_KINDS,
  type Grade,
  type GroundKind,
  gradedLabel,
  groundCostWords,
  groundShort,
  ITEM_INFO,
  type ItemKind,
  isDecorKind,
  isFurnitureKind,
  isMaterialKind,
  MATERIAL_KINDS,
  type MaterialKind,
  PAST_PLAIN,
  type PastPlain,
  type StackKind,
} from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import { groundArt } from "@terrakin/ui/ground-art";
import { itemArt, thingPicture } from "@terrakin/ui/item-art";
import {
  CLAY_WHERE,
  gatherHint,
  kilnCost,
  madeName,
  needsLine,
  SHOP_WHERE,
  thingCount,
  thingName,
} from "./things";
import "./build-palette.css";

export const PALETTE_TABS = ["blocks", "ground", "furniture"] as const;
export type PaletteTab = (typeof PALETTE_TABS)[number];
/** What each tab says. */
export const PALETTE_TAB_WORDS: Record<PaletteTab, string> = {
  blocks: "Blocks",
  ground: "Paths",
  furniture: "Furniture",
};

/**
 * A block you hold before you place it: decor from the shop, furniture from a workbench, or a
 * made material (RFC 0041), which is also from a workbench but is a wall rather than a thing to
 * stand on the floor.
 */
export type HeldKind = DecorKind | FurnitureKind | MaterialKind;
/** Every held block in the Furniture tab, in its order: furniture, then the shop's decor. */
export const HELD_KINDS: readonly (DecorKind | FurnitureKind)[] = [
  ...FURNITURE_KINDS,
  ...DECOR_KINDS,
];

/** What you hold, by kind, as far as the build bar needs: kinds at 0 are left out. */
export type Holdings = ReadonlyMap<string, number>;

/** Holdings from your things' stacks. */
export function holdingsFromStacks(
  stacks: readonly { kind: string; grade?: string | undefined; count: number }[],
): Holdings {
  const out = new Map<string, number>();
  // The bar places plain material: a graded stack (RFC 0051) is an entry of its own, left out.
  for (const s of stacks) if (s.count > 0 && s.grade === undefined) out.set(s.kind, s.count);
  return out;
}

/**
 * The holdings after an inventory event's changes, each of which carries the count held after
 * it. The same map back when nothing changed, so the bar isn't redrawn.
 */
export function withChanges(
  holdings: Holdings,
  changes: readonly { kind: string; grade?: string | undefined; count: number }[] | undefined,
): Holdings {
  // A graded change's `count` is of its grade (RFC 0051), never the plain stack the bar holds.
  const moved = (changes ?? []).filter(
    (c) => c.grade === undefined && (holdings.get(c.kind) ?? 0) !== c.count,
  );
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

/**
 * The graded made materials you hold (RFC 0051), by `kind:grade`, apart from the plain holdings:
 * `GET /v1/inventory` lists each grade as a stack of its own, and an event's graded change counts
 * that grade.
 */
export type GradedHoldings = ReadonlyMap<string, number>;

/** Graded holdings from your things' stacks. */
export function gradedFromStacks(
  stacks: readonly { kind: string; grade?: string | undefined; count: number }[],
): GradedHoldings {
  const out = new Map<string, number>();
  for (const s of stacks) if (s.grade && s.count > 0) out.set(`${s.kind}:${s.grade}`, s.count);
  return out;
}

/** Graded holdings after an event's changes, the same map back when no graded count moved. */
export function withGradedChanges(
  graded: GradedHoldings,
  changes: readonly { kind: string; grade?: string | undefined; count: number }[] | undefined,
): GradedHoldings {
  const moved = (changes ?? []).filter(
    (c) => c.grade !== undefined && (graded.get(`${c.kind}:${c.grade}`) ?? 0) !== c.count,
  );
  if (moved.length === 0) return graded;
  const next = new Map(graded);
  for (const c of moved) {
    if (c.count > 0) next.set(`${c.kind}:${c.grade}`, c.count);
    else next.delete(`${c.kind}:${c.grade}`);
  }
  return next;
}

/** How many of a made material you hold at a grade: the plain holdings for plain. */
export const heldAt = (
  holdings: Holdings,
  graded: GradedHoldings,
  kind: string,
  grade: Grade,
): number => (grade === "plain" ? heldOf(holdings, kind) : (graded.get(`${kind}:${grade}`) ?? 0));

/** The grades past plain you hold of a made material, lowest first. */
export const gradesHeld = (graded: GradedHoldings, kind: string): PastPlain[] =>
  PAST_PLAIN.filter((g) => (graded.get(`${kind}:${g}`) ?? 0) > 0);

/**
 * The grade picker (RFC 0051): right after a picked made material you hold at a grade, a chip for
 * plain and one for each grade you hold, each with how many, the grade's mark on it. Nothing when
 * you hold none of it past plain, so a world without grades draws exactly as it did.
 */
export function paintGradeChips(
  row: HTMLElement,
  kind: string,
  holdings: Holdings,
  graded: GradedHoldings,
  picked: Grade,
): void {
  if (!isMaterialKind(kind)) return;
  const grades = gradesHeld(graded, kind);
  const chip = row.querySelector(`[data-block="${kind}"]`);
  if (grades.length === 0 || !chip) return;
  const chips = (["plain", ...grades] as Grade[]).map((grade) => {
    const n = heldAt(holdings, graded, kind, grade);
    return choice(
      { "data-grade": grade },
      `${gradedLabel(kind, grade)}, ${n > 0 ? n : "none"} left`,
      itemArt(kind, { size: 30, grade }),
      { count: n, dim: n === 0, picked: grade === picked },
    );
  });
  chip.after(...chips);
}

/** The line under the tabs for a made material at a grade past plain (RFC 0051). */
export function gradedHeldLine(kind: MaterialKind, grade: PastPlain, n: number): string {
  const name = gradedLabel(kind, grade);
  if (n > 0) return `${name}: ${n} left.`;
  return grade === "fine"
    ? `${name}: none yet. Make some at a workbench with its fine recipe.`
    : `${name}: none yet. Each fine craft at a workbench may come out masterwork.`;
}

/** "Paper lantern, 3 left", or "Table, none left". */
export function heldLabel(kind: HeldKind, n: number): string {
  return `${ITEM_INFO[kind].name}, ${n > 0 ? n : "none"} left`;
}

/** Where to get one more of a held block, in plain words. */
function heldSource(kind: HeldKind): string {
  if (isDecorKind(kind)) return SHOP_WHERE;
  return `Make one at a workbench from ${needsLine(kind)}.`;
}

/**
 * Fill the Materials row, inside the Blocks tab (RFC 0041): the walls and windows you made, each
 * in its own color with how many are left, dimmed at none so the line under the tabs can say what
 * one takes. With no holdings (a Town Hall build) there are none to show, since the town builds
 * from nobody's things.
 */
export function paintMaterialRow(
  row: HTMLElement,
  holdings: Holdings | null,
  picked: string,
): void {
  row.replaceChildren(
    ...MATERIAL_KINDS.map((kind) => {
      const n = holdings ? heldOf(holdings, kind) : 0;
      return choice({ "data-block": kind }, heldLabel(kind, n), null, {
        count: n,
        dim: n === 0,
        picked: kind === picked,
        color: BLOCK_COLORS[kind],
      });
    }),
  );
  row.hidden = holdings === null;
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

/** The line under the tabs for a path or flooring: what a tile takes, and what you're short of. */
export function groundLine(kind: GroundKind, holdings: Holdings): string {
  const { name } = GROUND_INFO[kind];
  const cost = groundCostWords(kind);
  if (cost === "free") return `${name}: free. Tap a tile to lay it, tap it again to lift it.`;
  const short = groundShort(kind, (k: StackKind) => heldOf(holdings, k));
  if (short.length === 0) return `${name}: ${cost} a tile. You have enough.`;
  const missing = short.map((s) => thingCount(s.kind, s.count)).join(" and ");
  return `${name}: ${cost} a tile. You need ${missing} more.${gatherHint(short.map((s) => s.kind))}`;
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
  const lead = `Stairs: ${cost}, up to the floor above. Stand on them and tap Go up.`;
  const short = blockShort("stairs", holdings);
  if (short.length === 0) return `${lead} You have enough.`;
  return `${lead} You need ${short.map((s) => thingCount(s.kind, s.count)).join(" and ")} more.${gatherHint(short.map((s) => s.kind))}`;
}

/** The line under the tabs for a kiln (RFC 0047): what it takes, and what you're short of. */
export function kilnPlaceLine(holdings: Holdings): string {
  const cost = kilnCost();
  const lead = `Kiln: ${cost}, given back when you take it up. Tap it to fire a pot overnight. ${CLAY_WHERE}`;
  const short = blockShort("kiln", holdings);
  if (short.length === 0) return `${lead} You have enough.`;
  return `${lead} You need ${short.map((s) => thingCount(s.kind, s.count)).join(" and ")} more.${gatherHint(short.map((s) => s.kind))}`;
}

/** The kiln's chip's name, its cost from the sim rather than the page: "Kiln (2 stone, ...)". */
export const kilnLabel = (): string => `Kiln (${kilnCost()}, fires a pot overnight)`;

/** The line under the tabs for a free block or the hearth. */
export function blockLine(kind: string): string {
  if (kind === "hearth") {
    return "Hearth: your home. Tap a tile on your plot to set it. Home brings you back here, and your pantry arrives here: seeds the first time, then sugar and jars each day.";
  }
  if (kind === "door") {
    return "Door: free. Put it in a gap in your walls: everyone walks through it like an open tile. Ground floor only.";
  }
  const lead =
    BLOCK_WORDS[kind] ??
    `${kind.charAt(0).toUpperCase() + kind.slice(1).replaceAll("_", " ")}: free.`;
  return `${lead} Tap a tile to place it, tap a block to remove it.`;
}

/**
 * What a free block is, and for a station what it's for, since the chip is only a color or an icon.
 * The wood and stone walls cost none of the wood and stone you pick up, which a newcomer saving for
 * a fishing rod needs to hear.
 */
const BLOCK_WORDS: Readonly<Record<string, string>> = {
  wood: "Wood wall: free, and it uses none of the wood in your things.",
  stone: "Stone wall: free, and it uses none of the stone in your things.",
  glass: "Glass window: free.",
  leaf: "Leaf hedge: free.",
  planter: "Planter: free. Place it, then tap it to plant a seed.",
  kitchen:
    "Kitchen: free. Place it, then tap it to make jam, tea, and dishes from what you grow and your pantry's sugar and jars.",
  workbench:
    "Workbench: free. Place it, then tap it to make furniture, bouquets, and a fishing rod from wood you pick up.",
  pedestal: "Pedestal: free. Place it, then tap it to show off something you made.",
};

/** Which tab a pick lives on. A made material is a wall, so it sits with the blocks. */
export function tabOf(pick: string): PaletteTab {
  if (pick === "pot") return "furniture";
  if ((GROUND_KINDS as readonly string[]).includes(pick)) return "ground";
  if (isMaterialKind(pick)) return "blocks";
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

// ---------- pots (RFC 0047) ----------

/** A pot you hold, which the build bar can set down: a made thing a kiln fired. */
export interface HeldPot {
  id: string;
  kind: ItemKind;
  glaze?: Glaze | undefined;
  finish?: Finish | undefined;
  flower?: string | undefined;
}

/** Your pots among your made things: the ones a kiln fired, which carry a glaze. */
export function potsIn(goods: readonly HeldPot[]): HeldPot[] {
  return goods.filter((g) => g.glaze !== undefined);
}

/** Your pots after an inventory event: what left goes, and a pot that came back is added. */
export function potsAfter(
  pots: readonly HeldPot[],
  e: { lost?: readonly string[] | undefined; gained?: readonly HeldPot[] | undefined },
): HeldPot[] {
  const lost = new Set(e.lost ?? []);
  const kept = pots.filter((p) => !lost.has(p.id));
  const back = potsIn(e.gained ?? []).filter((g) => !kept.some((p) => p.id === g.id));
  return [...kept, ...back];
}

/**
 * The pots you hold at the start of the Furniture row, each drawn in its glaze and named by its
 * finish, and right after a picked vase with no flower yet the flowers you hold to put in it, "No
 * flower" first, so the choice sits beside the vase on a phone rather than past every piece.
 */
export function paintPotChips(
  row: HTMLElement,
  pots: readonly HeldPot[],
  picked: string | undefined,
  holdings: Holdings,
  flower: string | undefined,
): void {
  const pot = pots.find((p) => p.id === picked);
  const flowers =
    pot?.kind === "vase" && pot.flower === undefined
      ? FLOWER_KINDS.filter((k) => heldOf(holdings, k) > 0)
      : [];
  const flowerChips =
    flowers.length === 0
      ? []
      : [
          // What the chips after a vase are for, said before them.
          h("span", { class: "palette-flower-label", text: "Put a flower in it" }),
          choice({ "data-flower": "" }, "No flower", null, {
            dim: false,
            picked: flower === undefined,
            color: BLOCK_COLORS.pot,
          }),
          ...flowers.map((k) =>
            choice(
              { "data-flower": k },
              `With a ${thingName(k).toLowerCase()}`,
              itemArt(k, { size: 30 }),
              {
                count: heldOf(holdings, k),
                dim: false,
                picked: flower === k,
              },
            ),
          ),
        ];
  row.prepend(
    ...pots.flatMap((p) => [
      choice({ "data-pot": p.id }, madeName(p), thingPicture(p, { size: 30 }), {
        dim: false,
        picked: p.id === picked,
      }),
      ...(p.id === picked ? flowerChips : []),
    ]),
  );
}

/** The line under the tabs for a pot you picked: what it is, and what a tap does with it. */
export function potPlaceLine(pot: HeldPot | undefined, flower: string | undefined): string {
  if (!pot) return "Pots: fire one at a kiln, then set it down on your plot from here.";
  const holding = flower
    ? ` It goes down with a ${thingName(flower as ItemKind).toLowerCase()} in it, which stays with the vase.`
    : "";
  return `${madeName(pot)}: tap a tile on your plot to set it down, and tap it again to take it up.${holding}`;
}
