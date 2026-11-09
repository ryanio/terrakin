import { IDEMPOTENCY_WINDOW_SECONDS } from "@terrakin/protocol";

/** What a replay needs: the first response's status, content type, and body. */
export interface StoredResponse {
  status: number;
  contentType: string | undefined;
  body: string;
}

interface Entry {
  scope: string;
  /** Hash of the request the key was first used with. */
  fingerprint: string;
  at: number;
  /** Settles once the first request finishes: its response, or undefined if it isn't kept. */
  response: Promise<StoredResponse | undefined>;
  bytes: number;
}

export type Lookup =
  | { kind: "new"; finish: (response: StoredResponse | undefined) => void }
  | { kind: "conflict" }
  | { kind: "replay"; response: Promise<StoredResponse | undefined> };

/**
 * Remembers `Idempotency-Key` results per resident for 24 hours, in memory. Bounded by entry
 * count and stored bytes for each scope (one resident) and in all, oldest first, so one resident's
 * fresh keys push out only their own until the whole store is full. Lost on restart: a retry
 * after a restart runs the request again. A retry that arrives while the first is still running
 * waits for it.
 */
export class IdempotencyStore {
  private readonly entries = new Map<string, Entry>();
  /** Each scope's ids, oldest first, and the bytes they hold. */
  private readonly scopes = new Map<string, { ids: Set<string>; bytes: number }>();
  private bytes = 0;

  constructor(
    private readonly options: {
      maxEntries?: number;
      maxBytes?: number;
      maxEntriesPerScope?: number;
      maxBytesPerScope?: number;
      now?: () => number;
    } = {},
  ) {}

  private get now() {
    return this.options.now ?? Date.now;
  }

  /** Claim `key` for this request, or find the earlier request that used it. */
  begin(scope: string, key: string, fingerprint: string): Lookup {
    const id = `${scope}\n${key}`;
    const prior = this.entries.get(id);
    if (prior && this.now() - prior.at < IDEMPOTENCY_WINDOW_SECONDS * 1000) {
      return prior.fingerprint === fingerprint
        ? { kind: "replay", response: prior.response }
        : { kind: "conflict" };
    }
    if (prior) this.remove(id);
    let finish!: (response: StoredResponse | undefined) => void;
    const response = new Promise<StoredResponse | undefined>((done) => {
      finish = done;
    });
    const entry: Entry = { scope, fingerprint, at: this.now(), response, bytes: 0 };
    this.entries.set(id, entry);
    const mine = this.scopes.get(scope) ?? { ids: new Set<string>(), bytes: 0 };
    mine.ids.add(id);
    this.scopes.set(scope, mine);
    return {
      kind: "new",
      finish: (stored) => {
        finish(stored);
        // Not worth keeping (an error the client should be free to retry): forget the key.
        if (this.entries.get(id) !== entry) return;
        if (!stored) {
          this.remove(id);
          return;
        }
        entry.bytes = stored.body.length + fingerprint.length;
        this.bytes += entry.bytes;
        mine.bytes += entry.bytes;
        this.trimScope(scope);
        this.trim();
      },
    };
  }

  /** Forget expired keys. Call about once a minute. */
  sweep() {
    const cutoff = this.now() - IDEMPOTENCY_WINDOW_SECONDS * 1000;
    for (const [id, entry] of this.entries) {
      // Insertion order is age order, so the first fresh one ends the scan.
      if (entry.at >= cutoff) break;
      this.remove(id);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  private remove(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.bytes -= entry.bytes;
    this.entries.delete(id);
    const mine = this.scopes.get(entry.scope);
    if (!mine) return;
    mine.ids.delete(id);
    mine.bytes -= entry.bytes;
    if (mine.ids.size === 0) this.scopes.delete(entry.scope);
  }

  /** Forget a scope's oldest keys until it's within its own share. */
  private trimScope(scope: string) {
    const maxEntries = this.options.maxEntriesPerScope ?? 100;
    const maxBytes = this.options.maxBytesPerScope ?? 1_000_000;
    const mine = this.scopes.get(scope);
    if (!mine) return;
    for (const id of mine.ids) {
      if (mine.ids.size <= maxEntries && mine.bytes <= maxBytes) break;
      this.remove(id);
    }
  }

  private trim() {
    const maxEntries = this.options.maxEntries ?? 2_000;
    const maxBytes = this.options.maxBytes ?? 4_000_000;
    for (const id of this.entries.keys()) {
      if (this.entries.size <= maxEntries && this.bytes <= maxBytes) break;
      this.remove(id);
    }
  }
}
