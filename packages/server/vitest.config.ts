import { defineProject } from "vitest/config";

// Test files share a worker's module cache, which about halves the run. A test that swaps a
// module (`vi.mock`) or leaves global state behind would leak into the next file, so none may.
export default defineProject({ test: { name: "server", isolate: false } });
