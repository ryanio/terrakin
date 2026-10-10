/**
 * The page reloads itself when the server sends something it can't read: a welcome, a snapshot, or
 * any REST answer that doesn't match its schema. While Terrakin is pre-alpha the API can change in
 * ways an open tab's code doesn't know (decision 0146), and a fresh load picks up the code that
 * matches. It reloads at most once every `RELOAD_GAP_MS`, so a
 * server that keeps sending something wrong can't put the page in a loop. Answers that arrive
 * together are covered by one reload: once a page has asked, every later call on it says so.
 */

const RELOADED_KEY = "terrakin.staleReloadAt";
export const RELOAD_GAP_MS = 5 * 60_000;

/** When this page's code started, on the clock the reload is stamped with. */
const LOADED_AT = Date.now();

export interface ReloadDeps {
  now(): number;
  /** When this page's code started. A reload stamped since then was asked for by this page. */
  loadedAt: number;
  storage: Pick<Storage, "getItem" | "setItem"> | undefined;
  reload(): void;
}

const pageDeps = (): ReloadDeps => ({
  now: () => Date.now(),
  loadedAt: LOADED_AT,
  storage: (() => {
    try {
      return sessionStorage;
    } catch {
      return undefined;
    }
  })(),
  reload: () => location.reload(),
});

/**
 * Reload for newer code, unless this tab already did in the last `RELOAD_GAP_MS`. True when a
 * reload is on its way, from this call or an earlier one on this page.
 */
export function reloadForNewerServer(deps: ReloadDeps = pageDeps()): boolean {
  // Without a way to remember the last reload, never reload, or it could loop.
  if (!deps.storage) return false;
  try {
    const last = Number(deps.storage.getItem(RELOADED_KEY) ?? 0);
    // The page keeps running until it unloads, and what it can't read meanwhile is the same news.
    if (last >= deps.loadedAt) return true;
    if (deps.now() - last < RELOAD_GAP_MS) return false;
    deps.storage.setItem(RELOADED_KEY, String(deps.now()));
  } catch {
    return false;
  }
  deps.reload();
  return true;
}
