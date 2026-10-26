/**
 * The one script the docs pages load (decision 0211): each line marked `data-copy` becomes the
 * shared copy block, with its Copy button, and the "On this page" follows the section in view
 * (`docs-sections.ts`). Without it the lines still show and can be selected, and the links work.
 */
import { copyBlock } from "@terrakin/ui/copy";
import { watchSections } from "./docs-sections";

for (const line of document.querySelectorAll<HTMLElement>("[data-copy]")) {
  line.replaceWith(copyBlock(line.dataset.copy ?? "", line.textContent ?? ""));
}

watchSections();
