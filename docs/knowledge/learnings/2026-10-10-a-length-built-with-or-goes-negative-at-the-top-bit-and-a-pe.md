---
title: A length built with | or << goes negative at the top bit, and a per-item object costs more than the file
date: 2026-10-10
tags: [server, security, uploads]
---

# A length built with | or << goes negative at the top bit, and a per-item object costs more than the file

**Symptom:** a 38-byte WebP upload took the server past 4 GB of memory in seconds. Separately, a 5 MB JPEG made of 4-byte segments cost 188 MB of heap to strip, and a WebP of empty chunks 160 MB, where the world object has 128 MB in all.

**Cause:** two things in the image strippers of `packages/server/src/strip-metadata.ts`.

`stripWebp` built a chunk's 32-bit size with `|`. JavaScript's `|`, `&`, `^`, `~`, and `<<` work on signed 32-bit integers, so a top byte of 0x80 or more gave a negative size. The check `i + 8 + size > b.length` then passed, the walk went back about 889 million bytes, and on the way forward again it kept an empty chunk every 8 bytes.

All three strippers also kept one `Uint8Array` (a view or a copy) for each segment or chunk and joined them at the end. A typed array costs about 100 bytes of heap however few bytes it shows, so a file of the smallest items a format allows costs 30 to 40 times its own size as a JPEG or WebP, and 11 to 18 times as a PNG.

**Fix or workaround:** build a length of 32 bits one of three ways: add the bytes up (`a + b * 0x100 + c * 0x10000 + d * 0x1000000`), put `>>> 0` on what `|` or `<<` gave, or read it with `DataView.getUint32`. A 16-bit length is safe with `|`. A walker's position then only ever moves forward, since every size is zero or more.

A stripper copies what it keeps into one buffer as it goes (`Kept` in `strip-metadata.ts`) and holds nothing for each item, so it costs at most twice the file's size. The tests in `strip-metadata.test.ts` under "image metadata" run the 38 bytes, every truncation and 3,000 seeded corruptions of each image type, and a cap-sized file of the smallest items with the heap's growth measured. That measure is `v8.getHeapSpaceStatistics()` summed over every space but the new ones, after a forced collection: objects held through the walk are moved out of the new space and counted (48 to 145 MB before the fix, under 40 KB after), short-lived garbage never is, and plain `heapUsed` swings by tens of megabytes either way. To run a test like these against code that may not stop, give the run a small heap: `NODE_OPTIONS=--max-old-space-size=384 pnpm vitest run --pool=forks ...`.
