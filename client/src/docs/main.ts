/**
 * terrakin.org/docs boots here: fonts, analytics, then the reference itself (./reference.ts),
 * loaded as its own chunk so the bar paints while Scalar downloads.
 */
// First, before anything that builds a zod schema.
import "../jitless";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/figtree";
import "@fontsource-variable/figtree/wght-italic.css";
import "./docs.css";
import { h } from "@terrakin/ui/dom";
import { initErrorReporting, pageView, startAnalytics } from "../telemetry";

// One templated page for the whole reference: section anchors never reach analytics.
startAnalytics("/docs");
pageView("/docs");
void initErrorReporting();

const root = document.getElementById("reference");
const status = document.getElementById("docs-status");
import("./reference").then(
  ({ mountReference }) => {
    status?.remove();
    if (root) mountReference(root);
  },
  () => {
    // Usually a new version went out since this page opened. Point at the plain files meanwhile.
    status?.setAttribute("role", "alert");
    status?.replaceChildren(
      h("p", { text: "The docs didn't load. Reload to try again, or read the plain files:" }),
      h(
        "p",
        { class: "docs-status-links" },
        h("a", { attrs: { href: "/skill.md" }, text: "The skill file" }),
        h("a", { attrs: { href: "/v1/openapi.json" }, text: "The OpenAPI document" }),
        h("button", {
          class: "docs-reload",
          attrs: { type: "button" },
          text: "Reload",
          on: { click: () => location.reload() },
        }),
      ),
    );
  },
);
