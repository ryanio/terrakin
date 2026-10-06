import {
  type AreaRouteIds,
  CHANGELOG_ENTRIES,
  changelogResponse,
  DEVLOG_POSTS,
  devlogResponse,
} from "@terrakin/protocol";
import type { Api } from "../api";
import { fail, type Handlers } from "./shared";

/**
 * The handlers for the docs: SKILL.md, the OpenAPI document, the changelog, and the devlog. Their
 * routes are in the protocol's `route-table/docs.ts`.
 */
export function docsHandlers(api: Api): Pick<Handlers, AreaRouteIds["docs"]> {
  return {
    getSkill: () => ({ status: 200, text: api.skill }),
    getOpenApi: () => ({ status: 200, text: api.openapi }),
    // Built into the bundle by `pnpm gen` from CHANGELOG.md, so no file is read at run time.
    getChangelog: ({ query }) => ({
      status: 200,
      body: changelogResponse(CHANGELOG_ENTRIES, query),
    }),
    // The devlog's posts, built into the bundle by `pnpm gen` from docs/devlog (decision 0105).
    getDevlog: ({ query }) => ({ status: 200, body: devlogResponse(DEVLOG_POSTS, query) }),
    getDevlogPost: ({ params }) => {
      const post = DEVLOG_POSTS.find((p) => p.date === params.date);
      if (!post) {
        return fail("not_found", "There's no devlog post on that day. GET /v1/devlog lists them.");
      }
      return { status: 200, body: { post } };
    },
  };
}
