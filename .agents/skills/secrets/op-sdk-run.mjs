#!/usr/bin/env node
// Generated from ryanio/op-secrets lib/op-sdk-run.mjs (52fb794, body d8137c7df97a). Edit it there and run `node sync.mjs`; changes made here are overwritten.
/**
 * Compatibility shim. `1p.mjs run` IS this now.
 *
 * This existed because the `op` binary wedged on the Mac Studio after a
 * 1Password desktop update (2026-08-04): every subcommand needing account
 * context hung forever, because `op` reads the desktop app's group container
 * before it looks at auth, and that container was blocking. The same probe also
 * raises a macOS permission dialog, so a read could hang waiting on a click even
 * when nothing was wedged. Both are properties of the BINARY, not of the token,
 * which sits in the repo and is fine.
 *
 * So reads no longer use the binary at all: `1p.mjs` resolves them through the
 * 1Password JS SDK (`op-sdk.mjs`), which is exactly what this script did. There
 * is nothing left for a "fallback" to fall back from, and keeping two entry
 * points for one code path is how they drift.
 *
 * Kept only so the runbook recipes that already name it keep working. Prefer
 * `1p.mjs run --only …`; this forwards to the same module.
 */
import { spawn } from 'node:child_process'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconcileSecrets } from './declared-secrets.mjs'
import { envTplRefs, failureAdvice, ROOT, resolveAll } from './op-sdk.mjs'

const argv = process.argv.slice(2)
const sep = argv.indexOf('--')
const flags = sep === -1 ? [] : argv.slice(0, sep)
const cmd = sep === -1 ? argv : argv.slice(sep + 1)
if (cmd.length === 0) {
	process.stderr.write(
		`usage: node ${relative(ROOT, fileURLToPath(import.meta.url))} --only KEY1,KEY2 -- <cmd> [args...]\n` +
			'  (deprecated: use 1p.mjs run --only KEY1,KEY2 -- <cmd>, same code path)\n'
	)
	process.exit(2)
}

const onlyIdx = flags.indexOf('--only')
const onlyRaw = onlyIdx === -1 ? null : (flags[onlyIdx + 1] ?? '').trim()
const auto = onlyRaw === 'auto'

/** `--only auto` yields an empty list the reconcile step fills from @secrets. */
function parseOnly(raw) {
	if (raw === null) {
		return null
	}
	if (raw === 'auto') {
		return []
	}
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
}

let only = parseOnly(onlyRaw)
if (!(auto || only?.length || flags.includes('--all'))) {
	process.stderr.write(
		'[op-sdk] FATAL: --only is required.\n' +
			'Resolving every op:// ref in .env.tpl (~75 vault operations) exhausts the\n' +
			'service account, and the resulting "Too many requests" then fails reads that\n' +
			'look unrelated. Name the keys the command reads, e.g.\n' +
			'  --only SENTRY_AUTH_TOKEN -- npx tsx skills/sentry/scripts/get-issue.ts <id>\n' +
			'Use --all only when the command genuinely needs the whole template.\n'
	)
	process.exit(2)
}

// Same guard as `1p.mjs run`: the script's own @secrets line wins, and a short
// --only fails before it can spend a vault read on a half-configured command.
if (!flags.includes('--all')) {
	const { keys, notes, fatal } = reconcileSecrets({ only, auto, cmd })
	if (fatal) {
		process.stderr.write(`[op-sdk] FATAL: ${fatal}\n`)
		process.exit(2)
	}
	only = keys
	for (const n of notes ?? []) {
		process.stderr.write(`[op-sdk] ${n}\n`)
	}
}

const available = envTplRefs()
const refs = only ? available.filter(({ key }) => only.includes(key)) : available
const missing = only ? only.filter((k) => !refs.some((r) => r.key === k)) : []
if (missing.length > 0) {
	process.stderr.write(`[op-sdk] FATAL: not in .env.tpl: ${missing.join(', ')}\n`)
	process.exit(3)
}

const { env, failed, exhausted } = await resolveAll(refs)
process.stderr.write(`[op-sdk] resolved ${refs.length - failed.length}/${refs.length} secrets\n`)

// Loud, and fatal. A partial resolve is how you get a command that runs, finds
// nothing, and reports clean.
if (failed.length > 0) {
	process.stderr.write(`[op-sdk] FATAL: ${failed.length} secret(s) did not resolve:\n`)
	for (const line of failed) {
		process.stderr.write(`  ${line}\n`)
	}
	process.stderr.write(failureAdvice(exhausted))
	process.exit(4)
}

const child = spawn(cmd[0], cmd.slice(1), {
	stdio: 'inherit',
	env: { ...process.env, ...env },
})
child.on('exit', (code, signal) => {
	process.exit(signal ? 1 : (code ?? 0))
})
