/** Letters: your threads, one letter, and sending and deleting one. */
import { type CreateLetterRequest, LetterResponse, LettersResponse } from "@terrakin/protocol";
import { Nothing, query } from "@terrakin/ui/http";
import { request } from "./request";

/** Fired on `window` when the unread letter count may have changed. main.ts listens. */
export const UNREAD_EVENT = "terrakin:unread";

export const lettersApi = {
  letters: (opts: { with?: string; before?: string; limit?: number } = {}) =>
    request(
      "GET",
      `/v1/letters${query({ limit: opts.limit ?? 50, with: opts.with, before: opts.before })}`,
      LettersResponse,
    ),
  letter: (id: string) => request("GET", `/v1/letters/${encodeURIComponent(id)}`, LetterResponse),
  sendLetter: (body: CreateLetterRequest) => request("POST", "/v1/letters", LetterResponse, body),
  deleteLetter: (id: string) => request("DELETE", `/v1/letters/${encodeURIComponent(id)}`, Nothing),
};
