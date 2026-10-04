// Generated from ryanio/op-secrets lib/declared-secrets.mjs (ec7027b, body 6fe98541fa0f). Edit it there and run `node sync.mjs`; changes made here are overwritten.
/**
 * Reads a script's own declaration of the secrets it needs.
 *
 * The key list for a command lived in three places: the scheduled-routine
 * prompt, the runbook recipe, and the script's usage docstring. They drift, and
 * the drift is expensive rather than loud. On 2026-08-09 the routine prompt's
 * list for `churn-autopsy.ts` omitted `AI_GATEWAY_BASE_URL`; the run spent a
 * vault read, lost all ~30 AI judges to `AI_GATEWAY_BASE_URL not set`, and still
 * printed sections A and D normally, which is exactly what a healthy run looks
 * like at a glance.
 *
 * So the script owns the list. Declare it once, near the top of the file:
 *
 *     @secrets FIRESTORE_SERVICE_ACCOUNT, ANTHROPIC_API_KEY, AI_GATEWAY_BASE_URL
 *
 * Then either `--only auto` (derive it) or an explicit `--only` that is checked
 * against it. A caller naming fewer keys than the script declares now fails
 * locally, before any vault call, with the exact command to run instead.
 */
import { readFileSync } from 'node:fs'

/** How far into a file to look. The declaration belongs in the header block. */
const HEAD_BYTES = 8000

const SCRIPT_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/
const SECRETS_RE = /@secrets[ \t]+([A-Z0-9_,\t ]+)/
const SPLIT_RE = /[,\s]+/
const KEY_RE = /^[A-Z][A-Z0-9_]*$/
/** A JSDoc continuation line: the leading ` * ` a wrapped list carries. */
const JSDOC_PREFIX = /^\s*\*?[ \t]*/
/** A continuation line holding nothing but more keys. */
const KEYS_ONLY = /^[A-Z0-9_,\t ]+$/

/**
 * The script path inside a command like `npx tsx scripts/foo.ts --flag`.
 * Returns null when the command is not a script invocation (a curl, a shell
 * pipeline), which is the case where there is nothing to declare.
 */
export function scriptPathFrom(cmd) {
	for (const arg of cmd) {
		if (typeof arg === 'string' && SCRIPT_EXT.test(arg) && !arg.startsWith('-')) {
			return arg
		}
	}
	return null
}

/**
 * Keys a script declares via `@secrets`, or null when it declares nothing.
 * Null means "unknown", never "none": most scripts have no declaration yet, and
 * treating that as an empty requirement would turn this into a footgun that
 * silently strips every key.
 */
export function declaredSecrets(scriptPath) {
	let head
	try {
		const buf = readFileSync(scriptPath)
		head = buf.subarray(0, HEAD_BYTES).toString('utf8')
	} catch {
		return null
	}
	const lines = head.split('\n')
	const start = lines.findIndex((l) => SECRETS_RE.test(l))
	if (start === -1) {
		return null
	}
	// A long list gets wrapped, and reading only the first line would silently
	// drop the rest — the exact quiet under-resolve this file exists to stop.
	// Keep taking following lines for as long as they hold nothing but keys.
	const parts = [lines[start].match(SECRETS_RE)[1]]
	for (const line of lines.slice(start + 1)) {
		const rest = line.replace(JSDOC_PREFIX, '')
		if (rest === '' || !KEYS_ONLY.test(rest)) {
			break
		}
		parts.push(rest)
	}
	const keys = parts
		.join(',')
		.split(SPLIT_RE)
		.map((s) => s.trim())
		.filter((s) => KEY_RE.test(s))
	return keys.length > 0 ? keys : null
}

/**
 * Reconcile what the caller asked for against what the script declares.
 *
 * `only` may be null (nothing passed) or the array `--only` produced; pass
 * `auto: true` for `--only auto`. Returns `{ keys, notes, fatal }`, where a
 * fatal string is a ready-to-print explanation and the caller should exit
 * non-zero without resolving anything.
 */
export function reconcileSecrets({ only, auto, cmd }) {
	const scriptPath = scriptPathFrom(cmd)
	const declared = scriptPath ? declaredSecrets(scriptPath) : null

	if (auto) {
		if (!declared) {
			return {
				fatal:
					`--only auto: ${scriptPath ?? 'this command'} declares no @secrets line, so there is\n` +
					'nothing to derive. Add one to the script header:\n' +
					'  @secrets KEY1, KEY2\n' +
					'or name the keys explicitly with --only KEY1,KEY2.',
			}
		}
		return { keys: declared, notes: [`--only auto: using @secrets from ${scriptPath}`] }
	}

	if (!declared) {
		return { keys: only, notes: [] }
	}

	const missing = declared.filter((k) => !only.includes(k))
	if (missing.length > 0) {
		return {
			fatal:
				`--only is missing ${missing.length} key(s) that ${scriptPath} declares it needs:\n` +
				`  ${missing.join(', ')}\n` +
				'\n' +
				'This is refused before any vault call because the failure it causes is quiet:\n' +
				'a script that resolves most of its keys usually still runs, still prints, and\n' +
				'still looks healthy while the part needing the missing key silently does\n' +
				'nothing. Run it as:\n' +
				`  --only ${declared.join(',')}\n` +
				'or let the script own the list:\n' +
				'  --only auto',
		}
	}

	const extra = only.filter((k) => !declared.includes(k))
	const notes = []
	if (extra.length > 0) {
		notes.push(
			`--only names ${extra.length} key(s) ${scriptPath} does not declare (${extra.join(', ')}); ` +
				'resolving them anyway, but one of the two lists is stale'
		)
	}
	return { keys: only, notes }
}
