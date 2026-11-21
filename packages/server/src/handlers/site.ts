import {
  type AreaRouteIds,
  absolute,
  LINKS,
  type PostView,
  type ProfileView,
  SITEMAP_MAX_URLS,
} from "@terrakin/protocol";
import { w3cDate } from "workers-start/format";
import { sitemapIndexXml, sitemapXml } from "workers-start/seo";
import type { Api } from "../api";
import type { LinkRouteId } from "../links";
import { postMarkdown, profileMarkdown } from "../markdown";
import { fail, type Handlers } from "./shared";

/**
 * The handlers for Markdown twins of profiles and posts, and the sitemaps (decision 0023). The link
 * routes beside them in the table are in `links/`. Their routes are in the protocol's
 * `route-table/links.ts`.
 */
export function siteHandlers(
  api: Api,
): Pick<Handlers, Exclude<AreaRouteIds["links"], LinkRouteId>> {
  const social = () => api.requireSocial();
  /** One page (from 1) of profile or post URLs. Page 1 always exists, even when empty. */
  const sitemap = (kind: "residents" | "posts", page: number) => {
    const entries = social().sitemapEntries(kind, page - 1, SITEMAP_MAX_URLS);
    if (entries.length === 0 && page > 1) return fail("not_found", "No such sitemap page.");
    const prefix = kind === "residents" ? "/r/" : "/p/";
    return {
      status: 200 as const,
      text: sitemapXml(
        entries.map(({ id, lastmod }) => ({
          url: absolute(`${prefix}${id}`),
          lastModified: w3cDate(lastmod),
        })),
      ),
    };
  };
  return {
    // The twins call the JSON routes' own handlers, so they can't disagree with the API.
    getResidentMarkdown: async (input) => {
      const anonymous = { ...input, query: undefined, body: undefined, viewer: undefined };
      const profile = await api.handlers.getResident(anonymous);
      if ("error" in profile) return profile;
      const posts = await api.handlers.getResidentPosts({
        ...anonymous,
        query: { limit: undefined, before: undefined },
      });
      if ("error" in posts) return posts;
      return {
        status: 200,
        text: profileMarkdown(profile.body.resident as ProfileView, posts.body.posts as PostView[]),
      };
    },
    getPostMarkdown: async (input) => {
      const found = await api.handlers.getPost({
        ...input,
        query: undefined,
        body: undefined,
        viewer: undefined,
      });
      if ("error" in found) return found;
      return {
        status: 200,
        text: postMarkdown(found.body.post as PostView, found.body.replies as PostView[]),
      };
    },
    getSitemapIndex: () => {
      const pages = (kind: "residents" | "posts") =>
        social()
          .sitemapPages(kind, SITEMAP_MAX_URLS)
          .map(({ lastmod }, i) => ({
            url: absolute(`/sitemap-${kind}-${i + 1}.xml`),
            lastModified: w3cDate(lastmod),
          }));
      return {
        status: 200,
        text: sitemapIndexXml([
          { url: absolute(LINKS.sitemapPages) },
          ...pages("residents"),
          ...pages("posts"),
        ]),
      };
    },
    getResidentSitemap: ({ params }) => sitemap("residents", params.page),
    getPostSitemap: ({ params }) => sitemap("posts", params.page),
  };
}
