/**
 * The cards Worker. satori, resvg's wasm and the card fonts live here alone, reached from the main
 * Worker over the `CARDS` service binding (decision 0299). Config is `wrangler.cards.jsonc`.
 *
 * It has no routes, no `workers.dev` address and no `fetch`, so only a service binding reaches it.
 * It starts no Sentry client either: a draw that throws comes back to the caller over RPC, which
 * reports it with the route it was serving.
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import type { Card, CardDrawer, Rendered } from "../src/index";
import { cards } from "../src/worker";

export default class CardsWorker extends WorkerEntrypoint implements CardDrawer {
  render(card: Card): Promise<Rendered> {
    return cards.render(card);
  }
}
