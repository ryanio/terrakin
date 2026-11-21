/** Times on the page: "3m ago", "2d ago", with the full date on hover. */
import { h } from "./dom";
import { agoWords, fullDate } from "./format";

/**
 * A `<time>` that says how long ago `iso` was (`agoWords`, in the reader's zone) and shows the
 * full date on hover. `refreshTimes` keeps it current. With `full`, it shows the full date and
 * stays as it is.
 */
export function timeAgo(
  iso: string,
  options: { className?: string | undefined; full?: boolean | undefined } = {},
) {
  return h("time", {
    class: options.className,
    attrs: { datetime: iso, title: fullDate(iso), "data-rel": options.full ? null : iso },
    text: options.full ? fullDate(iso) : agoWords(iso),
  });
}

/** Bring every `timeAgo` under `root` up to date, for example after a poll. */
export function refreshTimes(root: ParentNode = document) {
  const now = Date.now();
  for (const t of root.querySelectorAll<HTMLTimeElement>("time[data-rel]")) {
    const iso = t.dataset.rel;
    if (iso) t.textContent = agoWords(iso, now);
  }
}
