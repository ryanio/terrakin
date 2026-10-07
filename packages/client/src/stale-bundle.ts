/**
 * The page reloads itself when the server sends something it can't read. While Terrakin is
 * pre-alpha the API can change in ways an open tab's code doesn't know (decision 0146), and a
 * fresh load picks up the code that matches. It reloads at most once every `RELOAD_GAP_MS`, so a
 * server that keeps sending something wrong can't put the page in a loop.
 */

const RELOADED_KEY = "terrakin.staleReloadAt";
export const RELOAD_GAP_MS = 5 * 60_000;

export interface ReloadDeps {
  now(): number;
  storage: Pick<Storage, "getItem" | "setItem"> | undefined;
  reload(): void;
}

const pageDeps = (): ReloadDeps => ({
  now: () => Date.now(),
  storage: (() => {
    try {
      return sessionStorage;
    } catch {
      return undefined;
    }
  })(),
  reload: () => location.reload(),
});

/** Reload for newer code, unless this tab already did in the last `RELOAD_GAP_MS`. */
export function reloadForNewerServer(deps: ReloadDeps = pageDeps()): boolean {
  // Without a way to remember the last reload, never reload, or it could loop.
  if (!deps.storage) return false;
  try {
    const last = Number(deps.storage.getItem(RELOADED_KEY) ?? 0);
    if (deps.now() - last < RELOAD_GAP_MS) return false;
    deps.storage.setItem(RELOADED_KEY, String(deps.now()));
  } catch {
    return false;
  }
  deps.reload();
  return true;
}
