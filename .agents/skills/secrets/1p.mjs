#!/usr/bin/env node
// Generated from ryanio/op-secrets lib/1p.mjs (0735754, body 8dd880947d27). Edit it there and run `node sync.mjs`; changes made here are overwritten.
/**
 * 1Password wrapper for this repo's vault (`vault` in secrets.config.json). One
 * entry point so callers never pick
 * the auth mode by hand — that choice is the read-vs-write trap that keeps
 * biting us:
 *
 *   - Reads  (run, get, read, list, fields, env): the read-only
 *     OP_SERVICE_ACCOUNT_TOKEN (see op-sdk.mjs for where it is found), over the
 *     1Password JS SDK. The
 *     `op` BINARY is deliberately not in this path: it probes the desktop app
 *     integration before it looks at auth, which on macOS raises a system
 *     permission dialog for the app's group container. Deny that (or just be
 *     away from the keyboard) and a read that had a perfectly good token hangs
 *     or dies with `No accounts configured`. The SDK talks to the API directly,
 *     so a read cannot prompt, cannot wedge on a group container the desktop app
 *     just updated, and cannot leak an `op daemon`.
 *   - Writes (set, create, delete): always DROP the service token first (it is
 *     read-only and would otherwise fail silently with exit 0), so the
 *     1Password desktop app prompts for personal approval. Approve it on the
 *     host machine; the write blocks until you do. Writes are the one case where
 *     the prompt is the POINT, so they still go through `op`.
 *
 * Settings, from `secrets.config.json` next to this file:
 *   vault          the vault title reads list and writes go to.
 *   vaultId        optional. Pins writes and listing to one vault by id, so a
 *                  second vault with the same title can't catch a write.
 *   localFallback  optional file (e.g. ".env") whose KEY=value lines stand in
 *                  for vault items in `run`. A key set there is used as-is and
 *                  costs no vault read.
 *
 * Usage: node <secrets dir>/1p.mjs <command> [args...]
 */
import { execSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reconcileSecrets } from './declared-secrets.mjs'
import {
	envTplRefs,
	failureAdvice,
	getClient,
	isRateLimit,
	resolveAll,
	resolveRef,
	spendToday,
} from './op-sdk.mjs'

const CONFIG = JSON.parse(readFileSync(new URL('./secrets.config.json', import.meta.url), 'utf8'))
const VAULT = CONFIG.vault
// What writes pass to `op --vault`: the id when one is pinned, else the title.
const WRITE_VAULT = CONFIG.vaultId ?? VAULT
const WRITE_TIMEOUT_MS = 120_000

