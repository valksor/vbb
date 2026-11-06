import { describe, expect, it } from "vitest";
import {
  BBSdk,
  createBBSdk,
  type BBSdkOptions,
  type SpendBackfillResult,
  type SpendRollupResult,
} from "../src/public-sdk.js";

describe("bb-app public SDK spend facade", () => {
  it.each(["constructor", "factory"] as const)(
    "routes rollup and backfill through the %s facade transport",
    async (mode) => {
      const controller = new AbortController();
      const rollup: SpendRollupResult = {
        rows: [
          {
            day: "*",
            threadId: "*",
            providerId: "codex",
            model: "*",
            inputTokens: 1,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 1,
            weightedUnits: 1,
            turns: 1,
            firstEventAt: 1,
            lastEventAt: 1,
            costUsd: null,
          },
        ],
        coverage: { threads: 1, historyComplete: 1, historyPartial: 0 },
      };
      const backfill: SpendBackfillResult = {
        threadsScanned: 1,
        usageEventsScanned: 1,
        contributionsApplied: 1,
        threadsHistoryComplete: 1,
        threadsHistoryPartial: 0,
      };
      const responses: Array<SpendRollupResult | SpendBackfillResult> = [
        rollup,
        backfill,
      ];
      const requests: Array<{
        method: string;
        url: string;
        signal: AbortSignal | null | undefined;
      }> = [];
      const options: BBSdkOptions = {
        baseUrl: "http://bb.test",
        fetch: async (input, init) => {
          requests.push({
            method: init?.method ?? "GET",
            url: String(input),
            signal: init?.signal,
          });
          const response = responses.shift();
          if (response === undefined) {
            throw new Error("No queued SDK test response");
          }
          return new Response(JSON.stringify(response), {
            headers: { "content-type": "application/json" },
          });
        },
      };
      const sdk = mode === "constructor" ? new BBSdk(options) : createBBSdk(options);

      await expect(
        sdk.spend.rollup({
          from: "2026-01-01",
          to: "2026-01-02",
          groupBy: "provider",
          providerId: "codex",
          threadId: "thr_1",
          signal: controller.signal,
        }),
      ).resolves.toEqual(rollup);
      await expect(
        sdk.spend.backfill({ signal: controller.signal }),
      ).resolves.toEqual(backfill);
      expect(requests.map(({ method, url }) => [method, url])).toEqual([
        [
          "GET",
          "http://bb.test/api/v1/spend/rollup?from=2026-01-01&to=2026-01-02&groupBy=provider&threadId=thr_1&providerId=codex",
        ],
        ["POST", "http://bb.test/api/v1/spend/backfill"],
      ]);
      expect(requests.map(({ signal }) => signal)).toEqual([
        controller.signal,
        controller.signal,
      ]);
    },
  );
});
