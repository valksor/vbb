import type { Profiler } from "node:inspector";
import { describe, expect, it } from "vitest";
import * as stallAttribution from "../src/stall-attribution.js";

function profileWithSamples(timeDeltas: number[]): Profiler.Profile {
  return {
    startTime: 1_000_000,
    endTime: 1_100_000,
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: "heartbeat",
          scriptId: "1",
          url: "server.js",
          lineNumber: 1,
          columnNumber: 0,
        },
      },
      {
        id: 2,
        callFrame: {
          functionName: "(garbage collector)",
          scriptId: "0",
          url: "",
          lineNumber: -1,
          columnNumber: -1,
        },
      },
      {
        id: 3,
        callFrame: {
          functionName: "writeSync",
          scriptId: "2",
          url: "node:fs",
          lineNumber: 10,
          columnNumber: 0,
        },
      },
      {
        id: 4,
        children: [3],
        callFrame: {
          functionName: "appendPluginLogLine",
          scriptId: "1",
          url: "plugin-log.ts",
          lineNumber: 20,
          columnNumber: 0,
        },
      },
    ],
    samples: [1, 2, 3, 1],
    timeDeltas,
  };
}

describe("stall windows on a clock that runs ahead of the profile clock", () => {
  const offsetMs = 656_387_182.25;
  const batch = {
    epochOffsetMs: 0,
    droppedWindows: 0,
    windows: [{ startedAt: 1007 + offsetMs, endedAt: 1014 + offsetMs }],
  };
  const profile = () => profileWithSamples([5_000, 5_000, 5_000, 5_000]);

  it("attributes the stall when the offset is the same at the start and the end of the profile", () => {
    const [summary] = stallAttribution.summarizeStallWindows(profile(), batch, {
      startMs: offsetMs,
      endMs: offsetMs,
    });
    expect(summary).toMatchObject({
      delayMs: 7,
      stallAttribution: "sampled",
      sampledMs: 7,
      unobservedMs: 0,
    });
  });

  it("still attributes the stall when the two offsets differ by measurement noise", () => {
    const [summary] = stallAttribution.summarizeStallWindows(profile(), batch, {
      startMs: offsetMs - 5,
      endMs: offsetMs,
    });
    expect(summary).toMatchObject({
      stallAttribution: "sampled",
      sampledMs: 7,
    });
  });

  it("does not attribute the stall when the system slept during the profile", () => {
    const [summary] = stallAttribution.summarizeStallWindows(profile(), batch, {
      startMs: offsetMs - 30_000,
      endMs: offsetMs,
    });
    expect(summary).toMatchObject({
      delayMs: 7,
      stallAttribution: "unattributed",
      sampledMs: 0,
      unobservedMs: 7,
      stacks: [],
    });
  });

  it("does not attribute the stall when the offset is ignored", () => {
    const [summary] = stallAttribution.summarizeStallWindows(profile(), batch, {
      startMs: 0,
      endMs: 0,
    });
    expect(summary).toMatchObject({
      stallAttribution: "unattributed",
      sampledMs: 0,
      stacks: [],
    });
  });
});

describe("clockOffsetMs", () => {
  it("converts nanoseconds and microseconds to a positive millisecond offset when the monotonic clock is ahead", () => {
    expect(stallAttribution.clockOffsetMs(5_000_000_000n, 3_000_000)).toBe(
      2_000,
    );
  });

  it("is negative when the profile clock is ahead", () => {
    expect(stallAttribution.clockOffsetMs(3_000_000_000n, 5_000_000)).toBe(
      -2_000,
    );
  });

  it("keeps sub-millisecond precision", () => {
    expect(stallAttribution.clockOffsetMs(1_500_000n, 1_000)).toBeCloseTo(
      0.5,
      9,
    );
  });
});

describe("profile clock drift threshold", () => {
  it.each([
    { startMs: 50, silent: false },
    { startMs: -50, silent: false },
    { startMs: 50.001, silent: true },
    { startMs: -50.001, silent: true },
  ])(
    "start offset $startMs with zero end offset: silent=$silent",
    ({ startMs, silent }) => {
      const batch = {
        epochOffsetMs: 10_000,
        droppedWindows: 3,
        windows: [{ startedAt: 1007, endedAt: 1014 }],
      };
      const profile = profileWithSamples([5_000, 5_000, 5_000, 5_000]);
      const [summary] = stallAttribution.summarizeStallWindows(profile, batch, {
        startMs,
        endMs: 0,
      });
      expect(summary).toMatchObject({
        startedAt: new Date(11_007).toISOString(),
        endedAt: new Date(11_014).toISOString(),
        delayMs: 7,
        droppedWindows: 3,
        stallAttribution: silent ? "unattributed" : "sampled",
        sampledMs: silent ? 0 : 7,
        unobservedMs: silent ? 7 : 0,
      });
      if (silent) expect(summary?.stacks).toEqual([]);
      expect(profile.samples).toEqual([1, 2, 3, 1]);
      expect(profile.timeDeltas).toEqual([5_000, 5_000, 5_000, 5_000]);
    },
  );
});