const ROOT = (() => {
	try {
		return execSync('git rev-parse --show-toplevel', {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim()
	} catch {
		return process.cwd()
	}
})()

// Reads go to the SDK with the service token; everything else is a write that
// drops it and lets the desktop app prompt.
const READ_CMDS = new Set(['run', 'get', 'read', 'list', 'fields', 'env', 'audit'])

// Hoisted to module scope: this runs per .env.tpl line, so re-compiling the
// literal inside the loop on every call is wasted work (Biome useTopLevelRegex).
const ENV_TPL_LINE_RE = /^([A-Z_][A-Z0-9_]*)=(op:\/\/.+)$/
const ENV_LINE_RE = /^([A-Z_][A-Z0-9_]*)=(.*)$/

/** KEY=value pairs from a file under the repo root, blank values skipped. */
function readEnvFile(file) {
	const path = join(ROOT, file)
	const values = {}
	if (!existsSync(path)) {
		return values
	}
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const m = line.match(ENV_LINE_RE)
		if (m?.[2].trim()) {
			values[m[1]] = m[2].trim()
		}
	}
	return values
}

// Env with the read-only service token removed, forcing op onto the desktop
// integration (personal approval). Used for every write so the auth mode is
// never left to chance, even when the token is exported globally.
function personalEnv() {
	const { OP_SERVICE_ACCOUNT_TOKEN: _dropped, ...env } = process.env
	return env
}

/**
 * Writes only. Reads never reach the `op` binary, see the header.
 *
 * Bounded: a human has to approve the desktop prompt, but one nobody approves
 * should fail rather than hold the run forever. `quiet` drops op's stdout, for
 * writes whose echo would print the values just written.
 */
function opWrite(args, { quiet = false } = {}) {
	const res = spawnSync('op', args, {
		stdio: ['ignore', quiet ? 'ignore' : 'inherit', 'inherit'],
		env: personalEnv(),
		timeout: WRITE_TIMEOUT_MS,
		killSignal: 'SIGKILL',
	})
	if (res.error?.code === 'ETIMEDOUT' || res.signal === 'SIGKILL') {
		console.error(
			`op ${args.slice(0, 2).join(' ')} timed out after 2 minutes waiting for approval. ` +
				'Approve the 1Password desktop prompt on the host machine, then rerun.'
		)
		process.exit(1)
	}
	if (res.status !== 0) {
		process.exit(res.status ?? 1)
	}
}

// --- reads -----------------------------------------------------------------

// `run --only K1,K2 -- <cmd...>` resolves those keys and execs <cmd> with them
// in its environment. The workhorse for scripts that need resolved env
// (e.g. query-db.ts).
//
// `--only` is REQUIRED, because the whole-template resolve it replaced is
// expensive in a way that is invisible until it bites: `op run
// --env-file=.env.tpl` resolves EVERY `op://` ref in the template, so a query
// needing one key still costs ~75 vault operations. A normal recheck pass makes
// a dozen such calls, and that exhausted the service account's rate limit
// mid-run twice (2026-08-04, 2026-08-05). The failure it produces is
// `Too many requests. Your client has been rate-limited`, which reads like an
// auth or network fault, so the reflex is to retry (digging deeper) or to fall
// back to `op-sdk-run.mjs` (same account, same budget, no help). Naming the keys
// turns 75 operations into 1, and a wrong key fails locally before any vault
// call. `--all` is the deliberate opt-in for the rare command that really does
// need the whole template.
/**
 * Split `--only K1,K2` / `--only auto` / `--all` off the front of a run command.
 * Extracted so `cmdRun` stays inside the complexity budget.
 */
function parseRunFlags(rest) {
	let argv = rest
	let only = null
	let all = false
	let auto = false
	if (argv[0] === '--only') {
		const raw = (argv[1] ?? '').trim()
		if (raw === 'auto') {
			auto = true
			only = []
		} else {
			only = raw
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		}
		argv = argv.slice(2)
	} else if (argv[0] === '--all') {
		all = true
		argv = argv.slice(1)
	}
	argv = argv[0] === '--' ? argv.slice(1) : argv
	return { all, argv, auto, only }
}

async function cmdRun(rest) {
	const parsed = parseRunFlags(rest)
	const { all, argv, auto } = parsed
	let only = parsed.only
	if (!argv.length) {
		console.error('Usage: 1p.mjs run --only KEY1,KEY2 -- <command> [args...]')
		process.exit(1)
	}

	if (!(all || auto || only?.length)) {
		console.error(
			'1p run: --only is required.\n' +
				'\n' +
				'Without it every op:// ref in .env.tpl is resolved (~75 vault operations for\n' +
				'one key), which exhausts the service account and makes every later read fail\n' +
				'with "Too many requests. Your client has been rate-limited".\n' +
				'\n' +
				'Name the keys the command reads:\n' +
				'  1p.mjs run --only DISCORD_BOT_TOKEN -- npx tsx scripts/db/verify-discord-roles.ts\n' +
				'Or let a script that carries an @secrets line own its own list:\n' +
				'  1p.mjs run --only auto -- npx tsx scripts/db/query-db.ts …\n' +
				`Find them with:  grep -o 'process\\.env\\.[A-Z_]*' <script>\n` +
				'  1p.mjs env <ENV_VAR>   # check a name resolves\n' +
				'\n' +
				'Use --all only when the command genuinely needs the whole template.'
		)
		process.exit(1)
	}

	// The script owns its key list. A caller naming fewer keys than the script
	// declares fails HERE, before any vault call, because the failure it would
	// otherwise cause is quiet (2026-08-09, churn-autopsy: a missing
	// AI_GATEWAY_BASE_URL lost 30 judge calls while the run still printed
	// normally).
	if (!all) {
		const { keys, notes, fatal } = reconcileSecrets({ only, auto, cmd: argv })
		if (fatal) {
			console.error(`1p run: ${fatal}`)
			process.exit(1)
		}
		only = keys
		for (const n of notes ?? []) {
			console.error(`[1p] ${n}`)
		}
	}

	const available = envTplRefs()
	let refs = available
	if (!all) {
		const wanted = new Set(only)
		refs = available.filter(({ key }) => wanted.has(key))
		const missing = only.filter((k) => !refs.some((r) => r.key === k))
		if (missing.length > 0) {
			console.error(`1p run --only: not found in .env.tpl: ${missing.join(', ')}`)
			process.exit(1)
		}
	}

	// Keys the local fallback file sets cost no vault read.
	const local = {}
	if (CONFIG.localFallback) {
		const values = readEnvFile(CONFIG.localFallback)
		for (const { key } of refs) {
			if (values[key]) {
				local[key] = values[key]
			}
		}
		if (Object.keys(local).length > 0) {
			console.error(`[1p] ${Object.keys(local).length} from ${CONFIG.localFallback}`)
		}
	}
	const vaultRefs = refs.filter(({ key }) => !(key in local))
	const resolved = vaultRefs.length
		? await resolveAll(vaultRefs)
		: { env: {}, failed: [], exhausted: false, sent: 0, cached: 0 }
	const { failed, exhausted, sent, cached } = resolved
	const env = { ...resolved.env, ...local }
	// Say what the read actually COST. The whole failure mode this tooling exists
	// for was invisible spend, so a run that quietly billed 78 requests and one
	// that billed 0 should not look identical.
	if (sent > 0 || cached > 0) {
		console.error(`[1p] ${sent} from vault, ${cached} from cache`)
	}
	if (failed.length > 0) {
		// Loud, and fatal. A partial resolve is how you get a command that runs,
		// finds nothing, and reports clean.
		console.error(`1p run: ${failed.length} secret(s) did not resolve, refusing to run:`)
		for (const line of failed) {
			console.error(`  ${line}`)
		}
		console.error(failureAdvice(exhausted))
		process.exit(1)
	}

	const child = spawn(argv[0], argv.slice(1), {
		stdio: 'inherit',
		env: { ...process.env, ...env },
	})
	child.on('exit', (code, signal) => {
		process.exit(signal ? 1 : (code ?? 0))
	})
}

async function cmdGet(item, field) {
	console.log(await resolveRef(`op://${VAULT}/${item}/${field}`))
}

async function cmdRead(ref) {
	console.log(await resolveRef(ref))
}

/**
 * The SDK addresses vaults and items by id, so both listing commands start from
 * `vaults.list()` rather than the vault NAME the `op` CLI accepted.
 */
async function resolveVaultId() {
	if (CONFIG.vaultId) {
		return CONFIG.vaultId
	}
	const client = await getClient()
	for await (const vault of await client.vaults.list()) {
		if (vault.title === VAULT) {
			return vault.id
		}
	}
	throw new Error(`vault "${VAULT}" not visible to the service account`)
}

async function cmdList(withIds) {
	const client = await getClient()
	const titles = []
	for await (const item of await client.items.list(await resolveVaultId())) {
		titles.push(withIds ? `  ${item.id}  ${item.title}` : `  ${item.title} (${item.category})`)
	}
	titles.sort()
	console.log(`${VAULT} vault, ${titles.length} items:\n${titles.join('\n')}`)
}

/**
 * Compare the vault against `.env.tpl`, in both directions.
 *
 * The two drift silently and in opposite ways. A ref the vault cannot answer
 * fails only when something happens to need that key, which for a script that
 * runs monthly means the failure arrives long after the change that caused it.
 * A field the template no longer names is worse than useless: it is a second
 * copy of a value that now lives somewhere else, so whoever finds it next
 * cannot tell which one is authoritative.
 */
const TPL_SLOT_RE = /^op:\/\/[^/]+\/([^/]+)\/(.+)$/

// `op item create --category "API Credential"` ships these whether or not
// anyone fills them in. They are the item template, not configuration, and
// listing them as drift buries the fields that actually are.
const TEMPLATE_FIELDS = new Set([
	'expires',
	'valid from',
	'username',
	'credential',
	'type',
	'filename',
	'hostname',
	'notesPlain',
])

function printSection(heading, lines) {
	if (lines.length === 0) {
		return
	}
	console.log(heading)
	for (const line of lines) {
		console.log(`  ${line}`)
	}
	console.log('')
}

async function cmdAudit() {
	const client = await getClient()
	const vaultId = await resolveVaultId()

	const wanted = new Map()
	for (const { key, ref } of envTplRefs()) {
		const m = ref.match(TPL_SLOT_RE)
		if (m) {
			wanted.set(`${m[1]}/${m[2]}`, key)
		}
	}

	const seenTitles = new Map()
	const held = new Set()
	for await (const overview of await client.items.list(vaultId)) {
		seenTitles.set(overview.title, (seenTitles.get(overview.title) ?? 0) + 1)
		const item = await client.items.get(vaultId, overview.id)
		for (const f of item.fields) {
			if (f.value !== undefined && f.value !== '') {
				held.add(`${overview.title}/${f.title}`)
			}
		}
	}

	const dupes = [...seenTitles].filter(([, n]) => n > 1)
	// Every populated field counts here, template-named ones too: a ref to
	// `<item>/credential` is answered by that field.
	const missing = [...wanted].filter(([slot]) => !held.has(slot))
	// Template fields are left out of orphans only. `op item create` adds them
	// whether or not anyone uses them, so listing them as drift is noise.
	const orphans = [...held].filter(
		(slot) => !(wanted.has(slot) || TEMPLATE_FIELDS.has(slot.slice(slot.lastIndexOf('/') + 1)))
	)

	console.log(
		`.env.tpl names ${wanted.size} refs; the vault holds ${held.size} populated fields.\n`
	)
	printSection(
		'DUPLICATE TITLES (every ref to these fails to resolve):',
		dupes.map(([t, n]) => `${t} x${n}`)
	)
	printSection(
		'IN .env.tpl, NOT IN THE VAULT (these reads will fail):',
		missing.map(([slot, key]) => `${key}  ->  ${slot}`)
	)
	printSection('IN THE VAULT, NOT IN .env.tpl (stale, or a second copy):', orphans.sort())
	if (dupes.length + missing.length + orphans.length === 0) {
		console.log('In sync.')
	}
}

async function cmdFields(item) {
	const client = await getClient()
	const vaultId = await resolveVaultId()
	let found = null
	for await (const overview of await client.items.list(vaultId)) {
		if (overview.title === item) {
			found = overview
			break
		}
	}
	if (!found) {
		console.error(`1p fields: no item titled "${item}" in the ${VAULT} vault`)
		process.exit(1)
	}
	const data = await client.items.get(vaultId, found.id)
	console.log(`${data.title} (${data.category})`)
	console.log('-'.repeat(40))
	for (const field of data.fields || []) {
		const label = field.title || field.id || '(unnamed)'
		const val = field.fieldType === 'Concealed' ? '********' : field.value || ''
		const section = field.sectionId ? `[${field.sectionId}] ` : ''
		console.log(`  ${section}${label}: ${val}`)
	}
}

function loadEnvTpl() {
	const map = {}
	for (const line of readFileSync(join(ROOT, '.env.tpl'), 'utf8').split('\n')) {
		const m = line.match(ENV_TPL_LINE_RE)
		if (m) {
			map[m[1]] = m[2]
		}
	}
	return map
}

async function cmdEnv(envVar) {
	const refs = loadEnvTpl()
	const ref = refs[envVar]
	if (!ref) {
		console.error(`${envVar} not found in .env.tpl`)
		console.error(`Available: ${Object.keys(refs).join(', ')}`)
		process.exit(1)
	}
	console.log(`${envVar} -> ${ref}`)
	console.log(`Value: ${await resolveRef(ref)}`)
}

// --- writes (always personal auth, desktop prompts) ------------------------

/**
 * Writes need `op` signed in through the desktop app. When it is not, `op`
 * answers every write with "No accounts configured" and offers to add an
 * account by hand, which hides the real fix. Check first and say it plainly.
 */
function ensureOpSignedIn() {
	const res = spawnSync('op', ['account', 'list', '--format=json'], {
		env: personalEnv(),
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 30_000,
	})
	let accounts = []
	try {
		accounts = JSON.parse(res.stdout || '[]')
	} catch {
		// Unparseable output reads as no accounts, which is the case handled below.
	}
	if (res.status === 0 && accounts.length > 0) {
		return
	}
	console.error(
		'op cannot see a 1Password account, so this write would fail. Fix, in order:\n' +
			'  1. Unlock the 1Password app.\n' +
			'  2. 1Password > Settings > Developer: turn "Integrate with 1Password CLI" off and on.\n' +
			'  3. Run it from macOS Terminal once; if that works, allow this terminal app to access\n' +
			'     data from other apps in System Settings > Privacy & Security.\n' +
			'  4. Update the CLI to match the app (brew upgrade --cask 1password-cli).\n' +
			'Then check with: op account list'
	)
	process.exit(1)
}

function announceWrite(action, item, field) {
	ensureOpSignedIn()
	console.error(
		`${action} ${item}/${field ?? ''}: 1Password desktop will pop an Authorize prompt. ` +
			'Approve it on the host machine (one click warms the session ~5 min).'
	)
}

function cmdSet(item, field, value) {
	announceWrite('Set', item, field)
	opWrite(['item', 'edit', item, '--vault', WRITE_VAULT, `${field}[password]=${value}`])
	console.log(`Updated ${item}/${field}`)
}

function cmdCreate(item, pairs) {
	announceWrite('Create', item)
	const fieldArgs = pairs.map((p) => {
		const [k, ...rest] = p.split('=')
		return `${k}[password]=${rest.join('=')}`
	})
	opWrite([
		'item',
		'create',
		'--vault',
		VAULT,
		'--category',
		'API Credential',
		'--title',
		item,
		...fieldArgs,
	])
	console.log(`Created ${item}`)
}

/**
 * Create an item whose fields are named after env keys, so a ref reads
 * op://<vault>/<item>/<KEY>, with the values taken from a file rather than the
 * command line (where they would sit in shell history and `ps`). The values go
 * to `op` as a template file, 0600 in a 0700 directory, removed afterwards:
 * piping the template to `op item create -` drops its fields, and assignment
 * args would put the values back in argv. `--text name=value` adds a plain,
 * unconcealed field, such as a public address.
 */
function cmdPut(item, from, args) {
	const keys = []
	const text = []
	for (let i = 0; i < args.length; i++) {
		if (args[i] !== '--text') {
			keys.push(args[i])
			continue
		}
		const [name, ...value] = (args[++i] ?? '').split('=')
		if (!(name && value.length)) {
			fail('put <item> --from <envfile> KEY1 [KEY2...] [--text name=value]')
		}
		text.push({ id: name, label: name, type: 'STRING', value: value.join('=') })
	}
	if (keys.length === 0) {
		fail('put <item> --from <envfile> KEY1 [KEY2...] [--text name=value]')
	}
	const values = readEnvFile(from)
	const missing = keys.filter((k) => !values[k])
	if (missing.length > 0) {
		console.error(`1p put: not found in ${from}: ${missing.join(', ')}`)
		process.exit(1)
	}
	const template = {
		title: item,
		category: 'SECURE_NOTE',
		fields: [...keys.map((k) => ({ id: k, label: k, type: 'CONCEALED', value: values[k] })), ...text],
	}
	announceWrite('Create', item)
	const dir = mkdtempSync(join(tmpdir(), '1p-put-'))
	const file = join(dir, 'item.json')
	try {
		writeFileSync(file, JSON.stringify(template), { mode: 0o600 })
		opWrite(['item', 'create', '--vault', WRITE_VAULT, `--template=${file}`], { quiet: true })
	} finally {
		rmSync(dir, { force: true, recursive: true })
	}
	console.log(`Created ${item} (${[...keys, ...text.map((t) => t.id)].join(', ')})`)
}

/**
 * Delete a whole item, addressed by id.
 *
 * By ID and not by title on purpose. `op item create` does not dedupe by
 * title, so a rerun of a seeding script leaves two items with the same name,
 * and every `op://` ref pointing at that name then fails with "more than one
 * item matched the secret reference query". Deleting by title in that state
 * is ambiguous exactly when you most need it not to be. `1p.mjs list --ids`
 * prints the ids.
 */
function cmdDeleteItem(id) {
	announceWrite('Delete item', id)
	opWrite(['item', 'delete', id, '--vault', WRITE_VAULT])
	console.log(`Deleted item ${id}`)
}

function cmdDelete(item, field) {
	announceWrite('Delete', item, field)
	opWrite(['item', 'edit', item, '--vault', WRITE_VAULT, `${field}[delete]`])
	console.log(`Removed ${field} from ${item}`)
}

// --- dispatch --------------------------------------------------------------

function fail(usage) {
	console.error(`Usage: 1p.mjs ${usage}`)
	process.exit(1)
}

/**
 * What today's reads actually cost, from the local ledger.
 *
 * Deliberately does NOT shell out to `op service-account ratelimit`: that is the
 * binary whose desktop probe raises the macOS permission dialog and wedges, and
 * needing it to answer "how much have I spent" is what left the 08-05 run
 * guessing. The ledger is written by every resolve on this machine, so it
 * attributes spend PER REPO, which the 1Password API cannot do at all below
 * Business (there is no per-request audit on this tier).
 *
 * The account cap is 1,000 requests per 24 HOURS across the whole 1Password
 * account, every service-account token included. Not per hour, and not per repo.
 */
function cmdBudget() {
	const { requests, byRepo } = spendToday()
	const CAP = 1000
	console.log(`1Password requests sent in the last 24h (from this machine): ${requests} / ~${CAP}`)
	const rows = Object.entries(byRepo).sort((a, b) => b[1] - a[1])
	for (const [repo, n] of rows) {
		console.log(`  ${repo}: ${n}`)
	}
	if (rows.length === 0) {
		console.log('  (nothing recorded yet; the ledger starts when the next resolve runs)')
	}
	console.log(
		'\nThe cap is per 1Password ACCOUNT and per 24 HOURS, shared by every service\n' +
			'account token, repo, worktree and agent. Cache hits cost nothing and are not\n' +
			'counted here. This ledger only sees reads that went through this wrapper.'
	)
}

const [cmd, ...args] = process.argv.slice(2)

// Reads are async now (the SDK is), so they dispatch through here: an
// unhandled rejection would otherwise print a stack trace where the rate-limit
// or missing-key message belongs.
function dispatchRead() {
	switch (cmd) {
		case 'run':
			return cmdRun(args)
		case 'get':
			if (args.length < 2) {
				fail('get <item> <field>')
			}
			return cmdGet(args[0], args[1])
		case 'read':
			if (!args[0]) {
				fail('read <op://ref>')
			}
			return cmdRead(args[0])
		case 'list':
			return cmdList(args.includes('--ids'))
		case 'audit':
			return cmdAudit()
		case 'fields':
			if (!args[0]) {
				fail('fields <item>')
			}
			return cmdFields(args[0])
		default:
			return cmdEnv(args[0] ?? fail('env <ENV_VAR>'))
	}
}

if (READ_CMDS.has(cmd)) {
	Promise.resolve(dispatchRead()).catch((err) => {
		console.error(`1p ${cmd}: ${String(err instanceof Error ? err.message : err)}`)
		if (isRateLimit(err)) {
			console.error(failureAdvice(true))
		}
		process.exit(1)
	})
}

switch (cmd) {
	case 'run':
	case 'get':
	case 'read':
	case 'list':
	case 'fields':
	case 'env':
	case 'audit':
		break
	case 'set':
		if (args.length < 3) {
			fail('set <item> <field> <value>')
		}
		cmdSet(args[0], args[1], args[2])
		break
	case 'create':
		if (args.length < 2) {
			fail('create <item> field=value [...]')
		}
		cmdCreate(args[0], args.slice(1))
		break
	case 'delete':
		if (args.length < 2) {
			fail('delete <item> <field>')
		}
		cmdDelete(args[0], args[1])
		break
	case 'put':
		if (args.length < 4 || args[1] !== '--from') {
			fail('put <item> --from <envfile> KEY1 [KEY2...] [--text name=value]')
		}
		cmdPut(args[0], args[2], args.slice(3))
		break
	case 'delete-item':
		if (args.length < 1) {
			fail('delete-item <item-id>   (ids come from `1p.mjs list --ids`)')
		}
		cmdDeleteItem(args[0])
		break
	case 'budget':
		cmdBudget()
		break
	default:
		console.log(`Usage: 1p.mjs <command> [args...]

Reads (service token over the JS SDK, never the op binary, never a prompt):
  run --only K1,K2 -- <cmd...>  run <cmd> with just those keys resolved into its env
  get <item> <field>           read a single field value
  read <op://ref>              read any op:// reference
  list [--ids]                 list all items in the vault, optionally with ids
  fields <item>                show an item's fields (secrets masked)
  env <ENV_VAR>                resolve an env var via .env.tpl
  audit                        compare the vault against .env.tpl, both directions

Budget (the cap is 1,000 requests per 24h per 1Password ACCOUNT, not per hour
and not per repo; resolved values are cached ~12h so repeat runs cost nothing):
  budget                       what today's reads cost, per repo

Writes (drops service token, 1Password desktop prompts for approval):
  delete-item <item-id>        delete a whole item by id (duplicate titles)
  set <item> <field> <value>   set a field
  create <item> field=value... create a new item
  put <item> --from <envfile> KEY... [--text name=value]
                               create an item from a file's values (none in argv)
  delete <item> <field>        remove a field`)
		if (cmd) {
			process.exit(1)
		}
}
