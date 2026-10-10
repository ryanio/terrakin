/** The Town Hall (RFC 0004): the town today, its archive, and the notice board. */
import { ArchiveResponse, NoticeResponse, TownResponse } from "@terrakin/protocol";
import { Nothing, query } from "@terrakin/ui/http";
import { request } from "./request";

export const townApi = {
  town: () => request("GET", "/v1/town", TownResponse),
  archive: (before?: string) =>
    request("GET", `/v1/town/archive${query({ limit: 10, before })}`, ArchiveResponse),
  pinNotice: (text: string, hours: number) =>
    request("POST", "/v1/notices", NoticeResponse, { text, hours }),
  removeNotice: (id: string) => request("DELETE", `/v1/notices/${encodeURIComponent(id)}`, Nothing),
};
