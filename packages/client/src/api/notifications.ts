/** Notifications: the list behind the bell, and marking it read. */
import { NotificationsResponse, UnreadResponse } from "@terrakin/protocol";
import { query } from "@terrakin/ui/http";
import { request } from "./request";

export const notificationsApi = {
  notifications: (opts: { before?: string; limit?: number } = {}) =>
    request(
      "GET",
      `/v1/notifications${query({ limit: opts.limit ?? 20, before: opts.before })}`,
      NotificationsResponse,
    ),
  markRead: (upTo: string) => request("POST", "/v1/notifications/read", UnreadResponse, { upTo }),
};
