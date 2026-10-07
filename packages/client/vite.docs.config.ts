import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import app from "./vite.config.ts";

/**
 * Lists the reference's chunks and stylesheet in docs.html, so the browser fetches them alongside
 * the entry script instead of after it runs. main.ts still loads them with `import()`, which keeps
 * the bar painting first and the "didn't load" way out if they fail.
 */
function preloadReference(): Plugin {
  return {
    name: "terrakin-docs-preload",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return;
        const reference = Object.values(bundle).find(
          (c) => c.type === "chunk" && c.facadeModuleId?.endsWith("/src/docs/reference.ts"),
        );
        if (reference?.type !== "chunk")
          throw new Error("terrakin-docs-preload: no reference chunk");
        const scripts = new Set<string>();
        const styles = new Set<string>();
        const visit = (fileName: string) => {
          const chunk = bundle[fileName];
          // The entry and what it imports are in the page already.
          if (chunk?.type !== "chunk" || chunk.isEntry || scripts.has(fileName)) return;
          scripts.add(fileName);
          for (const css of chunk.viteMetadata?.importedCss ?? []) styles.add(css);
          for (const next of chunk.imports) visit(next);
        };
        visit(reference.fileName);
        return [
          ...[...styles].map((href) => ({
            tag: "link",
            attrs: { rel: "preload", as: "style", href: `/${href}` },
            injectTo: "head" as const,
          })),
          ...[...scripts].map((href) => ({
            tag: "link",
            attrs: { rel: "modulepreload", crossorigin: true, href: `/${href}` },
            injectTo: "head" as const,
          })),
        ];
      },
    },
  };
}

/**
 * The /docs page (docs.html), built on its own after the app and into the same dist. A separate
 * build, not a second entry, so the app's chunks never share modules with Scalar: a shared chunk
 * would make every visitor download the parts of zod and Vue the docs need. Same plugins (and so
 * the same Content-Security-Policy). `vite dev` serves docs.html at /docs from the app config.
 */
export default mergeConfig(
  app,
  defineConfig({
    publicDir: false,
    plugins: [preloadReference()],
    build: {
      emptyOutDir: false,
      // Scalar (Vue, the API client, markdown and code highlighting) is about 1 MB gzipped. Only
      // /docs loads it.
      chunkSizeWarningLimit: 2000,
      rolldownOptions: {
        input: { docs: fileURLToPath(new URL("./docs.html", import.meta.url)) },
      },
    },
  }),
);
