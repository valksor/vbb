import { describe, expect, it } from "vitest";
import { defaultAppSettings, type JsonValue } from "@bb/domain";
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
  it("routes spend rollup filters and backfill through HTTP with nullable cost and abort forwarding", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | null | undefined;
    const queue = createFetchQueue([
      { body: { rows: [{ day: "*", threadId: "*", providerId: "codex", model: "*", inputTokens: 1, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 1, weightedUnits: 1, turns: 1, firstEventAt: 1, lastEventAt: 1, costUsd: null }], coverage: { threads: 1, historyComplete: 1, historyPartial: 0 } } },
      { body: { threadsScanned: 1, usageEventsScanned: 1, contributionsApplied: 1, threadsHistoryComplete: 1, threadsHistoryPartial: 0 } },
    ]);
    const sdk = createBbSdk({ transport: createHttpTransport({ baseUrl: "http://bb.test", fetch: async (input, init) => { receivedSignal = init?.signal; return queue.fetch(input, init); }, runtime: "node" }) });
    await expect(sdk.spend.rollup({ from: "2026-01-01", to: "2026-01-02", groupBy: "provider", providerId: "codex", threadId: "thr_1", signal: controller.signal })).resolves.toMatchObject({ rows: [{ costUsd: null }] });
    await sdk.spend.backfill({ signal: controller.signal });
    expect(receivedSignal).toBe(controller.signal);
    expect(queue.requests.map((request) => [request.method, request.url])).toEqual([
      ["GET", "http://bb.test/api/v1/spend/rollup?from=2026-01-01&to=2026-01-02&groupBy=provider&threadId=thr_1&providerId=codex"],
      ["POST", "http://bb.test/api/v1/spend/backfill"],
    ]);
  });

  it("round-trips ordered quick replies through the UI preferences transport", async () => {
    const quickReplies = ["continue", "run the tests\nthen report", "continue"];
    const queue = createFetchQueue([
      {
        body: {
          preferences: {
            "composer.quickReplies": { value: [], revision: 4 },
          },
        },
      },
      {
        body: {
          key: "composer.quickReplies",
          value: quickReplies,
          revision: 5,
        },
      },
      {
        body: {
          key: "composer.quickReplies",
          value: [],
          revision: 6,
        },
      },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(sdk.system.uiPreferences.list()).resolves.toEqual({
      preferences: {
        "composer.quickReplies": { value: [], revision: 4 },
      },
    });
    await expect(
      sdk.system.uiPreferences.set({
        expectedRevision: 4,
        key: "composer.quickReplies",
        value: quickReplies,
      }),
    ).resolves.toEqual({
      key: "composer.quickReplies",
      value: quickReplies,
      revision: 5,
    });
    await expect(
      sdk.system.uiPreferences.reset({ key: "composer.quickReplies" }),
    ).resolves.toEqual({
      key: "composer.quickReplies",
      value: [],
      revision: 6,
    });

    expect(queue.requests).toEqual([
      {
        bodyText: undefined,
        method: "GET",
        url: "http://bb.test/api/v1/preferences/ui",
      },
      {
        bodyText: JSON.stringify({
          expectedRevision: 4,
          value: quickReplies,
        }),
        method: "PUT",
        url: "http://bb.test/api/v1/preferences/ui/composer.quickReplies",
      },
      {
        bodyText: undefined,
        method: "DELETE",
        url: "http://bb.test/api/v1/preferences/ui/composer.quickReplies",
      },
    ]);
  });

  it("updates watchdog settings through the general settings SDK path", async () => {
    const settings = {
      ...defaultAppSettings,
      providerTurnIdleWatchdogEnabled: false,
      providerTurnIdleNotifyMs: 600_000,
      providerTurnIdleInterruptMs: 1_200_000,
    };
    const queue = createFetchQueue([{ body: {} }]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await sdk.system.updateGeneralSettings(settings);

    expect(queue.requests).toEqual([
      {
        bodyText: JSON.stringify(settings),
        method: "PUT",
        url: "http://bb.test/api/v1/settings/general",
      },
    ]);
  });

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
