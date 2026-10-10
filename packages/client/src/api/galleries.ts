/** Galleries (RFC 0005). */
import { GalleriesResponse } from "@terrakin/protocol";
import { query } from "@terrakin/ui/http";
import { request } from "./request";

export const galleriesApi = {
  /** Every gallery, or the ones on plots a resident owns or shares. */
  galleries: (resident?: string) =>
    request("GET", `/v1/galleries${query({ resident })}`, GalleriesResponse),
};
