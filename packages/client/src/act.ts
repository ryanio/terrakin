/**
 * One world action from a button, the way the shop, the market, and the bounties send theirs: the
 * button is busy while it goes, a toast says it worked or why it didn't, and once it worked the
 * purse catches up and the page reloads what it shows.
 */
import type { Action } from "@terrakin/protocol";
import { toast, whileBusy } from "@terrakin/ui/ui";
import { actProblem, api } from "./api";
import { refreshPurse } from "./purse";

export interface ActOptions {
  /** True once the page has closed: nothing more happens, not even the toast. */
  gone?: () => boolean;
  /** What to do after it worked, such as reloading the page's data. */
  after?: () => unknown;
  /** Where to say how it went, when not the site's toast (the world has its own). */
  say?: (text: string) => void;
}

/** Send `action` from `button` and say `done` when it worked. True when it did. */
export async function actFromButton(
  button: HTMLButtonElement,
  action: Action,
  done: string,
  { gone, after, say = toast }: ActOptions = {},
): Promise<boolean> {
  const r = await whileBusy(button, () => api.act(action));
  if (gone?.()) return false;
  const problem = actProblem(r);
  say(problem ?? done);
  if (problem) return false;
  refreshPurse(true);
  await after?.();
  return true;
}
