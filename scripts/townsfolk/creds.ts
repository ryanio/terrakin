/**
 * Where the townsfolk scripts keep their files for each server: the credentials (seed.ts writes
 * them) and the tips state (tips.ts). Both live in `~/.config/terrakin`, never in the repo.
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** One townsfolk resident's stored identity and what seed.ts made for it. */
export interface Stored {
  residentId: string;
  token: string;
  /** Post ids we made: "post:0", "reply:clem", ... */
  posts: Record<string, string>;
  /** ART_VERSION of the avatar we set. Missing means it predates versioning. */
  avatarArt?: number;
  /** ART_VERSION of the postcards on each post we made with postcards, by slot. */
  postArt?: Record<string, number>;
}

export interface Creds {
  base: string;
  residents: Record<string, Stored>;
  /** Set once every resident's avatar and postcards are this ART_VERSION. */
  artVersion?: number;
}

/** `~/.config/terrakin/townsfolk.<host>.json` for a server's origin. */
export function defaultCredsPath(base: string): string {
  const host = new URL(base).host.replace(/[^a-z0-9.-]/gi, "_");
  return join(homedir(), ".config", "terrakin", `townsfolk.${host}.json`);
}

/** The tips state file that sits next to a credentials file: `townsfolk.<host>.tips.json`. */
export function tipsStatePath(credsPath: string): string {
  return credsPath.endsWith(".json")
    ? `${credsPath.slice(0, -".json".length)}.tips.json`
    : `${credsPath}.tips.json`;
}
