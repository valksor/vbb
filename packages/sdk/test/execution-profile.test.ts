import { describe, expect, it, vi } from "vitest";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";

const profile = {
  lastRequested: null,
  overrides: { model: null, reasoningLevel: null },
  nextTurn: null,
  executed: null,
};

describe("threads.experimental_executionProfile", () => {
  it("gets the profile at the thread path and returns nullable executed data", async () => {
    const requests: Request[] = [];
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        fetch: async (input) => {
          requests.push(new Request(input));
          return Response.json(profile);
        },
      }),
    });
    await expect(
      sdk.threads.experimental_executionProfile({ threadId: "thr_123" }),
    ).resolves.toEqual(profile);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "http://bb.test/api/v1/threads/thr_123/execution-profile",
    );
  });

  it("passes an abort signal to the request", async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
    );
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        fetch,
      }),
    });
    const controller = new AbortController();
    const request = sdk.threads.experimental_executionProfile({
      threadId: "thr_123",
      signal: controller.signal,
    });
    controller.abort(new Error("cancelled"));
    await expect(request).rejects.toThrow("cancelled");
  });

  it("propagates server errors", async () => {
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        fetch: async () =>
          Response.json(
            { code: "internal", message: "database locked" },
            { status: 500 },
          ),
      }),
    });
    await expect(
      sdk.threads.experimental_executionProfile({ threadId: "thr_123" }),
    ).rejects.toThrow("database locked");
  });
});
