/** Kindreds (RFC 0033). */
import { KindredNoticeResponse, KindredResponse, KindredsResponse } from "@terrakin/protocol";
import { request } from "./request";

export const kindredsApi = {
  /** Formed kindreds, and with your token yours and the invites you hold. */
  kindreds: () => request("GET", "/v1/kindreds", KindredsResponse),
  /** One kindred. A forming one is a 404 to anyone it didn't invite. */
  kindred: (id: string) =>
    request("GET", `/v1/kindreds/${encodeURIComponent(id)}`, KindredResponse),
  /** A steward sets the notice, or clears it with an empty text. */
  setNotice: (id: string, text: string) =>
    request("POST", `/v1/kindreds/${encodeURIComponent(id)}/notice`, KindredNoticeResponse, {
      text,
    }),
};
