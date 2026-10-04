import { DurableObject } from "cloudflare:workers";
import { buildOpenApi } from "@terrakin/protocol";
import SKILL_MD from "@terrakin/protocol/SKILL.md";
import { Api, MAX_BODY_BYTES } from "../src/api";
import { type MediaBucket, type MediaStore, readCapped, serveFromBucket } from "../src/media";
import { SocialService } from "../src/social-service";
import { SqlStore } from "../src/sql-store";
import { WorldService } from "../src/world-service";

/**
 * Cloudflare adapter. The Worker serves the built client from static assets, serves uploads
 * straight from R2, and forwards `/v1/*` to one Durable Object, which holds the single
 * authoritative world (decision 0005) and keeps its log and social tables in the object's SQLite
 * storage. The routes and the live protocol are the same `Api` the Node server uses.
 */

interface Env {
  WORLD: DurableObjectNamespace<World>;
  ASSETS: Fetcher;
  /** Uploaded images, videos, and models (RFC 0003). */
  MEDIA: R2Bucket;
}

const OPENAPI = JSON.stringify(buildOpenApi());
const CANONICAL_HOST = "terrakin.org";

const jsonError = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === `www.${CANONICAL_HOST}`) {
      url.hostname = CANONICAL_HOST;
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname.startsWith("/v1/")) {
      return env.WORLD.get(env.WORLD.idFromName("world")).fetch(request);
    }
    const mediaId = /^\/media\/([^/]+)$/.exec(url.pathname)?.[1];
    if (mediaId !== undefined && (request.method === "GET" || request.method === "HEAD")) {
      return serveFromBucket(env.MEDIA as unknown as MediaBucket, mediaId, request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class World extends DurableObject<Env> {
  private readonly api: Api;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const service = new WorldService({ store: new SqlStore(ctx.storage.sql) });
    const media: MediaStore = {
      put: async (id, bytes, type) => {
        await env.MEDIA.put(id, bytes, { httpMetadata: { contentType: type } });
      },
      delete: (id) => env.MEDIA.delete(id),
    };
    const social = new SocialService({
      sql: ctx.storage.sql,
      media,
      resident: (id) => service.state.residents[id],
    });
    this.api = new Api({ service, social, skill: SKILL_MD, openapi: OPENAPI });
    // Runs while the object is in memory. If it's evicted, nobody is connected, and the next
    // boot marks everyone offline anyway.
    setInterval(() => this.api.sweep(), 60_000);
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      return await this.route(request);
    } catch (err) {
      // Same contract as the Node server: errors are always JSON, never Cloudflare's HTML page.
      console.error(err);
      return jsonError(500, "internal", "Something broke on our side.");
    }
  }

  private async route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Set by Cloudflare's edge and not spoofable by the client, unlike X-Forwarded-For.
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";

    if (url.pathname === "/v1/live") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return jsonError(426, "bad_request", "Connect to /v1/live with a WebSocket.");
      }
      const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
      server.accept();
      const session = this.api.live(ip, {
        send: (text) => {
          try {
            server.send(text);
          } catch {
            // Already closed; the close handler cleans up.
          }
        },
        close: (code, reason) => {
          try {
            server.close(code, reason);
          } catch {
            // Already closed.
          }
        },
      });
      server.addEventListener("message", (event) => {
        session.onMessage(
          typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data),
        );
      });
      server.addEventListener("close", () => session.onClose());
      server.addEventListener("error", () => session.onClose());
      return new Response(null, { status: 101, webSocket: client });
    }

    const length = request.headers.get("content-length");
    const response = await this.api.handle({
      method: request.method,
      pathname: url.pathname,
      ip,
      authorization: request.headers.get("authorization") ?? undefined,
      query: url.searchParams,
      readJson: () => readJson(request),
      readBytes: (max) => readCapped(request.body, max),
      contentLength: length === null ? undefined : Number(length),
    });
    if (!response) return jsonError(404, "not_found", "Not found.");
    return new Response(response.status === 204 ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
}

async function readJson(request: Request): Promise<unknown> {
  const bytes = await readCapped(request.body, MAX_BODY_BYTES);
  if (!bytes) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}
