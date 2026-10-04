/**
 * The API reference and guides, rendered by Scalar from what `pnpm gen` produces. The OpenAPI
 * snapshot is the document /v1/openapi.json serves (gen:check keeps them equal), and the guides
 * become its description, so they share one sidebar and one search. Nothing here is written by
 * hand (decision 0021).
 */
import "@scalar/api-reference/style.css";
import { createApiReference } from "@scalar/api-reference";
import openapi from "@terrakin/protocol/openapi.json";
import guides from "./guides.generated.md?raw";

export function mountReference(root: HTMLElement) {
  createApiReference(root, {
    content: { ...openapi, info: { ...openapi.info, description: guides } },
    // Our own look through Scalar's CSS variables (docs.css); no preset, no fonts from its CDN.
    theme: "none",
    withDefaultFonts: false,
    forceDarkModeState: "light",
    hideDarkModeToggle: true,
    // Nothing leaves for third parties: no telemetry, no hosted agent or MCP, no request proxy.
    // "Try it" calls our own origin directly, which the page's CSP allows.
    telemetry: false,
    agent: { disabled: true },
    mcp: { disabled: true },
    showDeveloperTools: "never",
    // The bar links the real /v1/openapi.json; a download here would carry the guides too.
    documentDownloadType: "none",
    persistAuth: false,
    // Its "Open API Client" button links out to client.scalar.com; "Test Request" works in place.
    hideClientButton: true,
    defaultHttpClient: { targetKey: "shell", clientKey: "curl" },
    setPageTitle: ({ title }) => (title ? `${title} · Terrakin docs` : "Terrakin docs"),
  });
}
