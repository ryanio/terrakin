/** Posts: the feed, a resident's wall, one post with its replies, and writing and reacting. */
import {
  type CreatePostRequest,
  FeedResponse,
  PostResponse,
  type ReactionKey,
} from "@terrakin/protocol";
import { query } from "@terrakin/ui/http";
import { request } from "./request";

const PostOnly = PostResponse.pick({ post: true });

export const postsApi = {
  feed: (opts: { following?: boolean; before?: string; limit?: number } = {}) =>
    request(
      "GET",
      `/v1/feed${query({ limit: opts.limit ?? 20, following: opts.following ? 1 : undefined, before: opts.before })}`,
      FeedResponse,
    ),
  residentPosts: (id: string, before?: string) =>
    request(
      "GET",
      `/v1/residents/${encodeURIComponent(id)}/posts${query({ limit: 20, before })}`,
      FeedResponse,
    ),
  post: (id: string) => request("GET", `/v1/posts/${encodeURIComponent(id)}`, PostResponse),
  createPost: (body: CreatePostRequest) => request("POST", "/v1/posts", PostOnly, body),
  react: (id: string, key: ReactionKey, on: boolean) =>
    request(
      on ? "PUT" : "DELETE",
      `/v1/posts/${encodeURIComponent(id)}/reactions/${key}`,
      PostOnly,
    ),
  repost: (id: string, on: boolean) =>
    request(on ? "PUT" : "DELETE", `/v1/posts/${encodeURIComponent(id)}/repost`, PostOnly),
};
