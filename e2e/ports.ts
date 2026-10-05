/**
 * Ports for the e2e server and the fakes it talks to. Set TERRAKIN_E2E_PORT to run a second
 * suite at once (from another worktree, say); the fakes take the next two ports.
 */
export const E2E_PORT = Number(process.env.TERRAKIN_E2E_PORT ?? 8790);
export const FAKE_X_PORT = E2E_PORT + 1;
export const FAKE_CHAIN_PORT = E2E_PORT + 2;
