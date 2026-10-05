---
title: Strip video and model metadata in place, and refuse what can't be read
date: 2026-10-05
status: accepted
tags: [security, privacy, social]
---

# Strip video and model metadata in place, and refuse what can't be read

## Context

[Decision 0014](0014-turn-away-text-aimed-at-ai-readers-and-strip-image-metadata.md) strips EXIF and XMP from images, but videos and models were stored as uploaded (issue #27). Phone videos carry the owner's location: Apple writes `©xyz` in `moov/udta` and `com.apple.quicktime.location.ISO6709` in `moov/meta`, Android writes `©xyz` or 3GPP `loci`, and action cameras record a GPS track (GoPro's `gpmd`, Google's `camm`) whose samples sit in `mdat` next to the frames. WebM can carry tags, attachments, and chapters. A `.glb` can hold free text in any `extras` object, XMP packets, and textures that are phone photos with their own EXIF.

The code runs in the Worker and the Durable Object, so it has to be TypeScript on `Uint8Array`: no ffmpeg, no native code. Uploads are up to 25 MB, so a second full copy of a video matters in a 128 MB isolate. Every file is hostile input.

We weighed Cloudflare Stream (re-encodes and drops metadata, but costs per minute stored and served, changes how media is served, and does nothing for models) and a remux on upload (needs a muxer we'd have to write or ship, and rewrites every offset). Both are more than the problem needs.

## Decision

Edit the container in place, keeping its length, so no media data moves (`server/src/strip-mp4.ts`, `strip-webm.ts`, `strip-glb.ts`, called from `stripMetadata` before the upload caps are checked).

- **MP4 and MOV.** A removed box becomes a `free` box of the same size with a zeroed payload. No parent changes size and nothing moves, so the `stco` and `co64` chunk offsets stay right without fixups. Freed: `udta`, `meta`, `©xyz`, `loci`, and `XMP_` wherever we walk; `uuid` boxes outside fragments (XMP, Canon's EXIF); anything at the top level, in `moov`, or in `trak` that a player doesn't need (an allow list); and timed metadata tracks (handler `meta` or `camm`, or sample entry `gpmd`, `camm`, or `mebx`), whose samples are also zeroed inside `mdat`. Creation and modification times in `mvhd`, `tkhd`, and `mdhd` are zeroed. Bytes after the last whole top-level box (vendor trailers) are cut off.
- **WebM.** The same idea with Void elements: `Tags`, `Attachments`, `Chapters`, and unknown segment children become Void elements of the same size, as do the segment title, its recording date, track names, CRC-32 elements of the edited parents, and seek entries that pointed at removed elements. Clusters of unknown size (MediaRecorder writes them) are walked to their end.
- **GLB.** Every `extras` object and every extension whose name contains `xmp` (`KHR_xmp_json_ld`, `KHR_xmp`) is removed, with their entries in `extensionsUsed` and `extensionsRequired`. `asset.copyright` stays because it's the author's attribution, which they chose to publish, and `asset.generator` stays because it names a tool, not a person. Object names stay because viewers and animations use them. If the JSON changed it's re-serialized, written in place padded with spaces when it fits (the binary chunk doesn't move) and rebuilt otherwise. Chunks after the binary one are dropped. Embedded JPEG, PNG, and WebP textures are scrubbed in place: JPEG APP1, APP13, and comment payloads are zeroed; PNG text, EXIF, and time chunks become a private `voId` chunk with zeroed data and a fresh CRC; WebP EXIF and XMP chunks become zeroed `JUNK` chunks. Base64 `data:` images and buffers are decoded, scrubbed, and re-encoded. JSON over 2 MB is refused before parsing.
- **Refuse what can't be read.** A video or model whose structure doesn't parse (a box or element longer than its parent, sample tables that point outside `mdat`, a GLB header length that doesn't match, JSON that isn't JSON) is refused with `bad_request` instead of stored, because a file we couldn't walk is one we couldn't clean. Fragmented MP4s with a timed metadata track are refused too, since their samples sit in `moof` runs we don't trace. Images keep 0014's behavior: a malformed one is stored as is.

Every length is checked against its parent before it's used, loops advance by at least a header each step, sample counts are checked against the size of their table before any loop, and nothing is allocated from an unchecked length. Tests in `server/src/strip-metadata.test.ts` cover hand-built files and run every truncation plus thousands of seeded random corruptions of each.

## Consequences

- Stored videos and models are the uploaded bytes minus the metadata, the same length (or shorter by a trailer), with no transcode and no extra service.
- Some odd but playable files are now refused: a damaged MP4 or WebM, a fragmented MP4 with a GPS track, a GLB with 2 MB of JSON. The message asks the person to export the file again.
- Not covered: GPS that a camera burns into the video frames or writes into subtitle tracks (some drones and dashcams), key-value data in KTX2 textures, GIF comments and XMP, and secondary images appended after a JPEG's end (MPF, gain maps), which 0014's image stripper keeps.
- If uploads ever move to Cloudflare Stream or a transcoding pipeline, re-encoding would cover video and this video code can go. The GLB part would stay.
