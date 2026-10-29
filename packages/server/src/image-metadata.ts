/**
 * What counts as metadata in an image, for both strippers: `strip-metadata.ts`, which copies an
 * uploaded image without it, and `strip-glb.ts`, which blanks it in place in a model's textures.
 * Adding a segment or chunk here takes it out of both ([decision 0014](../../../docs/knowledge/decisions/0014-turn-away-text-aimed-at-ai-readers-and-strip-image-metadata.md)).
 */

/** JPEG segments to drop: APP1 (EXIF, XMP), APP13 (IPTC), COM (comments). ICC (APP2) and Adobe (APP14) stay. */
export const JPEG_DROP: ReadonlySet<number> = new Set([0xe1, 0xed, 0xfe]);

/** PNG chunks to drop: EXIF, text of every kind, and the last-modified time. */
export const PNG_DROP: ReadonlySet<string> = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

/** WebP chunks to drop: EXIF and XMP. */
export const WEBP_DROP: ReadonlySet<string> = new Set(["EXIF", "XMP "]);

/** The bits of a WebP's VP8X flags byte that announce EXIF and XMP chunks, cleared with them. */
export const VP8X_METADATA_FLAGS = 0x0c;
