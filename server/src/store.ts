import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Input } from "@terrakin/sim";

export interface SessionRecord {
  /** sha256 of the bearer token. The raw token is never stored. */
  tokenHash: string;
  residentId: string;
}

/** A resident's link key (decision 0020), or `keyHash: null` once it's turned off. */
export interface LinkKeyRecord {
  residentId: string;
  /** sha256 of the link key. The raw key is never stored. */
  keyHash: string | null;
}

/**
 * Durable storage for the world. The world itself is never stored, only the log of accepted
 * inputs: on boot the server replays the log through the sim. That keeps one source of truth
 * and makes every state auditable.
 */
export interface Store {
  loadLog(): Input[];
  appendInput(input: Input): void;
  loadSessions(): SessionRecord[];
  appendSession(session: SessionRecord): void;
  /** Link key changes, oldest first. The last record for a resident is the one that counts. */
  loadLinkKeys(): LinkKeyRecord[];
  saveLinkKey(record: LinkKeyRecord): void;
}

export class MemoryStore implements Store {
  readonly log: Input[] = [];
  readonly sessions: SessionRecord[] = [];
  loadLog() {
    return [...this.log];
  }
  appendInput(input: Input) {
    this.log.push(input);
  }
  loadSessions() {
    return [...this.sessions];
  }
  appendSession(session: SessionRecord) {
    this.sessions.push(session);
  }
  readonly linkKeys: LinkKeyRecord[] = [];
  loadLinkKeys() {
    return [...this.linkKeys];
  }
  saveLinkKey(record: LinkKeyRecord) {
    this.linkKeys.push(record);
  }
}

/**
 * Append-only JSON Lines files in a directory. Good enough for Phase 1 and trivially inspectable
 * with `cat`. Postgres replaces this once an RFC settles the schema.
 */
export class JsonlStore implements Store {
  private readonly logPath: string;
  private readonly sessionsPath: string;
  private readonly linkKeysPath: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.logPath = join(dir, "world.log.jsonl");
    this.sessionsPath = join(dir, "sessions.jsonl");
    this.linkKeysPath = join(dir, "link-keys.jsonl");
  }

  loadLog(): Input[] {
    return readJsonl<Input>(this.logPath);
  }
  appendInput(input: Input) {
    appendFileSync(this.logPath, `${JSON.stringify(input)}\n`);
  }
  loadSessions(): SessionRecord[] {
    return readJsonl<SessionRecord>(this.sessionsPath);
  }
  appendSession(session: SessionRecord) {
    appendFileSync(this.sessionsPath, `${JSON.stringify(session)}\n`);
  }
  loadLinkKeys(): LinkKeyRecord[] {
    return readJsonl<LinkKeyRecord>(this.linkKeysPath);
  }
  saveLinkKey(record: LinkKeyRecord) {
    appendFileSync(this.linkKeysPath, `${JSON.stringify(record)}\n`);
  }
}

/**
 * Read a JSON Lines file. A crash mid-append can leave a partial last line; that line is skipped
 * with a warning, since its input was never acknowledged. Corruption anywhere else is fatal.
 */
export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");
  return lines.flatMap((line, i) => {
    try {
      return [JSON.parse(line) as T];
    } catch (err) {
      if (i === lines.length - 1) {
        console.warn(`Skipping truncated last line of ${path}`);
        return [];
      }
      throw new Error(`Corrupt line ${i + 1} in ${path}`, { cause: err });
    }
  });
}
