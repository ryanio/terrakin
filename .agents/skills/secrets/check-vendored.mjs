#!/usr/bin/env node
// Generated from ryanio/op-secrets lib/check-vendored.mjs (aa5fa4d, body 7315f5722d37). Edit it there and run `node sync.mjs`; changes made here are overwritten.
/**
 * Fails when a file vendored from ryanio/op-secrets was edited in place.
 *
 * sync.mjs stamps each copy's banner with a hash of the body it wrote. An edit
 * made in the consumer repo changes the body but not the stamp, and the next
 * sync would silently overwrite it. This catches that at commit time instead,
 * and `op-sdk.mjs` warns about it at runtime.
 *
 * Usage:  node <secrets dir>/check-vendored.mjs
 * Checks every `.mjs` beside it; exits 1 and names each edited file.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BANNER_RE =
	/^\/\/ Generated from ryanio\/op-secrets lib\/\S+ \(\w+, body ([0-9a-f]{12})\)\..*\n/m

export function bodyHash(text) {
	return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

/** True when the file carries a banner whose body hash no longer matches. */
export function editedInPlace(path) {
	const text = readFileSync(path, 'utf8')
	const m = text.match(BANNER_RE)
	return m ? bodyHash(text.replace(BANNER_RE, '')) !== m[1] : false
}

// realpath: the module URL is resolved through symlinks (macOS /var is one), argv is not.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const dir = dirname(fileURLToPath(import.meta.url))
	const edited = readdirSync(dir).filter((f) => f.endsWith('.mjs') && editedInPlace(join(dir, f)))
	if (edited.length > 0) {
		console.error(
			`Edited in place, but generated from ryanio/op-secrets: ${edited.join(', ')}\n` +
				'Make the change in its lib/ and run `npm run sync` there, ' +
				'or restore these files with `git checkout -- <file>`.'
		)
		process.exit(1)
	}
}
