import { DurableObject } from "cloudflare:workers";
import { buildOpenApi, MEDIA_TYPES, type MediaType } from "@terrakin/protocol";
import SKILL_MD from "@terrakin/protocol/SKILL.md";
import { Api, MAX_BODY_BYTES } from "../src/api";
import { MEDIA_ID, type MediaStore, mediaHeaders } from "../src/media";
import { SocialService } from "../src/social-service";
import { SqlStore } from "../src/sql-store";
import { WorldService } from "../src/world-service";

/**
 * Cloudflare adapter. The Worker serves the built client from static assets and forwards `/v1/*`
 * to one Durable Object, which holds the single authoritative world (decision 0005) and keeps its
 * log in the object's SQLite storage. The routes and the live protocol are the same `Api` the
 * Node server uses.
 */

interface Env {
  WORLD: DurableObjectNamespace<World>;
  ASSETS: Fetcher;
  /** Uploaded images, videos, and models (RFC 0003). */
  MEDIA: R2Bucket;
}

const OPENAPI = JSON.stringify(buildOpenApi());
const CANONICAL_HOST = "terrakin.org";

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
      return serveMedia(env.MEDIA, mediaId, request);
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
    const url = new URL(request.url);
    // Set by Cloudflare's edge and not spoofable by the client, unlike X-Forwarded-For.
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";

    if (url.pathname === "/v1/live") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket upgrade.", { status: 426 });
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

    const response = await this.api.handle({
      method: request.method,
      pathname: url.pathname,
      ip,
      authorization: request.headers.get("authorization") ?? undefined,
      query: url.searchParams,
      readJson: () => readJson(request),
      readBytes: (max) => readBytes(request, max),
    });
    if (!response) return new Response("Not found.", { status: 404 });
    return new Response(response.status === 204 ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
}

async function readBytes(request: Request, maxBytes: number): Promise<Uint8Array | undefined> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return undefined;
  const bytes = new Uint8Array(await request.arrayBuffer());
  return bytes.length > maxBytes ? undefined : bytes;
}

/** Serve an upload straight from R2, with byte ranges so phones can stream video. */
async function serveMedia(bucket: R2Bucket, id: string, request: Request): Promise<Response> {
  if (!MEDIA_ID.test(id)) return new Response("Not found.", { status: 404 });
  const object = await bucket.get(id, { range: request.headers, onlyIf: request.headers });
  if (!object) return new Response("Not found.", { status: 404 });
  const type = object.httpMetadata?.contentType;
  // Only types we wrote ourselves after checking the bytes.
  if (!type || !(type in MEDIA_TYPES)) return new Response("Not found.", { status: 404 });
  const headers = new Headers(mediaHeaders(type as MediaType));
  headers.set("accept-ranges", "bytes");
  headers.set("etag", object.httpEtag);
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  const range = object.range as { offset?: number; length?: number } | undefined;
  if (request.headers.has("range") && range) {
    const offset = range.offset ?? 0;
    const length = range.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(request.method === "HEAD" ? null : object.body, { status: 206, headers });
  }
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return undefined;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
