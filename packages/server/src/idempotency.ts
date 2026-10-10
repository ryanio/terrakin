import { IDEMPOTENCY_WINDOW_SECONDS } from "@terrakin/protocol";
import { toHex } from "./bytes";

/** What a replay needs: the first response's status, content type, and body. */
export interface StoredResponse {
  status: number;
  contentType: string | undefined;
  body: string;
}

interface Entry {
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
 * count and stored bytes (oldest go first), and lost on restart: a retry after a restart runs
 * the request again. A retry that arrives while the first is still running waits for it.
 */
export class IdempotencyStore {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;

  constructor(
    private readonly options: {
      maxEntries?: number;
      maxBytes?: number;
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
    const entry: Entry = { fingerprint, at: this.now(), response, bytes: 0 };
    this.entries.set(id, entry);
    return {
      kind: "new",
      finish: (stored) => {
        finish(stored);
        // Not worth keeping (an error the client should be free to retry): forget the key.
        if (!stored) {
          if (this.entries.get(id) === entry) this.remove(id);
          return;
        }
        entry.bytes = stored.body.length + fingerprint.length;
        this.bytes += entry.bytes;
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

/** SHA-256 of `text` as hex. Web Crypto, so it runs on Node and Workers alike. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}
