/**
 * The fonts a card draws with: static WOFF files from @fontsource (satori reads TTF, OTF and WOFF,
 * not WOFF2), latin and latin-ext for each weight. `text.ts` keeps card text to what these cover.
 * `worker.ts` imports the same files by name; keep the two lists in step (a test checks).
 */

export const FONTS = [
  {
    name: "Fraunces",
    weight: 400,
    file: "@fontsource/fraunces/files/fraunces-latin-400-normal.woff",
  },
  {
    name: "Fraunces",
    weight: 400,
    file: "@fontsource/fraunces/files/fraunces-latin-ext-400-normal.woff",
  },
  {
    name: "Fraunces",
    weight: 600,
    file: "@fontsource/fraunces/files/fraunces-latin-600-normal.woff",
  },
  {
    name: "Fraunces",
    weight: 600,
    file: "@fontsource/fraunces/files/fraunces-latin-ext-600-normal.woff",
  },
  { name: "Figtree", weight: 600, file: "@fontsource/figtree/files/figtree-latin-600-normal.woff" },
  {
    name: "Figtree",
    weight: 600,
    file: "@fontsource/figtree/files/figtree-latin-ext-600-normal.woff",
  },
  { name: "Figtree", weight: 700, file: "@fontsource/figtree/files/figtree-latin-700-normal.woff" },
  {
    name: "Figtree",
    weight: 700,
    file: "@fontsource/figtree/files/figtree-latin-ext-700-normal.woff",
  },
  { name: "Figtree", weight: 800, file: "@fontsource/figtree/files/figtree-latin-800-normal.woff" },
] as const;
