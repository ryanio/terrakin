// Generated from ryanio/op-secrets lib/op-sdk.mjs (aa5fa4d, body eece610a52eb). Edit it there and run `node sync.mjs`; changes made here are overwritten.
/**
 * 1Password reads over the JS SDK, with no `op` binary anywhere in the path.
 *
 * The binary is the problem this module exists to route around. `op` always
 * probes the desktop app integration before it looks at auth, and on macOS that
 * probe reads the app's group container, which raises a system permission
 * dialog ("would like to access data from other apps"). Deny it, or simply be
 * away from the keyboard, and the read hangs or dies with `No accounts
 * configured` even though a perfectly good read-only service token is sitting in
 * the repo. The same probe is what wedges `op` outright when the desktop app has
 * updated underneath it, and what leaks an `op daemon` per invocation.
 *
 * None of that touches the SDK: it talks to the 1Password API directly over
 * HTTPS with the service token, so it cannot prompt, cannot wedge, and cannot
 * leak a daemon. Reads are therefore SDK-only, and `op` is kept for writes,
 * where the desktop prompt is the actual point (a service token is read-only and
 * would fail a write silently).
 *
 * Read-only by construction: there is no write path in here.
 *
 * Per-repo settings come from `secrets.config.json` next to this file:
 *   name       repo name; also the env prefix (`CORAL_1P_NO_CACHE`) and the
 *              cloud token suffix (`OP_SERVICE_ACCOUNT_TOKEN_CORAL`)
 *   label      display name for the SDK integration (defaults to name)
 *   tokenFile  gitignored file holding OP_SERVICE_ACCOUNT_TOKEN (default `.env`).
 *              Repos whose bundler compiles `.env*` into a deploy use
 *              `.op-token`, a name no bundler reads.
 */
import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { editedInPlace } from './check-vendored.mjs'

// A consumer's copy is generated; an edit made there is lost on the next sync.
if (editedInPlace(fileURLToPath(import.meta.url))) {
	process.stderr.write(
		'[1p] warning: op-sdk.mjs was edited in place. It is generated from ryanio/op-secrets, ' +
			'so make the change in its lib/ and run `npm run sync` there.\n'
	)
}

const CONFIG = JSON.parse(readFileSync(new URL('./secrets.config.json', import.meta.url), 'utf8'))
const NAME = CONFIG.name
const PREFIX = NAME.toUpperCase()
const TOKEN_FILE = CONFIG.tokenFile ?? '.env'
const CLOUD_TOKEN_VAR = `OP_SERVICE_ACCOUNT_TOKEN_${PREFIX}`
const NO_CACHE_VAR = `${PREFIX}_1P_NO_CACHE`
const TTL_VAR = `${PREFIX}_1P_CACHE_TTL_MS`

/** Git toplevel. Resolved rather than hardcoded so the wrapper reads the token
 *  of the checkout it is actually run from, including a worktree or a test's
 *  temp dir. */
