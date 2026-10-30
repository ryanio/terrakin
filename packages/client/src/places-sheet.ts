/**
 * Places (the map's own button): a sheet listing your home, the Town Hall, the shop, the Green,
 * and each land's square (`mapPlaces`), each with a button that walks you there, or, for someone
 * who hasn't moved in yet, looks there. Choosing one closes the sheet; `world.ts` does the rest.
 */
import { h, icon } from "@terrakin/ui/dom";
import type { IconName } from "@terrakin/ui/icons";
import { closeOverlay, itemRow, itemRows, openOverlay, sheet } from "@terrakin/ui/ui";
import type { MapPlace } from "./places";

const MARK: Record<MapPlace["kind"], IconName> = {
  home: "home",
  hall: "town",
  shop: "shop",
  green: "paw",
  square: "pin",
};

export function openPlacesSheet(o: {
  places: readonly MapPlace[];
  /** Walk there; otherwise the map only looks. */
  walks: boolean;
  choose: (place: MapPlace) => void;
}) {
  const verb = o.walks ? "Walk there" : "Look";
  const rows = o.places.map((place) =>
    itemRow({
      lead: icon(MARK[place.kind], "icon places-mark"),
      name: place.name,
      lines: [place.line],
      plain: true,
      className: "places-row",
      trail: h(
        "button",
        {
          class: "pill-button small",
          attrs: { type: "button", "aria-label": `${verb}: ${place.name}` },
          on: {
            click: () => {
              closeOverlay(s.dialog);
              o.choose(place);
            },
          },
        },
        verb,
      ),
    }),
  );
  const s = sheet(
    {
      id: "places-title",
      title: "Places",
      className: "places-sheet",
      closeOnBackdrop: true,
      lede: o.walks
        ? "Pick a place and you walk there."
        : "Pick a place to look at it. Move in to walk there.",
    },
    itemRows(rows, { className: "places-list" }),
  );
  openOverlay(s.dialog);
  s.card.focus();
}
