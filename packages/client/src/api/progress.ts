/** Levels and skills (RFC 0029). */
import { ProgressResponse } from "@terrakin/protocol";
import { request } from "./request";

export const progressApi = {
  /** Your own levels, points, and today's counts: private, like your purse. */
  progress: () => request("GET", "/v1/progress", ProgressResponse),
};
