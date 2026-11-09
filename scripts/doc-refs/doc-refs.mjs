#!/usr/bin/env node
// Generated from ryanio/doc-refs lib/doc-refs.mjs (126fa63, body 19ad2866b0c9). Edit it there and run `npm run sync`; changes made here are refused.
import { execFileSync } from 'node:child_process'
/**
 * Checks that the docs agents read still point at things that exist.
 *
 *   node doc-refs.mjs            exit 1 on any broken reference
 *   node doc-refs.mjs --report   print the same findings, always exit 0
 *   node doc-refs.mjs --stats    also print how many references were checked
 *
 * Three kinds of reference are checked, the ones that can be resolved without
 * guessing:
 *
 *  1. Relative markdown links, `[text](../path)`, resolved from the doc's own
 *     folder. Anchors and URLs are skipped, and a `#fragment` is dropped.
 *  2. Inline backticked paths, `apps/api/src/x.ts`. A token counts as a path
 *     when it has a slash, no glob or placeholder characters, and its first
 *     segment is a real top-level entry of the repo or of the doc's folder.
 *     It passes if it resolves from either. A trailing `:12` or `:12-30` line
 *     number is dropped first.
 *  3. Slash commands, `/name`, in command and skill docs only (elsewhere a
 *     `/name` is usually a site route or a bot command): one kebab segment
 *     that must be a command file or a skill folder, unless it is a Claude
 *     Code built-in or the config lists it under `externalSlash`.
 *
 * Fenced code blocks are skipped, and so are tokens holding a placeholder
 * (`...`, `YYYY`, `XXX`). "Exists" means tracked by git (or a folder holding a
 * tracked file, or a path reached through a tracked symlink), so a local run
 * and CI give the same answer. A path the repo's `.gitignore` covers passes,
 * because it names a runtime or generated file nothing can check.
 *
 * Config is `doc-refs.config.json` beside this file:
 *
 *   docs           globs of docs to scan (default below)
 *   exclude        globs of docs to skip
 *   ignore         globs of tokens that are not repo paths (R2 keys, Mac paths)
 *   externalSlash  `/names` that are bot or app commands, not agent commands
 *   slash          false to turn the slash check off, "all" to run it in every doc
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import { dirname, join, normalize, posix, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const DEFAULT_DOCS = [
	'**/AGENTS.md',
	'**/CLAUDE.md',
	'**/README.md',
	'**/SKILL.md',
	'.claude/commands/**/*.md',
	'.claude/skills/**/*.md',
	'.agents/**/*.md',
	'docs/**/*.md',
]
// Logs and archives are records: a path they name was right when written.
const DEFAULT_EXCLUDE = [
	'**/node_modules/**',
	'**/vendor/**',
	'plans/archived/**',
	'plans/handoffs/**',
	'plans/done/**',
	'**/*-log.md',
	'**/log/**',
	'**/logs/**',
]
// Local env files are never tracked, so naming one is never a dead reference.
const DEFAULT_IGNORE = ['**/.env*', '.env*', '**/.dev.vars*', '.dev.vars*']
// A doc may name a module the way an import does: `x.js` for `x.ts`, or no extension.
const MODULE_EXTS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '/index.ts', '/index.js']
// Claude Code's own commands and the plugin skills every repo can call.
const BUILTIN_SLASH = [
	'add-dir',
	'agents',
	'artifacts',
	'btw',
	'bug',
	'clear',
	'code-review',
	'compact',
	'config',
	'context',
	'cost',
	'doctor',
	'effort',
	'export',
	'fast',
	'help',
	'hooks',
	'humanizer',
	'ide',
	'init',
	'login',
	'logout',
	'loop',
	'mcp',
	'memory',
	'model',
	'permissions',
	'plugin',
	'plugins',
	'resume',
	'review',
	'rewind',
	'schedule',
	'security-review',
	'simplify',
	'status',
	'statusline',
	'ultrareview',
	'usage',
	'workflows',
]
const COMMAND_DIRS = ['.claude/commands', '.claude/skills', '.agents/skills', '.agents/commands']

// ── banner self-check ─────────────────────────────────────────────────────

const BANNER_RE =
	/^\/\/ Generated from ryanio\/doc-refs lib\/\S+ \(\w+, body ([0-9a-f]{12})\)\..*\n/m

export function bodyHash(text) {
	return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

/** True when the text carries a sync banner whose body hash no longer matches. */
export function editedInPlace(text) {
	const m = text.match(BANNER_RE)
	return m ? bodyHash(text.replace(BANNER_RE, '')) !== m[1] : false
}

// ── globs ─────────────────────────────────────────────────────────────────

export function globToRegExp(glob) {
	let re = ''
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i]
		if (c === '*' && glob[i + 1] === '*') {
			const slash = glob[i + 2] === '/'
			re += slash ? '(?:.*/)?' : '.*'
			i += slash ? 2 : 1
		} else if (c === '*') {
			re += '[^/]*'
		} else if (c === '?') {
			re += '[^/]'
		} else {
			re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		}
	}
	return new RegExp(`^${re}$`)
}

