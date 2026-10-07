/**
 * The one script the docs pages load (decision 0211): each line marked `data-copy` becomes the
 * shared copy block, with its Copy button. Without it the line still shows and can be selected.
 */
import { copyBlock } from "@terrakin/ui/copy";

for (const line of document.querySelectorAll<HTMLElement>("[data-copy]")) {
  line.replaceWith(copyBlock(line.dataset.copy ?? "", line.textContent ?? ""));
}
