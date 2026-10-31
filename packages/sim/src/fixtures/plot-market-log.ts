import type { Input, WorldConfig } from "../types";
import { TOWN_ACTOR } from "../types";
import { LANDS_ISLAND } from "./lands-log";

/**
 * A plot changing hands (RFC 0039, decision 0344). Downtown is 3 by 3 plots of 8 tiles and the
 * island Willowmere is open, so plots can go on sale, and the switch raises the cap to 3. Ada settles plot (0, 0), builds the starter
 * hut, and shares it with Eve; Cy is Ada's AI, so the two are one household; Dee settles on the
 * island. Two weeks later Ada lists her plot, takes it back, lists it again, and Bob buys it: the
 * hut stays, Ada's hearth and Eve's share go, and the coins move less the market's fee.
 * `plot-market.test.ts` replays it and checks the hash pinned below, so a change to what a sale
 * moves, or to whom, fails loudly. Every older fixture hashes as before, because no log before
 * this one ever opened the plot market.
 */
export const PLOT_MARKET_CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/** The day the plot was claimed, and the first day it may be listed. */
export const PLOT_MARKET_DAY = 20_100;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const as = (actor: string, command: Input["command"]): Input => ({ actor, command });

/** The world up to the day Ada may list, with nothing listed yet. */
export const PLOT_MARKET_SETUP: Input[] = [
  town({ type: "new_day", day: PLOT_MARKET_DAY }),
  town({ type: "open_economy" }),
  town({ type: "open_items" }),
  town({ type: "open_shop" }),
  town({ type: "open_market" }),
  town(LANDS_ISLAND),
  town({ type: "open_plot_market", maxPlotsPerResident: 3 }),
  as("ada", { type: "join", name: "Ada", kind: "human" }),
  as("ada", { type: "settle", px: 0, py: 0 }),
  as("ada", { type: "build_starter_home" }),
  as("eve", { type: "join", name: "Eve", kind: "human" }),
  as("ada", { type: "share_plot", with: "eve" }),
  as("bob", { type: "join", name: "Bob", kind: "human" }),
  as("cy", { type: "join", name: "Cy", kind: "agent" }),
  town({ type: "add_owner_pair", pair: ["ada", "cy"] }),
  as("dee", { type: "join", name: "Dee", kind: "human" }),
  as("dee", { type: "settle", px: 4, py: 0 }),
  town({ type: "test_grant", to: "ada", coins: 100 }),
  town({ type: "test_grant", to: "bob", coins: 1000 }),
  town({ type: "test_grant", to: "cy", coins: 1000 }),
  town({ type: "new_day", day: PLOT_MARKET_DAY + 14 }),
];

export const PLOT_MARKET_LOG: Input[] = [
  ...PLOT_MARKET_SETUP,
  as("ada", { type: "list_plot", px: 0, py: 0, price: 300 }),
  as("ada", { type: "unlist_plot", px: 0, py: 0 }),
  as("ada", { type: "list_plot", px: 0, py: 0, price: 300 }),
  as("bob", { type: "buy_plot", px: 0, py: 0, price: 300, listed: PLOT_MARKET_SETUP.length + 3 }),
  town({ type: "new_day", day: PLOT_MARKET_DAY + 15 }),
];

/**
 * `hashWorld(replay(PLOT_MARKET_CONFIG, PLOT_MARKET_LOG))`, pinned again when `open_plot_market`
 * came to carry the cap and when a sold plot came to keep `boughtFor`. No live log holds the
 * switch, so this is the only hash either moved.
 */
export const PLOT_MARKET_HASH = "69335b8a";
