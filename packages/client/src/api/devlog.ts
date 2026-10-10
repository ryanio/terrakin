/** The devlog (decision 0105): posts for people. */
import { DevlogPostResponse, DevlogResponse } from "@terrakin/protocol";
import { request } from "./request";

export const devlogApi = {
  /** Every post, newest first. */
  devlog: () => request("GET", "/v1/devlog", DevlogResponse),
  /** One post whole. */
  devlogPost: (date: string) =>
    request("GET", `/v1/devlog/${encodeURIComponent(date)}`, DevlogPostResponse),
};
