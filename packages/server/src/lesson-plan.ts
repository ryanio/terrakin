/**
 * What each townsfolk teaches (RFC 0024): a short list of specialties by persona key (the
 * townsfolk's handle), in the order they offer them. The server's lessons run
 * (`townsfolk-lessons.ts`) teaches one to a resident standing near that townsfolk, and profiles
 * list them as what the townsfolk can teach. `scripts/townsfolk/personas.ts` reads them from here,
 * so the cast and the server never disagree.
 *
 * No imports, like `tip-plan.ts`, so the seed script can load it as it is. Every name is a recipe
 * card's (`townsfolk-lessons.test.ts` checks), never resident text.
 */
export const SPECIALTIES = {
  juniper: ["herb_sachet", "flower_wreath"],
  bram: ["barrel", "well"],
  clem: ["lemonade", "tomato_sauce", "pumpkin_pie"],
  pip: ["signpost", "fried_minnows"],
  otis: ["bookshelf", "pumpkin_soup"],
  marlo: ["campfire", "fish_stew"],
  sable: ["lamp_post", "cranberry_punch"],
  ansel: ["flower_box", "flower_wreath"],
} as const satisfies Record<string, readonly string[]>;

/** A townsfolk's specialties, by its handle. None for a handle with no list above. */
export function specialtiesFor(handle: string | undefined): readonly string[] {
  return handle !== undefined && Object.hasOwn(SPECIALTIES, handle)
    ? SPECIALTIES[handle as keyof typeof SPECIALTIES]
    : [];
}