export const ROOT = (() => {
	try {
		return execSync('git rev-parse --show-toplevel', {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim()
	} catch {
		return process.cwd()
	}
})()

const REF_LINE = /^([A-Z_][A-Z0-9_]*)=(op:\/\/.+)$/
const TOKEN_LINE = /^(?:export\s+)?OP_SERVICE_ACCOUNT_TOKEN=(.+)$/
const RATE_LIMIT_RE = /rate.?limit|too many requests/i

/** Kept out of each repo's package.json on purpose: this is agent tooling, not
 *  a build dependency. Cached under tmp and shared by every repo, so the install
 *  cost is paid once per machine, not once per invocation. */
const SDK_HOME = join(tmpdir(), 'op-secrets-sdk')

function loadSdk() {
	try {
		return createRequire(`${ROOT}/package.json`)('@1password/sdk')
	} catch {
		// not resolvable from the repo, fall through to the cached copy
	}
	// Probe a FILE, not the package directory. macOS's periodic tmp cleanup
	// removes files it has not seen used for a few days and leaves the empty
	// directory tree behind, so a directory check saw the hollow cache as
	// installed and every read failed with "Cannot find module". A missing
	// package.json reinstalls instead.
	if (!existsSync(join(SDK_HOME, 'node_modules', '@1password', 'sdk', 'package.json'))) {
		mkdirSync(SDK_HOME, { recursive: true })
		process.stderr.write('[1p] installing @1password/sdk (one time, cached in tmp)\n')
		execFileSync('npm', ['install', '--prefix', SDK_HOME, '--no-save', '@1password/sdk'], {
			stdio: ['ignore', 'ignore', 'inherit'],
		})
	}
	return createRequire(join(SDK_HOME, 'package.json'))('@1password/sdk')
}

/**
 * The main checkout's token file, for when we are running inside a worktree.
 *
 * It is gitignored, so a worktree NEVER has one: `git rev-parse --show-toplevel`
 * points at the worktree, the token is not there, and reads fail outright.
 * `--git-common-dir` resolves to the MAIN repo's `.git` from inside a worktree,
 * so its parent is the checkout that actually holds the token.
 */
function mainCheckoutTokenFile() {
	try {
		const common = execSync('git rev-parse --git-common-dir', {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim()
		// Relative (`.git`) in a normal checkout, absolute from a worktree.
		return join(dirname(resolve(ROOT, common)), TOKEN_FILE)
	} catch {
		return null
	}
}

function tokenFromFile(path) {
	if (!(path && existsSync(path))) {
		return null
	}
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const m = line.match(TOKEN_LINE)
		if (m) {
			return m[1].trim().replace(/^["']|["']$/g, '')
		}
	}
	return null
}

/**
 * The read-only service token: the repo-named cloud variable, then the plain
 * environment variable, then the token file here or in the main checkout.
 *
 * Fails closed and says what to set. There is no other auth mode to degrade
 * into, which is the point: the `op` binary would have answered a missing token
 * by falling back to the desktop integration and prompting.
 */
export function serviceToken() {
	// A cloud environment carries every repo's token at once, so each has its own name there.
	if (process.env[CLOUD_TOKEN_VAR]) {
		return process.env[CLOUD_TOKEN_VAR]
	}
	if (process.env.OP_SERVICE_ACCOUNT_TOKEN) {
		return process.env.OP_SERVICE_ACCOUNT_TOKEN
	}
	const here = join(ROOT, TOKEN_FILE)
	const main = mainCheckoutTokenFile()
	const token = tokenFromFile(here) ?? tokenFromFile(main)
	if (token) {
		return token
	}
	if (process.env.CLAUDE_CODE_REMOTE === 'true') {
		throw new Error(
			`no ${CLOUD_TOKEN_VAR} in this cloud session. Add the cloud service ` +
				"account's token to the environment's variables at claude.ai/code, then start a new session."
		)
	}
	const looked = main && main !== here ? `${here} and ${main}` : here
	throw new Error(
		`no OP_SERVICE_ACCOUNT_TOKEN (checked the environment, ${looked}). ` +
			'Reads use the read-only service token and must not prompt, so there is no ' +
			`fallback. Add the token to that ${TOKEN_FILE} and retry.`
	)
}

let client = null

export async function getClient() {
	if (client) {
		return client
	}
	// Token first: a missing one must fail before `loadSdk` can spend time (or a
	// one-time npm install) on a read that was never going to happen.
	const auth = serviceToken()
	const { createClient } = loadSdk()
	client = await createClient({
		auth,
		integrationName: `${CONFIG.label ?? NAME} secrets wrapper`,
		integrationVersion: '1.0.0',
	})
	return client
}

/** Every `KEY=op://…` line in `.env.tpl`, in file order. */
export function envTplRefs() {
	const out = []
	for (const line of readFileSync(join(ROOT, '.env.tpl'), 'utf8').split('\n')) {
		const m = line.trim().match(REF_LINE)
		if (m) {
			out.push({ key: m[1], ref: m[2].trim() })
		}
	}
	return out
}

export function isRateLimit(err) {
	return RATE_LIMIT_RE.test(String(err))
}

/**
 * Resolve one secret reference. ONE attempt, no retry.
 *
 * A rate limit is the one error that must never be retried: the budget is the
 * thing you are out of, so each retry spends more of it, and the account cap is
 * 1,000 requests per 24 HOURS, not per hour. No transient class is retried
 * either. A network blip surfaces to the caller, which refuses to run rather
 * than hand back a partial environment, and the operator re-runs. Against a
 * 1,000/day budget that is cheaper than any retry policy worth arguing about.
 */
export async function resolveRef(ref) {
	const c = await getClient()
	return await c.secrets.resolve(ref)
}

/**
 * Machine-wide cache + usage ledger.
 *
 * BOTH are deliberately outside any repo, because the thing being rationed is
 * outside any repo: the `account read_write` cap is 1,000 requests per 24 HOURS
 * for the whole 1Password ACCOUNT, shared by every service-account token, every
 * checkout, every worktree and every agent. Separate tokens do not buy separate
 * budgets. A per-repo cache would let two repos each pay full price for the
 * same secret, and per-repo accounting could never answer "what spent the day".
 *
 * The cache is what makes the cap survivable. Without it, cost scales with how
 * OFTEN things run; with it, cost scales with how MANY distinct secrets exist.
 *
 * Writing resolved secrets to disk adds no exposure that is not already there:
 * the repo's token file holds a service-account token that can read the whole
 * vault, strictly more powerful than any value cached here. Cache files are
 * 0600 inside a 0700 dir.
 */
const CACHE_DIR = join(homedir(), '.cache', '1p-secrets')
const LEDGER = join(CACHE_DIR, 'usage.jsonl')
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000

function cacheTtlMs() {
	const raw = Number(process.env[TTL_VAR])
	return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TTL_MS
}

function cacheDisabled() {
	return process.env[NO_CACHE_VAR] === '1' || cacheTtlMs() === 0
}

/** Keyed by ref AND token fingerprint: two service accounts can resolve the
 *  same `op://` path to different values, and must never share a cache slot. */
function cacheKey(ref, token) {
	return createHash('sha256').update(`${token} ${ref}`).digest('hex')
}

function readCache(ref, token) {
	if (cacheDisabled()) {
		return null
	}
	try {
		const raw = readFileSync(join(CACHE_DIR, `${cacheKey(ref, token)}.json`), 'utf8')
		const { value, at } = JSON.parse(raw)
		return Date.now() - at < cacheTtlMs() ? value : null
	} catch {
		return null
	}
}

function writeCache(ref, token, value) {
	if (cacheDisabled()) {
		return
	}
	try {
		mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 })
		writeFileSync(
			join(CACHE_DIR, `${cacheKey(ref, token)}.json`),
			JSON.stringify({ value, at: Date.now() }),
			{ mode: 0o600 }
		)
	} catch {
		// A cache that cannot be written is a slow day, not a broken read.
	}
}

/**
 * A ref whose item or field doesn't exist is remembered for an hour. Failed
 * reads aren't otherwise cached, so a job on a timer asking for a missing item
 * spends a request on every tick (musegod's 10-minute poster burned 144 a day
 * this way). A later successful read clears the record.
 */
const MISS_TTL_MS = 60 * 60 * 1000
const NOT_FOUND = /no item matched|no field matched|isn't a field|not found/i

function missPath(ref, token) {
	return join(CACHE_DIR, `${cacheKey(ref, token)}.miss.json`)
}

function readMiss(ref, token) {
	if (process.env[NO_CACHE_VAR] === '1') {
		return null
	}
	try {
		const { message, at } = JSON.parse(readFileSync(missPath(ref, token), 'utf8'))
		const left = MISS_TTL_MS - (Date.now() - at)
		return left > 0 ? { message, minutes: Math.ceil(left / 60_000) } : null
	} catch {
		return null
	}
}

function writeMiss(ref, token, message) {
	try {
		mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 })
		writeFileSync(missPath(ref, token), JSON.stringify({ message, at: Date.now() }), {
			mode: 0o600,
		})
	} catch {
		// Best-effort, like the value cache.
	}
}

function clearMiss(ref, token) {
	try {
		rmSync(missPath(ref, token), { force: true })
	} catch {
		// Best-effort; a stale miss expires within the hour anyway.
	}
}

/** One line per invocation. This is the only way to answer "what spent the
 *  budget", because 1Password exposes no per-request audit below Business. */
function recordUsage(entry) {
	try {
		mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 })
		appendFileSync(LEDGER, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
	} catch {
		// Accounting is best-effort; never fail a read over it.
	}
}