const anyGlob = (globs) => {
	const res = globs.map(globToRegExp)
	return (s) => res.some((r) => r.test(s))
}

// ── the tracked tree ──────────────────────────────────────────────────────

/** Builds the set of tracked files and the folders that hold them. */
export function trackedTree(files, root) {
	const all = new Set()
	const links = new Map()
	for (const f of files) {
		all.add(f)
		let d = posix.dirname(f)
		while (d !== '.' && !all.has(`${d}/`)) {
			all.add(`${d}/`)
			d = posix.dirname(d)
		}
		if (root) {
			try {
				if (lstatSync(join(root, f)).isSymbolicLink()) {
					links.set(f, posix.normalize(posix.join(posix.dirname(f), readlinkSync(join(root, f)))))
				}
			} catch {
				// unreadable entry: treat it as a plain file
			}
		}
	}
	const has = (p, depth = 0) => {
		const clean = posix.normalize(p).replace(TRAILING_SLASH_RE, '')
		if (!clean || clean === '.') {
			return true
		}
		if (clean.startsWith('../')) {
			return false
		}
		if (all.has(clean) || all.has(`${clean}/`)) {
			return true
		}
		if (depth > 4) {
			return false
		}
		for (const [link, target] of links) {
			if (clean.startsWith(`${link}/`)) {
				return has(target + clean.slice(link.length), depth + 1)
			}
		}
		return false
	}
	return { has, files }
}

// ── extraction ────────────────────────────────────────────────────────────

