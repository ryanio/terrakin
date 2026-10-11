/** The world: joining it, reading it whole, and acting in it. */
import {
  type Action,
  ActionResponse,
  type CreateSessionRequest,
  CreateSessionResponse,
  WorldSnapshot,
} from "@terrakin/protocol";
import type { ResidentColor, ResidentShape } from "@terrakin/sim";
import { type Result, request } from "./request";

/**
 * Why an action didn't happen: the request failed, or the world answered no (a 200 can still be a
 * refusal). Null when it worked. `words` puts a refusal in a view's own words by its code, for the
 * few whose message is written for agents; without it the message is the server's.
 */
export function actProblem(
  r: Result<{ ok: true } | { ok: false; error: { code: string; message: string } }>,
  words: (code: string, message: string) => string = (_code, message) => message,
): string | null {
  if (!r.ok) return r.message;
  return r.data.ok ? null : words(r.data.error.code, r.data.error.message);
}

export const worldApi = {
  createSession: (body: CreateSessionRequest) =>
    request("POST", "/v1/session", CreateSessionResponse, body),
  world: () => request("GET", "/v1/world", WorldSnapshot),
  /** A world action. A 200 can still be a refusal by the rules: check `ok` in the body. */
  act: (action: Action) => request("POST", "/v1/actions", ActionResponse, action),
  /** Change your color, shape, or note (the world's `profile` action). */
  setLook: (fields: { color?: ResidentColor; shape?: ResidentShape; note?: string }) =>
    request("POST", "/v1/actions", ActionResponse, { type: "profile", ...fields }),
};
