/**
 * Builds the client and starts one test server per port given on the command line, with this
 * process's environment. The servers read the client's files per request, so all but the last start
 * while the build runs; the last port starts once the build is done and the others answer
 * /v1/health, so Playwright's webServer can wait on that one port for everything. Stopping this
 * process stops them all.
 */
import { type ChildProcess, spawn } from "node:child_process";

const ports = process.argv.slice(2).map(Number);
const children: ChildProcess[] = [];

/** Run `pnpm <args>` with this environment, failing the whole run if it exits with an error. */
const run = (args: string[], env: NodeJS.ProcessEnv, what: string) => {
  const child = spawn("pnpm", args, { env, stdio: ["ignore", "ignore", "inherit"] });
  const done = new Promise<void>((resolve) => {
    child.on("exit", (code) => {
      if (code) {
        console.error(`${what} exited with ${code}`);
        process.exit(1);
      }
      resolve();
    });
  });
  children.push(child);
  return done;
};

const start = (port: number) =>
  void run(
    ["--filter", "@terrakin/server", "start"],
    { ...process.env, PORT: String(port) },
    `e2e server on :${port}`,
  );

const healthy = async (port: number) => {
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/v1/health`)).ok) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`e2e server on :${port} didn't answer in 60s`);
};

const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

const last = ports.pop();
const build = run(["build"], process.env, "pnpm build");
for (const port of ports) start(port);
await Promise.all([build, ...ports.map(healthy)]);
if (last !== undefined) start(last);
