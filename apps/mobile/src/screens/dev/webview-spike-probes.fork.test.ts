import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { SPIKE_HARNESS } from "./webview-spike-probes";

function runHarness(args: {
  postMessage(payload: string): void;
  warn(...values: unknown[]): void;
}): { mark(name: string): void } {
  const window: {
    ReactNativeWebView: { postMessage(payload: string): void };
    addEventListener(): void;
    __bbSpike?: { mark(name: string): void };
  } = {
    ReactNativeWebView: { postMessage: args.postMessage },
    addEventListener() {},
  };
  runInNewContext(SPIKE_HARNESS, {
    window,
    document: { addEventListener() {} },
    performance: { now: () => 17.6 },
    console: { warn: args.warn },
    JSON,
  });
  const spike = window.__bbSpike;
  if (spike === undefined) throw new Error("SPIKE_HARNESS did not install");
  return spike;
}

describe("SPIKE_HARNESS", () => {
  it("warns with the bridge error and continues reporting after a failed report", () => {
    const error = new Error("bridge down");
    const reports: string[] = [];
    const warnings: unknown[][] = [];
    let attempts = 0;
    const spike = runHarness({
      postMessage(payload) {
        reports.push(payload);
        attempts += 1;
        if (attempts === 1) throw error;
      },
      warn(...values) {
        warnings.push(values);
      },
    });

    spike.mark("afterFailure");

    expect(warnings).toEqual([["bb webview spike report failed", error]]);
    expect(reports).toEqual([
      JSON.stringify({ kind: "mark", name: "harnessInstalled", atMs: 18 }),
      JSON.stringify({ kind: "mark", name: "afterFailure", atMs: 18 }),
    ]);
  });

  it("preserves the healthy report payload without a warning", () => {
    const reports: string[] = [];
    const warnings: unknown[][] = [];

    runHarness({
      postMessage(payload) {
        reports.push(payload);
      },
      warn(...values) {
        warnings.push(values);
      },
    });

    expect(reports).toEqual([
      JSON.stringify({ kind: "mark", name: "harnessInstalled", atMs: 18 }),
    ]);
    expect(warnings).toEqual([]);
  });
});
