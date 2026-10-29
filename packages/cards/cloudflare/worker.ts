/**
 * The cards Worker. satori, resvg's wasm and the card fonts live here alone, reached from the main
 * Worker over the `CARDS` service binding (decision 0299). Config is `wrangler.cards.jsonc`.
 *
 * It has no routes and no `workers.dev` address, so a service binding is the only way in. It
 * starts no Sentry client either: a draw that throws comes back to the caller over RPC, which
 * reports it with the route it was serving.
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import type { Card, CardDrawer, Rendered, SceneDrawer } from "../src/index";
import { cards } from "../src/worker";
import { renderScene } from "./scene";

interface Env {
  /** Browser Run (wrangler.cards.jsonc `browser`), for scene photos (RFC 0049). */
  BROWSER?: Fetcher;
}

export default class CardsWorker extends WorkerEntrypoint<Env> implements CardDrawer, SceneDrawer {
  render(card: Card): Promise<Rendered> {
    return cards.render(card);
  }

  /** A scene photo (RFC 0049): the photo page at `url`, drawn by Browser Run. */
  scene(url: string, origin: string, readyMs: number): Promise<Uint8Array> {
    if (!this.env.BROWSER) throw new Error("no Browser Run binding");
    return renderScene(this.env.BROWSER, url, origin, readyMs);
  }

  /**
   * Cloudflare refuses to upload a script with no registered event handler (code 10068), and an
   * entrypoint's RPC methods aren't one, so the Worker needs a `fetch` to deploy at all. Nothing
   * should ever reach it: the Worker has no routes and no address, and drawings come over `render`.
   */
  override fetch(): Response {
    return new Response("Not found.", { status: 404 });
  }
}
