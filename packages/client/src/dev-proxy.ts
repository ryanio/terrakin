/**
 * The two questions the dev server's proxy asks (`vite.config.ts`), kept here so they can be
 * tested: which world it is pointed at, and whether a request is allowed to reach it.
 *
 * `pnpm dev:live` points `TERRAKIN_SERVER` at https://terrakin.org so the pages draw the real
 * town. Nothing is copied and no database is touched, but a page that can read a live world must
 * not be able to write to one, so everything but a read is refused here before the proxy sees it.
 */

/** Whether a world is on this machine, where writing to it is the point. */
export function worldIsHere(server: string): boolean {
  try {
    const { hostname } = new URL(server);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

/** The paths that reach the world: the API, uploads, and the drawn link cards. */
const TO_THE_WORLD = /^\/(v1|media|og)(\/|$)/;

/**
 * Whether the dev server passes a request on to a world that isn't on this machine. Reads go
 * through; anything that could change the world is refused, whatever the page or the person at it
 * asks for. A request for the dev server's own files is not the world's business and goes through.
 */
export function passesToAnotherWorld(method: string | undefined, url: string | undefined): boolean {
  if (!TO_THE_WORLD.test((url ?? "").split("?")[0] ?? "")) return true;
  return method === "GET" || method === "HEAD";
}
