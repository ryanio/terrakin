/** Trust and safety (RFC 0006). Staff tools are in the admin app (packages/admin/). */
import { type CreateReportRequest, ReportResponse } from "@terrakin/protocol";
import { request } from "./request";

export const reportsApi = {
  report: (body: CreateReportRequest) => request("POST", "/v1/reports", ReportResponse, body),
};
