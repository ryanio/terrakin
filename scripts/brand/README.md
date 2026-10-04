# Brand assets

The Terrakin logo is code. `logo.ts` draws the mark (a small isometric plot of earth with a hearth on it) from one config block, and every logo, favicon, app icon and social card is generated from that.

## Changing the logo

1. Edit the config at the top of `logo.ts`: `PALETTE` (colors), `MARK` (the full mark's geometry), `FAVICON` (the simplified mark used at 16 to 48px), and `BRAND` (name, tagline, type weights).
2. Run `pnpm brand`.
3. Look at the result before committing. `pnpm brand --preview <dir>` also writes `<dir>/preview.png`, with the mark at 512, 64, 32 and 16px and pixel zooms of the 16px and 32px favicons on light and dark, plus a copy of the social card.
4. Commit `logo.ts` and the regenerated files together.

The output is deterministic: rerunning without a config change produces identical files.

## Generated files

Do not hand-edit these. Change `logo.ts` and rerun instead.

| File (under `client/public/`) | What |
|------|------|
| `brand/mark.svg` | The mark alone, transparent background |
| `brand/wordmark.svg` | Mark plus "terrakin" in Fraunces, outlined as paths (no font needed). The text turns paper-colored under `prefers-color-scheme: dark` |
| `favicon.svg` | Simplified mark for browser tabs; its outline turns paper-colored on dark browser chrome |
| `favicon.ico` | 16, 32 and 48px PNGs in one ICO, for anything that ignores the SVG |
| `apple-touch-icon.png` | 180x180, opaque paper background |
| `icon-192.png`, `icon-512.png` | Web app icons (paper rounded square) |
| `icon-maskable-512.png` | Full-bleed maskable icon, mark kept inside the 80% safe circle |
| `site.webmanifest` | Web app manifest pointing at the icons above |
| `og.png` | 1200x630 social card: mark, name and tagline on grained paper |

## Used elsewhere

`logo.ts` also exports its drawing helpers (`markElements` with a `palette` override, `withTypesetter`, `png`). The townsfolk seed (`scripts/townsfolk/art.ts`) uses them to draw each resident's home as the mark's house in that resident's colors. Importing the file doesn't regenerate anything; only running it does. After changing the helpers, run `pnpm brand` and check that `git status` shows nothing new under `client/public`.

## How it works

Rasterizing uses `@resvg/resvg-js`. Text comes from `@fontsource/fraunces` (static WOFF files): the script unwraps the WOFF into a plain font in a temp directory, has resvg lay the text out and convert it to outlines, and puts those outlines in the SVGs. Nothing is downloaded at run time and no installed system font is used, so the output is the same on any machine.
