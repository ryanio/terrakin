/** The collection book (RFC 0021). */
import { CollectionResponse } from "@terrakin/protocol";
import { request } from "./request";

export const collectionApi = {
  /** A resident's collection book: public, like their profile. */
  collection: (id: string) =>
    request("GET", `/v1/residents/${encodeURIComponent(id)}/collection`, CollectionResponse),
};
