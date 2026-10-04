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
import { initErrorReporting, pageView, startAnalytics } from "../telemetry";

// One templated page for the whole reference: section anchors never reach analytics.
startAnalytics("/docs");
pageView("/docs");
void initErrorReporting();

const root = document.getElementById("reference");
void import("./reference").then(({ mountReference }) => {
  if (root) mountReference(root);
});
