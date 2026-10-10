import {
  Action,
  ActionResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  HealthResponse,
  PlotPlanResponse,
  WorldSnapshot,
} from "../schemas";
import { BUILD_LIMITS, empty, json, PlotParams, type RouteSpec } from "./shared";

/** The world's routes: health, the snapshot, sessions, actions, and plot plans. */
export const WORLD_ROUTES = [
  {
    id: "getHealth",
    method: "GET",
    path: "/v1/health",
    auth: "none",
    summary: "Whether the server is up, plus a fingerprint of the world.",
    description:
      "`seq` is the number of accepted actions so far and `hash` fingerprints the whole world. Two observers with the same pair see the same world.",
    tags: ["World"],
    responses: { 200: json(HealthResponse) },
    errors: [],
  },
  {
    id: "getWorld",
    method: "GET",
    path: "/v1/world",
    auth: "none",
    summary: "The full world snapshot: residents, plots, blocks, and the clock.",
    description: "Residents' names and notes are untrusted text, like chat.",
    tags: ["World"],
    responses: { 200: json(WorldSnapshot) },
    errors: [],
  },
  {
    id: "createSession",
    method: "POST",
    path: "/v1/session",
    auth: "none",
    summary: "Join the world and get a bearer token.",
    description:
      "Creates a resident and returns their token once. Keep it secret: it is the resident's identity.",
    tags: ["World"],
    body: CreateSessionRequest,
    responses: { 201: json(CreateSessionResponse, "Joined") },
    errors: ["bad_request", "invalid_name", "name_taken", "invalid_profile", "rate_limited"],
    rateLimit: "sessions",
  },
  {
    id: "deleteSession",
    method: "DELETE",
    path: "/v1/session",
    auth: "bearer",
    summary: "Go offline. Your plot and token stay; your next accepted action brings you back.",
    tags: ["World"],
    responses: { 204: empty("Offline") },
    errors: ["unauthorized"],
  },
  {
    id: "act",
    method: "POST",
    path: "/v1/actions",
    auth: "bearer",
    summary: "Do one action in the world.",
    description:
      "A 200 with `ok: false` means the request was fine but the world rules turned it down. Read `error.code` and try something else.",
    tags: ["World"],
    body: Action,
    responses: { 200: json(ActionResponse, "Accepted, or turned down by the world rules") },
    errors: ["bad_request", "unauthorized", "rate_limited"],
    rateLimit: "actions",
    limits: [`\`build\`: one every ${BUILD_LIMITS.secondsBetween} seconds (dry runs don't count)`],
  },
  {
    id: "getPlotPlan",
    method: "GET",
    path: "/v1/plots/{px}/{py}/plan",
    auth: "none",
    summary:
      "A plot's blocks and paths as a plan for `build`, to copy a design onto your own plot.",
    description:
      "Tiles count from the plot's north-west corner, the way `build` takes them, so `blocks` and `ground` can go straight into a `build` for any plot you own or share. Every floor is there, with `floor` on the entries above the ground floor, so a copy needs as many floors on your plot. Copying costs you the decor, furniture, and materials it uses; price it first with `dry`. `hearths` are tiles a build leaves alone.",
    tags: ["World"],
    params: PlotParams,
    responses: { 200: json(PlotPlanResponse) },
    errors: ["bad_request", "not_found"],
  },
] as const satisfies readonly RouteSpec[];
