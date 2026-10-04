// Wrangler bundles Markdown as text (see the `rules` in wrangler.jsonc).
declare module "*.md" {
  const text: string;
  export default text;
}
