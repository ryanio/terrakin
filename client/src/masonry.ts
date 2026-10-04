/**
 * Masonry for the home wall. The list is a CSS grid with columns from `auto-fill`; when it has more
 * than one column we switch it to short rows (the `.masonry` class) and give each card a row span
 * from its measured height, so cards of different sizes pack without ragged gaps. One column needs
 * none of this, so a phone gets plain flow and no observers doing work.
 */

/** Row height in `.post-list.masonry`; keep in step with style.css. */
const ROW = 8;

export function masonry(list: HTMLElement): { destroy(): void } {
  let multi = false;
  let gap = 14;
  const dirty = new Set<HTMLElement>();
  let frame = 0;

  const flush = () => {
    frame = 0;
    if (!multi) return;
    // Read every height first, then write every span, so the browser lays out once.
    const spans = [...dirty].map(
      (el) => [el, Math.ceil((el.getBoundingClientRect().height + gap) / ROW)] as const,
    );
    dirty.clear();
    for (const [el, span] of spans) {
      if (el.parentElement === list) el.style.gridRowEnd = `span ${Math.max(1, span)}`;
    }
  };
  const mark = (el: Element) => {
    if (!(el instanceof HTMLElement)) return;
    dirty.add(el);
    if (!frame) frame = requestAnimationFrame(flush);
  };

  const cards = new ResizeObserver((entries) => {
    for (const e of entries) mark(e.target);
  });

  const columns = () =>
    getComputedStyle(list)
      .gridTemplateColumns.split(" ")
      .filter((t) => t && t !== "none").length;

  const relayout = () => {
    const next = columns() > 1;
    gap = Number.parseFloat(getComputedStyle(list).columnGap) || 14;
    if (next !== multi) {
      multi = next;
      list.classList.toggle("masonry", multi);
      if (!multi) for (const el of list.children) (el as HTMLElement).style.gridRowEnd = "";
    }
    if (multi) for (const el of list.children) mark(el);
  };

  const shell = new ResizeObserver(relayout);
  shell.observe(list);

  const watch = (el: Node) => {
    if (el instanceof HTMLElement) cards.observe(el);
  };
  for (const el of list.children) watch(el);
  const children = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.removedNodes) if (n instanceof HTMLElement) cards.unobserve(n);
      for (const n of r.addedNodes) watch(n);
    }
  });
  children.observe(list, { childList: true });

  return {
    destroy() {
      cancelAnimationFrame(frame);
      shell.disconnect();
      cards.disconnect();
      children.disconnect();
    },
  };
}
