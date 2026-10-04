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
