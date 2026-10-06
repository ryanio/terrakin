/**
 * Reading public agent registries (RFC 0007), with plain JSON-RPC `eth_call` over `fetch`: a few
 * ABI selectors, no chain library. The reader is injected, so tests never touch the network.
 *
 * Only networks on the allowlist are read, and on each only its canonical ERC-8004 Identity
 * Registry counts, so nobody can stand up a lookalike registry. RPC URLs come from server config
 * (a public endpoint by default), never from a request.
 *
 * Everything a network answers is untrusted: it is decoded strictly, capped in size, and only the
 * few values we need are kept.
 *
 * Runs on Node and in the Worker: plain `fetch`, no Node APIs.
 */

import { readCapped } from "./media";

/** A network we read agents from, and its one registry. */
export interface ChainConfig {
  chainId: number;
  name: string;
  /** The canonical ERC-8004 Identity Registry, lowercase. */
  registry: string;
  /** A public JSON-RPC endpoint. Server config may replace it (`TERRAKIN_CHAIN_RPC`). */
  rpc: string;
}

/**
 * The allowlist. Robinhood Chain first: the registry was checked on robin.etherscan.io (an
 * ERC1967Proxy over IdentityRegistryUpgradeable, verified) on 2026-10-04. A new network is a
 * reviewed change here.
 */
export const CHAINS: Readonly<Record<number, ChainConfig>> = {
  4663: {
    chainId: 4663,
    name: "Robinhood Chain",
    registry: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
  },
};

/** ABI selectors: the first 4 bytes of the keccak-256 of each signature. */
export const SELECTORS = {
  /** ERC-721 `tokenURI(uint256)` on the registry: the agent's card URI. */
  tokenURI: "0xc87b56dd",
  /** ERC-721 `ownerOf(uint256)` on the registry: who holds the agent. */
  ownerOf: "0x6352211e",
  /**
   * ERC-8217 `bindingOf(uint256) returns ((uint8 standard, address boundAddress, uint256 tokenId))`
   * on a binding contract such as Adapter8004: which collection item an agent belongs to.
   */
  bindingOf: "0x4d69ebc2",
  /** MusegodMuses `agentOf(uint256) returns (bool registered, uint256 agentId)`. */
  agentOf: "0x6cb75a1e",
} as const;

/**
 * What a read returns: a value, or why not. `missing` means the contract said no (it reverted).
 * `bad` means an answer came and can't be used (too big, or not the shape asked for): asking again
 * won't help, so it isn't a failure to reach the network.
 */
export type ChainRead<T> = { ok: true; value: T } | { ok: false; missing: boolean; bad?: true };

/**
 * One `eth_call` against the latest block, returning the raw hex answer. `missing` is a revert;
 * anything else (no RPC for that network, a timeout, a bad answer) is a failure to reach it.
 */
export type ChainCall = (chainId: number, to: string, data: string) => Promise<ChainRead<string>>;

export interface RpcReaderOptions {
  /** RPC URL per network id. Default: each allowlisted network's public endpoint. */
  urls?: Readonly<Record<number, string>>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const RPC_TIMEOUT_MS = 5_000;
/** The longest answer we read. A card inlined as a data URI is the big case; the card cap is 64 KB. */
const MAX_RPC_ANSWER_BYTES = 200_000;

/** The real reader: JSON-RPC `eth_call` over `fetch`, with a timeout and no redirects. */
export function rpcReader(options: RpcReaderOptions = {}): ChainCall {
  const urls: Record<number, string> = {
    ...Object.fromEntries(Object.values(CHAINS).map((c) => [c.chainId, c.rpc])),
    ...options.urls,
  };
  const get = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? RPC_TIMEOUT_MS;
  return async (chainId, to, data) => {
    const url = urls[chainId];
    if (!url) return { ok: false, missing: false };
    try {
      const res = await get(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to, data }, "latest"],
        }),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { ok: false, missing: false };
      const bytes = await readCapped(res.body, MAX_RPC_ANSWER_BYTES);
      if (!bytes) return { ok: false, missing: false, bad: true };
      return parseRpcAnswer(safeJson(new TextDecoder().decode(bytes)));
    } catch {
      return { ok: false, missing: false };
    }
  };
}

