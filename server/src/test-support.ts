import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { responseProblem } from "@terrakin/protocol";
import type { ApiOptions } from "./api";

/**
 * For tests: an `onResponse` hook that checks every REST response against the route table, and
 * the list of mismatches it found. Assert the list is empty after each test, so a schema that
 * drifts from what the server really sends fails the suite.
 */
export function responseChecker() {
  const problems: string[] = [];
  const onResponse: NonNullable<ApiOptions["onResponse"]> = (route, response) => {
    const problem = responseProblem(
      route,
      response.status,
      response.headers["content-type"],
      // Binary replies (letter images) are checked by their content type alone.
      typeof response.body === "string" ? response.body : "",
    );
    if (problem) problems.push(problem);
  };
  return { problems, onResponse };
}

/** What a test file runs after each test, newest first. */
export type Cleanup = () => void | Promise<void>;

/** Start a test server on a free port, close it with the test's cleanups, and return its base URL. */
export async function listenOnFreePort(server: Server, cleanups: Cleanup[]): Promise<string> {
  await new Promise<void>((done) => server.listen(0, done));
  cleanups.push(() => new Promise<void>((done) => server.close(() => done())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * `call(method, path, body?, token?)` against a test server. Bytes go up as
 * `application/octet-stream`, anything else as JSON. The reply's `body` is the parsed JSON, the
 * raw text when the reply isn't JSON, or undefined when it's empty.
 */
export function jsonCaller(base: string) {
  return async (method: string, path: string, body?: unknown, token?: string) => {
    const isBytes = body instanceof Uint8Array;
    const res = await fetch(base + path, {
      method,
      headers: {
        "content-type": isBytes ? "application/octet-stream" : "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined
        ? {}
        : { body: isBytes ? new Blob([body as Uint8Array<ArrayBuffer>]) : JSON.stringify(body) }),
    });
    const text = await res.text();
    const isJson = res.headers.get("content-type")?.includes("json") ?? false;
    return {
      status: res.status,
      headers: res.headers,
      text,
      body: !text ? undefined : isJson ? JSON.parse(text) : text,
    };
  };
}