const FENCE_RE = /^(\s*)(```|~~~)[\s\S]*?^\1\2[^\n]*$/gm
const LINK_RE = /\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
const TICK_RE = /`([^`\n]+)`/g
const NOT_LITERAL = /[\s<>${}()?|@:,!"'`\\*…[\]=;&%~^]/
const LINE_SUFFIX_RE = /:\d+(?:-\d+)?$/
const TRAILING_SLASH_RE = /\/+$/
const LEADING_DOT_RE = /^\.\//
const LEADING_SLASH_RE = /^\//
const MODULE_JS_RE = /\.(?:js|mjs|jsx)$/
const MODULE_NAME_RE = /^[^.]*$|\.(?:js|mjs|jsx)$/
const MD_EXT_RE = /\.md$/
const PLACEHOLDER_RE = /\.\.\.|YYYY|XXX|NNNN|\bMM\b|\bDD\b/
const SLASH_RE = /^\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export function stripFences(text) {
	return text.replace(FENCE_RE, (m) => m.replace(/[^\n]/g, ''))
}

/** Every reference in one doc, with its 1-based line. */
export function extract(text) {
	const body = stripFences(text)
	const lines = body.split('\n')
	const out = []
	lines.forEach((line, i) => {
		const n = i + 1
		const noTicks = line.replace(TICK_RE, (m) => ' '.repeat(m.length))
		for (const m of noTicks.matchAll(LINK_RE)) {
			out.push({ kind: 'link', token: m[1], line: n })
		}
		for (const m of line.matchAll(TICK_RE)) {
			const token = m[1].trim()
			if (SLASH_RE.test(token)) {
				out.push({ kind: 'slash', token, line: n })
			} else {
				out.push({ kind: 'tick', token, line: n })
			}
		}
	})
	return out
}

// ── the check ─────────────────────────────────────────────────────────────

/**
 * @param {{ files: string[], read: (f: string) => string, has: (p: string) => boolean, config?: object }} repo
 * @returns {{ broken: {doc: string, line: number, kind: string, token: string}[], checked: number, docs: number }}
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one pass over three reference kinds reads better than three passes
export function check({ files, read, has: hasPath, config = {}, gitIgnored = () => new Set() }) {
	const has = (p) => {
		if (hasPath(p)) {
			return true
		}
		const bare = p.replace(MODULE_JS_RE, '')
		return (
			MODULE_NAME_RE.test(posix.basename(p)) &&
			MODULE_EXTS.some((e) => hasPath(bare + e))
		)
	}
	const isDoc = anyGlob(config.docs ?? DEFAULT_DOCS)
	const isExcluded = anyGlob([...DEFAULT_EXCLUDE, ...(config.exclude ?? [])])
	const isIgnored = anyGlob([...DEFAULT_IGNORE, ...(config.ignore ?? [])])
	const external = new Set(
		[...BUILTIN_SLASH, ...(config.externalSlash ?? [])].map((s) => s.replace(LEADING_SLASH_RE, ''))
	)
	const slashIn = (doc) =>
		config.slash === 'all' ||
		(config.slash !== false && COMMAND_DIRS.some((d) => doc.startsWith(`${d}/`)))

	const topLevel = new Set(files.map((f) => f.split('/')[0]))
	const commands = new Set()
	for (const f of files) {
		for (const dir of COMMAND_DIRS) {
			if (!f.startsWith(`${dir}/`)) {
				continue
			}
			const rest = f.slice(dir.length + 1)
			const first = rest.split('/')[0]
			commands.add(first.replace(MD_EXT_RE, ''))
		}
	}
	const docs = files.filter((f) => f.endsWith('.md') && isDoc(f) && !isExcluded(f)).sort()
	const broken = []
	let checked = 0

	for (const doc of docs) {
		const dir = posix.dirname(doc)
		const seen = new Set()
		for (const ref of extract(read(doc))) {
			const key = `${ref.kind}:${ref.token}`
			if (ref.kind === 'link') {
				const target = ref.token.split('#')[0]
				if (
					!target ||
					SCHEME_RE.test(target) ||
					target.startsWith('//') ||
					target.startsWith('/')
				) {
					continue
				}
				if (isIgnored(target)) {
					continue
				}
				checked++
				if (!has(posix.join(dir, decodeURI(target)))) {
					broken.push({ doc, ...ref })
				}
			} else if (ref.kind === 'tick') {
				const token = ref.token.replace(LINE_SUFFIX_RE, '').replace(LEADING_DOT_RE, '')
				if (
					!token.includes('/') ||
					NOT_LITERAL.test(token) ||
					PLACEHOLDER_RE.test(token) ||
					token.startsWith('/')
				) {
					continue
				}
				if (token.startsWith('../')) {
					if (isIgnored(token)) {
						continue
					}
					checked++
					if (!(has(posix.join(dir, token)) || seen.has(key))) {
						broken.push({ doc, ...ref })
					}
					seen.add(key)
					continue
				}
				const first = token.split('/')[0]
				const fromRoot = topLevel.has(first)
				const fromDoc = dir !== '.' && has(posix.join(dir, first))
				if (!(fromRoot || fromDoc) || isIgnored(token)) {
					continue
				}
				checked++
				const ok = (fromRoot && has(token)) || (dir !== '.' && has(posix.join(dir, token)))
				if (!(ok || seen.has(key))) {
					broken.push({ doc, ...ref })
				}
				seen.add(key)
			} else if (ref.kind === 'slash' && slashIn(doc)) {
				const name = ref.token.slice(1)
				checked++
				if (!(commands.has(name) || external.has(name) || topLevel.has(name) || seen.has(key))) {
					broken.push({ doc, ...ref })
				}
				seen.add(key)
			}
		}
	}
	// One git call for every unresolved path: a gitignored one is a runtime file.
	const target = (b) =>
		b.kind === 'link'
			? posix.join(posix.dirname(b.doc), decodeURI(b.token.split('#')[0]))
			: b.token.replace(LINE_SUFFIX_RE, '').replace(LEADING_DOT_RE, '')
	const paths = broken.filter((b) => b.kind !== 'slash').map(target)
	const ignored = paths.length ? gitIgnored(paths) : new Set()
	return {
		broken: broken.filter((b) => b.kind === 'slash' || !ignored.has(target(b))),
		checked,
		docs: docs.length,
	}
}

// ── command line ──────────────────────────────────────────────────────────

function main() {
	const self = readFileSync(fileURLToPath(import.meta.url), 'utf8')
	if (editedInPlace(self)) {
		console.error(
			'doc-refs.mjs was edited in place, but it is generated from ryanio/doc-refs.\n' +
				'Make the change in ~/dev/doc-refs/lib and run `npm run sync` there, or restore this file.'
		)
		process.exit(1)
	}
	const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
		cwd: HERE,
		encoding: 'utf8',
	}).trim()
	const files = execFileSync('git', ['ls-files', '-z'], {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
	})
		.split('\0')
		.filter(Boolean)
		.filter((f) => existsSync(join(root, f)) || lstatSync(join(root, f), { throwIfNoEntry: false }))
	const cfgPath = join(HERE, 'doc-refs.config.json')
	const config = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {}
	const { has } = trackedTree(files, root)
	const gitIgnored = (paths) => {
		const unique = [...new Set(paths)].filter((p) => !p.startsWith('../'))
		try {
			const out = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
				cwd: root,
				encoding: 'utf8',
				input: unique.join('\n'),
			})
			return new Set(out.split('\n').filter(Boolean))
		} catch (e) {
			// exit 1 means none matched
			return new Set(
				String(e.stdout ?? '')
					.split('\n')
					.filter(Boolean)
			)
		}
	}
	const result = check({
		files,
		read: (f) => readFileSync(join(root, f), 'utf8'),
		has,
		config,
		gitIgnored,
	})

	const report = process.argv.includes('--report')
	const cfgRel = normalize(relative(root, cfgPath))
	for (const b of result.broken) {
		const why = b.kind === 'slash' ? 'no such command or skill' : 'not in the repo'
		console.error(
			`  ${b.doc}:${b.line}  ${b.kind === 'link' ? `(${b.token})` : `\`${b.token}\``}  ${why}`
		)
	}
	const summary = `doc-refs: ${result.broken.length} broken of ${result.checked} references in ${result.docs} docs`
	if (result.broken.length) {
		console.error(
			`${summary}\nFix the doc, or list a token that is not a repo path under "ignore" in ${cfgRel}.`
		)
	} else {
		console.log(`✓ ${summary}`)
	}
	process.exit(result.broken.length && !report ? 1 : 0)
}

// realpath: the module URL is resolved through symlinks (macOS /var is one), argv is not.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
	main()
}
