/**
 * Which section of a docs page is in view, for its "On this page" (site-page.ts `docsView`): the
 * sidebar's link and the phone menu's are marked `aria-current`, the sidebar's list keeps that link
 * in sight, the phone menu names the section, and a tap on one of its links closes it. Without
 * this the links still go where they say; only the marking is lost.
 */

/**
 * The section a reader is in: the last whose top has reached `line`, a third of the way down the
 * screen, or -1 while none has (the page's title and contents are still in view).
 */
export function sectionAt(tops: readonly number[], line: number): number {
  let at = -1;
  tops.forEach((top, i) => {
    if (top <= line) at = i;
  });
  return at;
}

export function watchSections(): void {
  const cards = [...document.querySelectorAll<HTMLElement>("[data-section]")];
  if (cards.length === 0) return;
  const links = [...document.querySelectorAll<HTMLAnchorElement>(".docs-onpage-list a")];
  const side = document.querySelector<HTMLElement>(".docs-onpage");
  const here = document.querySelector<HTMLElement>("[data-here]");
  const menu = document.querySelector<HTMLDetailsElement>(".docs-jump");
  let shown = -1;
  let queued = false;

  const update = () => {
    queued = false;
    const at = sectionAt(
      cards.map((card) => card.getBoundingClientRect().top),
      window.innerHeight / 3,
    );
    if (at === shown) return;
    shown = at;
    const href = at < 0 ? "" : `#${cards[at]?.dataset.section ?? ""}`;
    for (const link of links) {
      if (link.getAttribute("href") === href) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
    const lit = side?.querySelector<HTMLElement>("[aria-current]");
    if (side && lit) {
      const box = side.getBoundingClientRect();
      const row = lit.getBoundingClientRect();
      if (row.top < box.top || row.bottom > box.bottom) {
        side.scrollTop += row.top - box.top - box.height / 2;
      }
    }
    if (here) here.textContent = lit?.dataset.name ?? lit?.textContent ?? "";
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  addEventListener("scroll", queue, { passive: true });
  addEventListener("resize", queue);
  menu?.addEventListener("click", (event) => {
    if ((event.target as Element).closest("a")) menu.open = false;
  });
  update();
}
