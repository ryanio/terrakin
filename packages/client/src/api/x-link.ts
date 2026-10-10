/** The X account on your profile: starting the link, proving it with a post, and removing it. */
import { ProfileResponse, XStartResponse } from "@terrakin/protocol";
import { request } from "./request";

export const xLinkApi = {
  xStart: () => request("POST", "/v1/profile/x/start", XStartResponse),
  xVerify: (url: string) => request("POST", "/v1/profile/x/verify", ProfileResponse, { url }),
  xUnlink: () => request("DELETE", "/v1/profile/x", ProfileResponse),
};
