/**
 * The workspace packages import each other without file extensions, which bundlers and tsx accept
 * and Node does not. Retry an extensionless relative import as a `.ts` file.
 *
 * A script that reaches a package through a plain `import` loads this with `node --import`, since
 * Node resolves a script's whole import graph before it runs a line of it, so a hook the script
 * registers itself would come too late. `gen.ts`, `economy-sim.ts`, `replay-bench.ts`, and
 * `replay-check.ts` register the same hook and then `await import(...)`, which is in time.
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!/^\.\.?\//.test(specifier) || /\.[cm]?[jt]s$/.test(specifier)) throw err;
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        return nextResolve(`${specifier}/index.ts`, context);
      }
    }
  },
});
