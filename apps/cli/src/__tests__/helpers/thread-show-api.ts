import { stubServerApi } from "./command-output-harness.js";

export function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function stubThreadShowApi(
  handlers: Parameters<typeof stubServerApi>[0],
): void {
  stubServerApi({
    "v1.threads.:id.execution-profile.$get": async () =>
      jsonResponse(404, { code: "not_found", message: "Not found" }),
    ...handlers,
  });
}