/**
 * A JSON-RPC answer as a read. A revert (error code 3, or a message saying so) is `missing`: the
 * contract refused, for example because that agent doesn't exist.
 */
export function parseRpcAnswer(body: unknown): ChainRead<string> {
  if (!body || typeof body !== "object") return { ok: false, missing: false };
  const { result, error } = body as { result?: unknown; error?: unknown };
  if (typeof result === "string" && /^0x([0-9a-fA-F]{2})*$/.test(result)) {
    return { ok: true, value: result.toLowerCase() };
  }
  if (error && typeof error === "object") {
    const { code, message } = error as { code?: unknown; message?: unknown };
    const reverted =
      code === 3 || (typeof message === "string" && /execution reverted|revert/i.test(message));
    return { ok: false, missing: reverted };
  }
  return { ok: false, missing: false };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---------- ABI ----------

/** A call to `selector` with one uint256 argument. */
export function encodeUintCall(selector: string, value: string | bigint): string {
  return selector + BigInt(value).toString(16).padStart(64, "0");
}

/** The 32-byte words of an ABI answer, or undefined when it isn't whole words. */
function words(hex: string): string[] | undefined {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (body.length === 0 || body.length % 64 !== 0) return undefined;
  const out: string[] = [];
  for (let i = 0; i < body.length; i += 64) out.push(body.slice(i, i + 64));
  return out;
}

const ADDRESS_WORD = /^0{24}([0-9a-f]{40})$/;

/** An `address` answer, lowercase with `0x`, or undefined when it isn't one. */
export function decodeAddress(hex: string): string | undefined {
  const [word] = words(hex.toLowerCase()) ?? [];
  const match = word ? ADDRESS_WORD.exec(word) : null;
  return match ? `0x${match[1]}` : undefined;
}

/** A `string` answer, or undefined when it isn't valid UTF-8 in the standard encoding. */
export function decodeString(hex: string, maxBytes = 100_000): string | undefined {
  const all = words(hex.toLowerCase());
  if (!all || all.length < 2) return undefined;
  const offset = Number.parseInt(all[0] ?? "", 16);
  if (offset !== 32) return undefined;
  const length = Number.parseInt(all[1] ?? "", 16);
  if (!Number.isSafeInteger(length) || length > maxBytes) return undefined;
  const data = all.slice(2).join("");
  if (data.length < length * 2) return undefined;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = Number.parseInt(data.slice(i * 2, i * 2 + 2), 16);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** What an ERC-8217 binding contract says an agent belongs to. */
export interface Binding {
  /** 0 is ERC-721; the other standards don't name one collection item. */
  standard: number;
  /** The collection, lowercase. */
  bound: string;
  /** The item's number, in decimal. */
  tokenId: string;
}

/** `bindingOf`'s answer: a static tuple, so three words with no offset. */
export function decodeBinding(hex: string): Binding | undefined {
  const all = words(hex.toLowerCase());
  if (all?.length !== 3) return undefined;
  const [standardWord = "", boundWord = "", idWord = ""] = all;
  const standard = Number.parseInt(standardWord, 16);
  const bound = ADDRESS_WORD.exec(boundWord)?.[1];
  if (!Number.isInteger(standard) || standard > 255 || !bound) return undefined;
  return { standard, bound: `0x${bound}`, tokenId: BigInt(`0x${idWord}`).toString() };
}

/** MusegodMuses' `agentOf`: whether the muse has an agent, and its number. */
export function decodeAgentOf(hex: string): { registered: boolean; agentId: string } | undefined {
  const all = words(hex.toLowerCase());
  if (all?.length !== 2) return undefined;
  const [flag = "", idWord = ""] = all;
  if (!/^0{63}[01]$/.test(flag)) return undefined;
  return { registered: flag.endsWith("1"), agentId: BigInt(`0x${idWord}`).toString() };
}

/** An address check that ignores case. */
export const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// ---------- reads ----------

/** A read decoded with `decode`; an answer that doesn't decode counts as a failure to reach it. */
async function read<T>(
  call: ChainCall,
  chainId: number,
  to: string,
  data: string,
  decode: (hex: string) => T | undefined,
): Promise<ChainRead<T>> {
  const raw = await call(chainId, to, data);
  if (!raw.ok) return raw;
  const value = decode(raw.value);
  return value === undefined ? { ok: false, missing: false, bad: true } : { ok: true, value };
}

export const readTokenUri = (call: ChainCall, chainId: number, registry: string, agentId: string) =>
  read(call, chainId, registry, encodeUintCall(SELECTORS.tokenURI, agentId), (hex) =>
    decodeString(hex),
  );

export const readOwner = (call: ChainCall, chainId: number, registry: string, agentId: string) =>
  read(call, chainId, registry, encodeUintCall(SELECTORS.ownerOf, agentId), decodeAddress);

export const readBinding = (call: ChainCall, chainId: number, contract: string, agentId: string) =>
  read(call, chainId, contract, encodeUintCall(SELECTORS.bindingOf, agentId), decodeBinding);

/** ERC-721 `ownerOf` on a partner's collection: who holds the character itself. */
export const readItemHolder = (
  call: ChainCall,
  chainId: number,
  collection: string,
  tokenId: string,
) => read(call, chainId, collection, encodeUintCall(SELECTORS.ownerOf, tokenId), decodeAddress);

export const readAgentOf = (call: ChainCall, chainId: number, contract: string, subject: string) =>
  read(call, chainId, contract, encodeUintCall(SELECTORS.agentOf, subject), decodeAgentOf);

/**
 * `call` with a short memory: the same read within `ttlMs` is answered from it. Only successes are
 * kept, so a failed read is tried again next time. Bounded: the oldest entries go first.
 *
 * Returns a maker of readers: each reader tells its `onRead` about every read that really went out
 * (a miss), so a caller can charge exactly what it spent. Hits are free.
 */
export function cachedCall(
  call: ChainCall,
  options: { now: () => number; ttlMs: number; max?: number },
): (onRead?: () => void) => ChainCall {
  const max = options.max ?? 500;
  const memory = new Map<string, { at: number; value: string }>();
  return (onRead) => async (chainId, to, data) => {
    const key = `${chainId} ${to.toLowerCase()} ${data}`;
    const now = options.now();
    const hit = memory.get(key);
    if (hit && now - hit.at < options.ttlMs) return { ok: true, value: hit.value };
    onRead?.();
    const answer = await call(chainId, to, data);
    if (answer.ok) {
      memory.delete(key);
      memory.set(key, { at: now, value: answer.value });
      while (memory.size > max) {
        const oldest = memory.keys().next().value;
        if (oldest === undefined) break;
        memory.delete(oldest);
      }
    }
    return answer;
  };
}

/**
 * RPC URLs from server config: `4663=https://...` pairs separated by commas or spaces. Only
 * allowlisted networks and https URLs count; anything else is ignored.
 */
export function parseRpcUrls(value: string | undefined): Record<number, string> {
  const out: Record<number, string> = {};
  for (const pair of (value ?? "").split(/[\s,]+/)) {
    const at = pair.indexOf("=");
    if (at < 1) continue;
    const chainId = Number(pair.slice(0, at));
    const url = pair.slice(at + 1);
    if (!CHAINS[chainId] || !URL.canParse(url) || new URL(url).protocol !== "https:") continue;
    out[chainId] = url;
  }
  return out;
}
