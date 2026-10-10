import { createHash } from "node:crypto";
import { randomBytes, toBase64Url } from "./bytes";
import type { Store } from "./store";

/**
 * Bearer tokens and link keys (decision 0020), and the randomness behind them and resident ids.
 * Only SHA-256 hashes are kept, in the store and in memory; a token or key is shown once.
 * `WorldService` holds one and answers for it, telling `onCall` about each resident it resolves.
 */

/** How a token or link key is kept: its SHA-256, in hex. `OwnerService.retired` hashes the same way. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export class WorldCredentials {
  private readonly store: Store;
  private readonly sessions = new Map<string, string>(); // tokenHash -> residentId
  /** Link keys (decision 0020): at most one per resident. keyHash -> residentId, and back. */
  private readonly linkKeys = new Map<string, string>();
  private readonly linkKeyOf = new Map<string, string>();
  /** residentId -> callbacks that close their live connections when their tokens are revoked. */
  private readonly revocationWatchers = new Map<string, Set<() => void>>();

  constructor(store: Store) {
    this.store = store;
    for (const s of this.store.loadSessions()) this.sessions.set(s.tokenHash, s.residentId);
    for (const k of this.store.loadLinkKeys()) this.rememberLinkKey(k.residentId, k.keyHash);
  }

  /**
   * Make a new link key for a resident and turn off the one they had. Returns the key, which is
   * shown once and never stored or logged; only its hash is kept.
   */
  mintLinkKey(residentId: string): string {
    const key = `k_${toBase64Url(randomBytes(32))}`;
    const keyHash = hashToken(key);
    // Save first: a key that isn't saved must not work, or it would stop working on restart.
    this.store.saveLinkKey({ residentId, keyHash });
    this.rememberLinkKey(residentId, keyHash);
    return key;
  }

  /** Turn off a resident's link key. Returns whether there was one. */
  revokeLinkKey(residentId: string): boolean {
    if (!this.linkKeyOf.has(residentId)) return false;
    this.store.saveLinkKey({ residentId, keyHash: null });
    this.rememberLinkKey(residentId, null);
    return true;
  }

  /** The resident a link key belongs to, or undefined if it's unknown or turned off. */
  linkKeyResident(key: string): string | undefined {
    if (!key.startsWith("k_")) return undefined;
    return this.linkKeys.get(hashToken(key));
  }

  private rememberLinkKey(residentId: string, keyHash: string | null) {
    const old = this.linkKeyOf.get(residentId);
    if (old !== undefined) this.linkKeys.delete(old);
    if (keyHash === null) {
      this.linkKeyOf.delete(residentId);
      return;
    }
    this.linkKeys.set(keyHash, residentId);
    this.linkKeyOf.set(residentId, keyHash);
  }

  /**
   * The hashes of every token and the link key this resident holds now, so a revoke or re-key can
   * remember what it turned off and say so to a caller who sends one again.
   */
  credentialHashes(residentId: string): string[] {
    const hashes: string[] = [];
    for (const [tokenHash, id] of this.sessions) if (id === residentId) hashes.push(tokenHash);
    const key = this.linkKeyOf.get(residentId);
    if (key !== undefined) hashes.push(key);
    return hashes;
  }

  /** Whether this resident holds a bearer token now. */
  holdsToken(residentId: string): boolean {
    for (const id of this.sessions.values()) if (id === residentId) return true;
    return false;
  }

  /** A new bearer token for an existing resident. Only its hash is kept. */
  issueToken(residentId: string): string {
    const token = toBase64Url(randomBytes(32));
    const tokenHash = hashToken(token);
    this.store.appendSession({ tokenHash, residentId });
    this.sessions.set(tokenHash, residentId);
    return token;
  }

  /**
   * Make every token this resident holds stop working, now and after a restart, and close their
   * live connections. Persisted first, so a failed write leaves the old tokens working rather
   * than half revoked.
   */
  revokeTokens(residentId: string) {
    this.store.revokeSessions(residentId);
    for (const [tokenHash, id] of this.sessions) {
      if (id === residentId) this.sessions.delete(tokenHash);
    }
    for (const close of [...(this.revocationWatchers.get(residentId) ?? [])]) close();
  }

  /** Whether this resident has a live socket open with one of their tokens. */
  connected(residentId: string): boolean {
    return (this.revocationWatchers.get(residentId)?.size ?? 0) > 0;
  }

  /** Run `close` if this resident's tokens are revoked. Returns a function that stops watching. */
  watchRevocation(residentId: string, close: () => void): () => void {
    let set = this.revocationWatchers.get(residentId);
    if (!set) {
      set = new Set();
      this.revocationWatchers.set(residentId, set);
    }
    set.add(close);
    return () => {
      set.delete(close);
      if (set.size === 0 && this.revocationWatchers.get(residentId) === set) {
        this.revocationWatchers.delete(residentId);
      }
    };
  }

  /** The resident a bearer token belongs to, or undefined if unknown. */
  tokenResident(token: string): string | undefined {
    return this.sessions.get(hashToken(token));
  }
}
