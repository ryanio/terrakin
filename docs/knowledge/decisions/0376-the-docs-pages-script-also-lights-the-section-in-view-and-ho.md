---
title: The docs pages' script also lights the section in view, and How to play does it with CSS
date: 2026-10-26
status: accepted
tags: [client, docs, site]
---

# The docs pages' script also lights the section in view, and How to play does it with CSS

## Context

How to play and the docs pages are long, and a reader wants to jump to a part and know where they are. Both now keep an "On this page" on screen: a card pinned in the sidebar from 1000px, and under the site bar on a phone. Lighting the section in view needs to know where the reader has scrolled.

The static pages load no script and their policy forbids one (`STATIC_PAGE_POLICY`). The docs pages load exactly one, `src/docs-copy.ts`, for copy buttons ([decision 0211](0211-the-docs-pages-load-one-small-script-of-their-own-for-copy-b.md)). CSS scroll-driven animations can light a link with no script, but every section needs a named timeline written into the stylesheet, and the docs pages run from 2 sections to 41, with Models at 25 letters.

## Decision

How to play lights its section with CSS alone: each card is a view timeline named by its place, and the stylesheet has room for 16 (`.guide-links` in `style.css`, held by `site-page.test.ts`). The docs pages' one script also runs `watchSections` (`src/docs-sections.ts`), which marks the link for the section in view `aria-current`, keeps it in sight in the pinned card, names it in the phone's menu, and closes that menu on a tap. Every docs page loads the script, the skill file's page included, and so does What's new (`/changelog`), whose days already pass 16 and grow by one a day.

## Consequences

- Without the script or the CSS feature the links still work; only the lit link is lost.
- How to play past 16 sections needs more timeline rules in `style.css`; the test fails first.
- The docs script is still one file bundled on its own (`docsCopyScript` in `vite.config.ts`), so the app's first load is unchanged.
- What's new runs under the docs pages' policy, which allows that one script.
- A docs page's body is a card per `##` section (`docsCards` in `src/site-page.ts`), Models a card per letter, and the pinned card takes the place of Step inside and the devlog's posts in the docs' sidebar.
