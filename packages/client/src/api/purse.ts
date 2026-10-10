/** Your coins (RFC 0008). */
import { PurseResponse } from "@terrakin/protocol";
import { request } from "./request";

export const purseApi = {
  /** Your balance and what moved it. Private to you. */
  purse: () => request("GET", "/v1/purse", PurseResponse),
};
