/** Circles (RFC 0033). */
import { CircleNoticeResponse, CircleResponse, CirclesResponse } from "@terrakin/protocol";
import { request } from "./request";

export const circlesApi = {
  /** Formed circles, and with your token yours and the invites you hold. */
  circles: () => request("GET", "/v1/circles", CirclesResponse),
  /** One circle. A forming one is a 404 to anyone it didn't invite. */
  circle: (id: string) => request("GET", `/v1/circles/${encodeURIComponent(id)}`, CircleResponse),
  /** A steward sets the notice, or clears it with an empty text. */
  setNotice: (id: string, text: string) =>
    request("POST", `/v1/circles/${encodeURIComponent(id)}/notice`, CircleNoticeResponse, {
      text,
    }),
};
