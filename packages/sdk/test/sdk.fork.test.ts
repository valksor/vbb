import { describe, expect, it } from "vitest";
import type { JsonValue } from "@bb/domain";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";
import type { FetchImplementation } from "../src/response.js";

interface CapturedRequest {
  bodyText: string | undefined;
  method: string;
  url: string;
}

interface QueuedJsonResponse {
  body: JsonValue;
  status?: number;
}

interface FetchQueue {
  fetch: FetchImplementation;
  requests: CapturedRequest[];
}

function bodyText(init: RequestInit | undefined): string | undefined {
  return typeof init?.body === "string" ? init.body : undefined;
}

function jsonResponse(args: QueuedJsonResponse): Response {
  const status = args.status ?? 200;
  if (status === 204) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(args.body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFetchQueue(
  responses: readonly QueuedJsonResponse[],
): FetchQueue {
  const requests: CapturedRequest[] = [];
  const remaining = [...responses];
  const fetchMock: FetchImplementation = async (input, init) => {
    requests.push({
      bodyText: bodyText(init),
      method: init?.method ?? "GET",
      url: String(input),
    });
    const next = remaining.shift();
    if (!next) {
      throw new Error("No queued SDK test response");
    }
    return jsonResponse(next);
  };
  return { fetch: fetchMock, requests };
}

describe("@bb/sdk", () => {
  it("preserves checkout branch promotion on spawn and fork", async () => {
    const queue = createFetchQueue([
      { body: { id: "thr_1" } },
      { body: { id: "thr_2" } },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });
    const environment = {
      type: "project-default",
      promotion: "branch",
    } as const;
    await sdk.threads.spawn({
      projectId: "proj_1",
      environment,
      prompt: "Ship it",
    });
    await sdk.threads.fork({ sourceThreadId: "thr_1", environment });
    expect(
      queue.requests.map(
        (request) => JSON.parse(request.bodyText ?? "{}").environment,
      ),
    ).toEqual([environment, environment]);
  });

  it("inspects branch promotion and resolves using the exact observation", async () => {
    const result = {
      operationId: "op_1",
      phase: "reconciling",
      snapshot: { observation: "host-token" },
    };
    const queue = createFetchQueue([
      { body: result },
      { body: null },
      { body: result },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });
    await expect(
      sdk.threads.inspectBranchPromotion({ threadId: "thr_1" }),
    ).resolves.toEqual(result);
    await expect(
      sdk.threads.inspectBranchPromotion({ threadId: "thr_2" }),
    ).resolves.toBeNull();
    await expect(
      sdk.threads.resolveBranchPromotion({
        threadId: "thr_1",
        operationId: "op_1",
        observation: "host-token",
        resolution: "keep-current",
      }),
    ).resolves.toEqual(result);
    expect(queue.requests[0]).toEqual({
      method: "GET",
      url: "http://bb.test/api/v1/threads/thr_1/branch-promotion",
      bodyText: undefined,
    });
    expect(queue.requests[2]).toEqual({
      method: "POST",
      url: "http://bb.test/api/v1/threads/thr_1/branch-promotion/resolve",
      bodyText: JSON.stringify({
        operationId: "op_1",
        observation: "host-token",
        resolution: "keep-current",
      }),
    });
  });
});
