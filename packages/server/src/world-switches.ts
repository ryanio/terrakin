import type { WorldServiceOptions } from "./world-service";

/**
 * The world switches terrakin.org runs, which the Worker and the Node server both spread, so a
 * self-hosted, dev, or e2e world plays the same game ([decision 0373](../../../docs/knowledge/decisions/0373-every-node-world-opens-the-systems-terrakin-org-runs-recipes.md)).
 * A switch only terrakin.org runs is listed in `cloudflare/worker.ts` with its reason. A
 * self-hosted owner who wants one of these off overrides it after the spread in `main.ts`.
 * The plot market is off everywhere, so it is in neither place.
 */
export const WORLD_SWITCHES = {
  days: true,
  economy: true,
  items: true,
  gifts: true,
  plotPickups: true,
  finds: true,
  solidBuildings: true,
  tableSpots: true,
  starterDoors: true,
  starterEdges: true,
  slimHomes: true,
  shop: true,
  shopInPerson: true,
  proposeInPerson: true,
  scheduleInPerson: true,
  recipes: true,
  holidayPrices: true,
  raisedInventory: true,
  levels: true,
  jobs: true,
  jobEdition: 2,
  pageEdition: 3,
  circles: true,
  market: true,
  bounties: true,
  presence: true,
} as const satisfies Partial<WorldServiceOptions>;
