/** The town's jobs (RFC 0030). */
import { JobsResponse } from "@terrakin/protocol";
import { request } from "./request";

export const jobsApi = {
  /** Today's board for anyone, and with your token where you stand: private, like your purse. */
  jobs: () => request("GET", "/v1/jobs", JobsResponse),
};
