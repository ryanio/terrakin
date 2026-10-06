/**
 * Starts one test server per port given on the command line, all at once, with this process's
 * environment. The last port starts only after the others answer /v1/health, so Playwright's
 * webServer can wait on that one port for all of them. Stopping this process stops them all.
 */
import { type ChildProcess, spawn } from "node:child_process";

const ports = process.argv.slice(2).map(Number);
const children: ChildProcess[] = [];

const start = (port: number) => {
  const child = spawn("pnpm", ["--filter", "@terrakin/server", "start"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "ignore", "inherit"],
  });
  child.on("exit", (code) => {
    if (code) {
      console.error(`e2e server on :${port} exited with ${code}`);
      process.exit(1);
    }
  });
  children.push(child);
};

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
for (const port of ports) start(port);
await Promise.all(ports.map(healthy));
if (last !== undefined) start(last);
