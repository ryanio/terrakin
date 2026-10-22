/** Plots for sale (RFC 0039). Only lazy pages import it, so the first load never carries it. */
import { PlotMarketResponse } from "@terrakin/protocol";
import { request } from "./request";

export const plotMarketApi = {
  /** The plots for sale, newest first, and with a token your balance and each plot you own. */
  plotMarket: () => request("GET", "/v1/plot-market", PlotMarketResponse),
};
