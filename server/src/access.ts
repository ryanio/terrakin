/**
 * Cloudflare Access sign-ins for admin.terrakin.org (RFC 0006, decision 0040). Access sits in front
 * of the admin host and adds a signed JWT to every request it lets through, as the
 * `Cf-Access-Jwt-Assertion` header and the `CF_Authorization` cookie. This checks that JWT against
 * the team's public keys: RS256 signature, audience, issuer, and expiry. Runs on Web Crypto, so the
 * Worker and Node use the same code, and tests sign tokens with a key pair they make.
 */

export interface AccessConfig {
  /** The team domain, like `ryan-coral.cloudflareaccess.com`. */
  team: string;
  /** The Access application's audience tag. */
  aud: string;
}

export interface AccessIdentity {
  email: string;
}

interface Jwk {
  kid?: string;
  kty?: string;
  [field: string]: unknown;
}
/** Web Crypto's key type, named without the DOM library so both runtimes typecheck. */
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
type ImportableJwk = Extract<Parameters<typeof crypto.subtle.importKey>[1], { kty?: string }>;

/** How long fetched keys are trusted before they're fetched again. */
const KEYS_TTL_MS = 60 * 60_000;
/** An unknown key id refetches at most this often, so junk tokens can't hammer the certs URL. */
const REFETCH_MIN_MS = 60_000;
/** Clock skew allowed on `exp` and `nbf`, in seconds. */
const SKEW_S = 60;

const decoder = new TextDecoder();

function base64url(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function json(part: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(decoder.decode(base64url(part)));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The Access token on a request: the header Access adds, or its cookie. */
export function accessToken(header: string | null | undefined, cookie: string | null | undefined) {
  if (header) return header;
  const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie ?? "");
  return match?.[1];
}

/** Read `TERRAKIN_ACCESS_TEAM` and `TERRAKIN_ACCESS_AUD`. Both or nothing. */
export function accessConfig(team: string | undefined, aud: string | undefined) {
  const t = team
    ?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const a = aud?.trim();
  return t && a ? { team: t, aud: a } : undefined;
}

export class AccessVerifier {
  private keys = new Map<string, Key>();
  private fetchedAt = 0;
  private refetching: Promise<void> | undefined;

  constructor(
    private readonly config: AccessConfig,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {}

  /** The signed-in identity, or undefined for anything that doesn't check out. Never throws. */
  async verify(token: string | undefined): Promise<AccessIdentity | undefined> {
    if (!token) return undefined;
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const [head, body, signature] = parts as [string, string, string];
    const header = json(head);
    const claims = json(body);
    if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string") {
      return undefined;
    }
    const key = await this.key(header.kid);
    if (!key) return undefined;
    let valid = false;
    try {
      valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        base64url(signature),
        new TextEncoder().encode(`${head}.${body}`),
      );
    } catch {
      return undefined;
    }
    if (!valid) return undefined;
    const nowS = Math.floor(this.now() / 1000);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(this.config.aud)) return undefined;
    if (claims.iss !== `https://${this.config.team}`) return undefined;
    if (typeof claims.exp !== "number" || claims.exp + SKEW_S < nowS) return undefined;
    if (typeof claims.nbf === "number" && claims.nbf - SKEW_S > nowS) return undefined;
    if (typeof claims.email !== "string" || !claims.email.includes("@")) return undefined;
    return { email: claims.email.toLowerCase() };
  }

  /** A verifying key by id: from the cache, or from a fresh fetch when it's stale or unknown. */
  private async key(kid: string): Promise<Key | undefined> {
    const stale = this.now() - this.fetchedAt > KEYS_TTL_MS;
    if (!stale && this.keys.has(kid)) return this.keys.get(kid);
    if (stale || this.now() - this.fetchedAt > REFETCH_MIN_MS) {
      this.refetching ??= this.refresh().finally(() => {
        this.refetching = undefined;
      });
      await this.refetching;
    }
    return this.keys.get(kid);
  }

  private async refresh() {
    this.fetchedAt = this.now();
    try {
      const res = await this.fetcher(`https://${this.config.team}/cdn-cgi/access/certs`);
      if (!res.ok) return;
      const body = (await res.json()) as { keys?: Jwk[] };
      const next = new Map<string, Key>();
      for (const jwk of body.keys ?? []) {
        if (!jwk.kid || jwk.kty !== "RSA") continue;
        try {
          next.set(
            jwk.kid,
            await crypto.subtle.importKey(
              "jwk",
              jwk as ImportableJwk,
              { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
              false,
              ["verify"],
            ),
          );
        } catch {
          // A key we can't use is skipped; the others still work.
        }
      }
      // Keep the old keys if the fetch came back empty, so a hiccup doesn't sign everyone out.
      if (next.size > 0) this.keys = next;
    } catch (err) {
      console.error("Couldn't fetch the Access keys", err instanceof Error ? err.message : "");
    }
  }
}

/** Email lists from config: comma or whitespace separated, lowercased. */
export function parseEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[\s,]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@")),
  );
}