/** Requests actually sent to 1Password today, from the ledger. */
export function spendToday() {
	try {
		const since = Date.now() - 24 * 60 * 60 * 1000
		let requests = 0
		const byRepo = {}
		for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
			if (!line) {
				continue
			}
			const e = JSON.parse(line)
			if (e.at < since) {
				continue
			}
			requests += e.sent ?? 0
			byRepo[e.repo] = (byRepo[e.repo] ?? 0) + (e.sent ?? 0)
		}
		return { requests, byRepo }
	} catch {
		return { requests: 0, byRepo: {} }
	}
}

/**
 * Resolve many refs serially, returning `{ env, failed, exhausted, sent, cached }`.
 *
 * Serial on purpose: concurrent resolves against one service account buy
 * nothing here. `exhausted` short-circuits the rest, because the vault budget is
 * ACCOUNT-wide, so once one key is refused every remaining key is already
 * refused and resolving them only spends the budget being waited on. Cache hits
 * cost nothing and are served even when the budget IS exhausted, which is the
 * difference between a degraded day and a dead one.
 */
export async function resolveAll(refs) {
	const env = {}
	const failed = []
	let exhausted = false
	let sent = 0
	let cached = 0
	const token = serviceToken()

	for (const { key, ref } of refs) {
		const hit = readCache(ref, token)
		if (hit !== null) {
			env[key] = hit
			cached++
			continue
		}
		if (exhausted) {
			failed.push(`${key}: not attempted, account vault budget already exhausted`)
			continue
		}
		const miss = readMiss(ref, token)
		if (miss) {
			failed.push(
				`${key}: ${miss.message} (cached miss, asks the vault again in ${miss.minutes}m; ${NO_CACHE_VAR}=1 to ask now)`
			)
			continue
		}
		try {
			sent++
			const value = await resolveRef(ref)
			env[key] = value
			writeCache(ref, token, value)
			clearMiss(ref, token)
		} catch (err) {
			if (isRateLimit(err)) {
				exhausted = true
			} else if (NOT_FOUND.test(String(err))) {
				writeMiss(ref, token, String(err).slice(0, 140))
			}
			failed.push(`${key}: ${String(err).slice(0, 140)}`)
		}
	}

	recordUsage({
		at: Date.now(),
		repo: ROOT.split('/').pop(),
		root: ROOT,
		asked: refs.length,
		sent,
		cached,
		failed: failed.length,
		exhausted,
		argv: process.argv.slice(2, 6).join(' ').slice(0, 120),
	})
	return { env, failed, exhausted, sent, cached }
}

/**
 * The advice a failed resolve should print. An exhausted budget and a bad key
 * are different faults and used to share one message, which sent a run holding
 * a correct `--only` off hunting for a naming mistake it had not made.
 */
export function failureAdvice(exhausted) {
	if (!exhausted) {
		return (
			'  Check the key names against .env.tpl (1p.mjs env <NAME> resolves one), and\n' +
			'  remember a missing key usually produces an empty result that reads as healthy.\n'
		)
	}
	return (
		'\n  THIS IS THE VAULT BUDGET, NOT YOUR KEYS AND NOT AUTH.\n' +
		'  The limit is per ACCOUNT, so it is shared by every repo, every concurrent\n' +
		'  session, and whatever ran before you. Retrying spends the budget you are\n' +
		'  waiting on. WAIT: recovery is hours, not seconds.\n' +
		'  Then say so in the run report: a run that could not read is NOT a quiet run.\n\n'
	)
}
