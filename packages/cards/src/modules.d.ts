// Module shapes Wrangler's bundler produces (see the `rules` in wrangler.jsonc): a `.wasm` import
// is a compiled WebAssembly.Module and a `.woff` import is an ArrayBuffer.
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
declare module "*.woff" {
  const data: ArrayBuffer;
  export default data;
}
