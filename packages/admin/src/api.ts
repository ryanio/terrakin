/**
 * The staff routes, on the same host the app came from (relative `/v1/...` paths). Every answer
 * is parsed with the protocol schemas.
 *
 * On admin.terrakin.org, Cloudflare Access signs staff in and the Worker passes the verified email
 * on; the app sends no credentials of its own. Where Access isn't set up (local dev, a self-hosted
 * Node server), staff paste a maintainer's or moderator's resident token, which this tab keeps in
 * sessionStorage until it closes.
 */
import {
  AdminOverviewResponse,
  CreatedStaffKeyResponse,
  ModerationLogResponse,
  ModerationResponse,
  NewcomersResponse,
  type ReportKind,
  ReportQueueResponse,
  type ReportReason,
  StaffBountiesResponse,
  StaffBountyResponse,
  StaffEventResponse,
  StaffKeyResponse,
  type StaffKeyScope,
  StaffKeysResponse,
  StaffMergeResponse,
  StaffRekeyResponse,
  TownsfolkActivityResponse,
} from "@terrakin/protocol";
import { makeRequest, query, type Result } from "@terrakin/ui/http";

export type { Result };

const TOKEN_KEY = "terrakin.staff-token";
/** The token when sessionStorage can't hold it (some private modes). */
let memoryToken: string | undefined;

export function savedToken(): string | undefined {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export function saveToken(token: string | undefined) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the token lasts as long as the page instead.
  }
  memoryToken = token;
}

/** Fired on `window` when the server says the sign-in is missing or ran out. */
export const SIGNED_OUT_EVENT = "terrakin:staff-signed-out";

const request = makeRequest({
  headers: () => {
    const token = savedToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  },
  onError: (code) => {
    if (code === "unauthorized") window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  },
});

const path = (template: string, id: string) => template.replace("{id}", encodeURIComponent(id));

export const api = {
  overview: () => request("GET", "/v1/admin/overview", AdminOverviewResponse),
  townsfolk: () => request("GET", "/v1/admin/townsfolk", TownsfolkActivityResponse),
  newcomers: () => request("GET", "/v1/admin/newcomers", NewcomersResponse),
  reports: () => request("GET", `/v1/admin/reports${query({ limit: 50 })}`, ReportQueueResponse),
  log: (before?: string) =>
    request("GET", `/v1/admin/log${query({ limit: 30, before })}`, ModerationLogResponse),
  hidePost: (id: string, reason: string, rule: ReportReason) =>
    request("POST", path("/v1/admin/posts/{id}/hide", id), ModerationResponse, { reason, rule }),
  unhidePost: (id: string, reason: string) =>
    request("POST", path("/v1/admin/posts/{id}/unhide", id), ModerationResponse, { reason }),
  suspend: (id: string, days: number, reason: string) =>
    request("POST", path("/v1/admin/residents/{id}/suspend", id), ModerationResponse, {
      days,
      reason,
    }),
  unsuspend: (id: string, reason: string) =>
    request("POST", path("/v1/admin/residents/{id}/unsuspend", id), ModerationResponse, {
      reason,
    }),
  quarantine: (id: string, reason: string) =>
    request("POST", path("/v1/admin/residents/{id}/quarantine", id), ModerationResponse, {
      reason,
    }),
  release: (id: string, reason: string) =>
    request("POST", path("/v1/admin/residents/{id}/release", id), ModerationResponse, { reason }),
  removePictures: (id: string, reason: string, rule: ReportReason) =>
    request("POST", path("/v1/admin/residents/{id}/remove-pictures", id), ModerationResponse, {
      reason,
      rule,
    }),
  clearPlotNames: (id: string, reason: string, rule: ReportReason) =>
    request("POST", path("/v1/admin/residents/{id}/clear-plot-names", id), ModerationResponse, {
      reason,
      rule,
    }),
  removeListing: (id: string, reason: string, rule: ReportReason) =>
    request("POST", path("/v1/admin/listings/{id}/remove", id), ModerationResponse, {
      reason,
      rule,
    }),
  removeDisplay: (id: string, reason: string, rule: ReportReason) =>
    request("POST", path("/v1/admin/displays/{id}/remove", id), ModerationResponse, {
      reason,
      rule,
    }),
  removePiece: (id: string, reason: string, rule: ReportReason) =>
    request("POST", path("/v1/admin/pieces/{id}/remove", id), ModerationResponse, { reason, rule }),
  bounties: () => request("GET", "/v1/admin/bounties", StaffBountiesResponse),
  keys: () => request("GET", "/v1/admin/keys", StaffKeysResponse),
  makeKey: (name: string, scope: StaffKeyScope, days: number) =>
    request("POST", "/v1/admin/keys", CreatedStaffKeyResponse, { name, scope, days }),
  revokeKey: (id: string) =>
    request("POST", path("/v1/admin/keys/{id}/revoke", id), StaffKeyResponse, {}),
  rekeyCode: (agent: string, reason: string) =>
    request("POST", "/v1/admin/rekey-codes", StaffRekeyResponse, { agent, reason }),
  mergeResident: (from: string, into: string, reason: string, dry: boolean) =>
    request("POST", path("/v1/admin/residents/{id}/merge", from), StaffMergeResponse, {
      into,
      reason,
      dry,
    }),
  confirmBounty: (id: string, to: string) =>
    request("POST", path("/v1/admin/bounties/{id}/confirm", id), StaffBountyResponse, { to }),
  reopenBounty: (id: string, reason: string) =>
    request("POST", path("/v1/admin/bounties/{id}/reopen", id), StaffBountyResponse, { reason }),
  voidBounty: (id: string, reason: string) =>
    request("POST", path("/v1/admin/bounties/{id}/void", id), StaffBountyResponse, { reason }),
  voidEvent: (id: string, reason: string) =>
    request("POST", path("/v1/admin/events/{id}/void", id), StaffEventResponse, { reason }),
  dismiss: (kind: ReportKind, id: string, reason: string) =>
    request("POST", "/v1/admin/reports/dismiss", ModerationResponse, { kind, id, reason }),
};
