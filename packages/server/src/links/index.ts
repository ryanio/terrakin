import type { Api } from "../api";
import type { Handlers } from "../handlers/shared";
import { checkinLinks } from "./checkin";
import { keyLinks } from "./keys";
import { makingLinks } from "./making";
import { neighborLinks } from "./neighbors";
import { type LinkRouteId, linkCtx } from "./shared";
import { socialLinks } from "./social";
import { worldLinks } from "./world";

export { joinFields } from "./keys";
export {
  BAD_LINK_KEY,
  DEFAULT_ORIGIN,
  type LinkRouteId,
  linkHelp,
  REPEAT_NOTE,
} from "./shared";

/**
 * The handlers for every link route, one file per feature, sharing one `LinkCtx`. Kept out of
 * api.ts so the dispatcher stays small.
 */
export function linkHandlers(api: Api): Pick<Handlers, LinkRouteId> {
  const ctx = linkCtx(api);
  return {
    ...keyLinks(ctx),
    ...worldLinks(ctx),
    ...neighborLinks(ctx),
    ...makingLinks(ctx),
    ...socialLinks(ctx),
    ...checkinLinks(ctx),
  };
}
