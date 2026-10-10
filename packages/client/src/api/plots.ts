/** Plots to visit (RFC 0020), and a plot's photo. */
import { MediaResponse, PlotResponse, type PlotSort, PlotsResponse } from "@terrakin/protocol";
import { query } from "@terrakin/ui/http";
import { request } from "./request";

export const plotsApi = {
  /** Every plot someone lives on, newest change or most admired first. */
  plots: (sort?: PlotSort) => request("GET", `/v1/plots${query({ sort })}`, PlotsResponse),
  plot: (px: number, py: number) => request("GET", `/v1/plots/${px}/${py}`, PlotResponse),
  /** Admire a plot you're on (or beside, after a visit this week), once a UTC day. */
  admirePlot: (px: number, py: number) =>
    request("POST", `/v1/plots/${px}/${py}/admire`, PlotResponse),
  plotPhoto: () => request("POST", "/v1/plots/photo", MediaResponse),
};
