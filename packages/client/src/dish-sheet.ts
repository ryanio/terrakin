/**
 * The Thanksgiving feast's "Bring a dish" sheet (RFC 0034): the dishes you hold, each with Bring,
 * which sends `bring_dish`. Loaded only when the button is tapped. The server decides what counts
 * as a dish and whether you can bring one; the list only leaves out what it would refuse.
 */
import { ITEM_INFO, isDish, TEA } from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import { type ArtKind, itemArt } from "@terrakin/ui/item-art";
import {
  closeOverlay,
  errorLine,
  itemRow,
  itemRows,
  openOverlay,
  sheet,
  toast,
  whileBusy,
} from "@terrakin/ui/ui";
import { eventsApi } from "./api/events";
import { inventoryApi } from "./api/inventory";
import { actProblem, worldApi } from "./api/world";
import { teaLines } from "./event-format";

/** What to call a kind: its catalog name, lowercase after "a". */
const nameOf = (kind: string) =>
  Object.hasOwn(ITEM_INFO, kind) ? ITEM_INFO[kind as keyof typeof ITEM_INFO].name : kind;

/** The feast's own words for a refusal the sim says in an agent's terms. */
const words = (code: string, message: string) =>
  code === "not_at_feast" ? "Go to the feast first: tap Go on its card." : message;

/**
 * Open the sheet for the feast `event`, and call `brought` once the server took a dish. Bring goes
 * to the feast first, as Go does, so a dish can be brought from anywhere.
 */
export async function openDishSheet(event: string, brought: () => void, tea = false) {
  const [r, read] = await Promise.all([
    inventoryApi.inventory(),
    tea ? eventsApi.event(event) : Promise.resolve(undefined),
  ]);
  if (!r.ok) return toast(r.message);
  const inv = r.data.inventory;
  // Who a cup would reach, and why not (RFC 0047): Serve waits while nobody would be counted.
  const reach = read?.ok ? read.data.event.tea : undefined;
  const nobody = reach !== undefined && !reach.guests.some((g) => g.cup);
  // At your own event the dish is a pot of tea (RFC 0047), as the world takes there.
  const takes = (kind: string) => (tea ? kind === TEA : isDish(kind));
  const choices = [
    ...(inv?.goods ?? []).filter((g) => takes(g.kind)).map((g) => ({ item: g.id, kind: g.kind })),
    ...(tea ? [] : (inv?.stacks ?? []))
      .filter((s) => isDish(s.kind))
      .map((s) => ({ item: s.kind, kind: s.kind })),
  ];
  const problem = errorLine("dish-problem");
  const rows = choices.map(({ item, kind }) => {
    const bring = h("button", {
      class: "btn-primary small",
      attrs: { type: "button", ...(nobody ? { disabled: true } : {}) },
      text: tea ? "Serve" : "Bring",
    });
    bring.addEventListener("click", async () => {
      const done = await whileBusy(bring, async () => {
        // Already there is no problem: the world answers it without moving anyone.
        await worldApi.act({ type: "join_event", event });
        return worldApi.act({ type: "bring_dish", item });
      });
      const why = actProblem(done, words);
      if (why) {
        problem.textContent = why;
        return;
      }
      closeOverlay(s.dialog);
      toast(
        tea
          ? "You set out a pot of tea for your guests."
          : `You set ${nameOf(kind).toLowerCase()} on the town's table.`,
      );
      brought();
    });
    return itemRow({
      lead: itemArt(kind as ArtKind, { size: 40 }),
      name: nameOf(kind),
      trail: bring,
    });
  });
  const s = sheet(
    {
      id: "dish-sheet-title",
      title: tea ? "Serve tea" : "Bring a dish",
      lede: tea
        ? choices.length > 0
          ? "Set out a pot of tea for your guests. Everyone at your event takes home a cup from you, and each guest who counts for Hosting earns you a little more."
          : "Brew a pot of tea at a kitchen first: it takes a teapot, which you keep, and two bunches of herbs."
        : choices.length > 0
          ? "Pick one thing you made for the feast's table. It stays there for good."
          : "You hold nothing from a kitchen yet. A kitchen at your hearth makes pies, jams, soups, drinks, and sweets.",
    },
    reach
      ? h(
          "div",
          { class: "stack tight dish-tea" },
          ...teaLines(reach).map((line) => h("p", { class: "hint", text: line })),
        )
      : null,
    rows.length > 0 ? itemRows(rows) : null,
    problem,
  );
  openOverlay(s.dialog);
}
