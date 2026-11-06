import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type {
  BridgeRecordingDirection,
  BridgeRecordingEntry,
} from "../bridge-kit/bridge-recorder.js";
import {
  CURRENT_BRIDGE_LANE_FILE,
  readCurrentBridgeLane,
  withCurrentBridgeLane,
} from "./recording.js";
import { rerecordCurrentBridgeLane } from "./rerecord.js";

const { replayRecordingMock } = vi.hoisted(() => ({
  replayRecordingMock: vi.fn(),
}));

vi.mock("./parity.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./parity.js")>()),
  replayRecording: replayRecordingMock,
}));

const dirs: string[] = [];

function entry(
  dir: BridgeRecordingDirection,
  run: number,
  seq: number,
  line: string,
): BridgeRecordingEntry {
  return { ts: run * 100 + seq, run, seq, dir, line };
}

afterEach(() => {
  replayRecordingMock.mockReset();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("prefers the fork current lane and preserves other directions in run/seq order", () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-recording-fork-test-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, CURRENT_BRIDGE_LANE_FILE),
    `${JSON.stringify(entry("bridge→runtime", 1, 3, "canonical"))}\n`,
  );
  writeFileSync(
    join(dir, "bridge→runtime.current.fork.ndjson"),
    [
      entry("bridge→runtime", 2, 1, "fork-late"),
      entry("bridge→runtime", 1, 4, "fork-early"),
    ]
      .map((value) => JSON.stringify(value))
      .join("\n") + "\n",
  );

  const result = withCurrentBridgeLane({
    dir,
    manifest: null,
    entries: [
      entry("runtime→bridge", 1, 1, "runtime"),
      entry("provider→bridge", 1, 2, "provider"),
      entry("bridge→runtime", 1, 3, "replaced"),
      entry("bridge→provider", 3, 1, "bridge"),
    ],
  });

  expect(result.entries.map(({ run, seq, line }) => [run, seq, line])).toEqual([
    [1, 1, "runtime"],
    [1, 2, "provider"],
    [1, 4, "fork-early"],
    [2, 1, "fork-late"],
    [3, 1, "bridge"],
  ]);
});

it("falls back to the canonical current lane and returns null when neither exists", () => {
  const canonicalDir = mkdtempSync(join(tmpdir(), "bb-recording-fork-test-"));
  const emptyDir = mkdtempSync(join(tmpdir(), "bb-recording-fork-test-"));
  dirs.push(canonicalDir, emptyDir);
  writeFileSync(
    join(canonicalDir, CURRENT_BRIDGE_LANE_FILE),
    `${JSON.stringify(entry("bridge→runtime", 1, 1, "canonical"))}\n`,
  );

  expect(readCurrentBridgeLane(canonicalDir)?.map(({ line }) => line)).toEqual([
    "canonical",
  ]);
  expect(readCurrentBridgeLane(emptyDir)).toBeNull();
});

it("rejects a fork lane with the wrong direction", () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-recording-fork-test-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "bridge→runtime.current.fork.ndjson"),
    `${JSON.stringify(entry("runtime→bridge", 1, 1, "wrong"))}\n`,
  );

  expect(() => readCurrentBridgeLane(dir)).toThrow(
    "entry direction runtime→bridge in the current bridge lane",
  );
});

it("rerecords to the selected fork lane and sorts its entries through the current lane consumer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-recording-fork-test-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, CURRENT_BRIDGE_LANE_FILE),
    `${JSON.stringify(entry("bridge→runtime", 1, 2, "canonical"))}\n`,
  );
  writeFileSync(join(dir, "bridge→runtime.current.fork.ndjson"), "\n");
  replayRecordingMock.mockResolvedValue({
    stalls: [],
    events: [],
    lines: [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "later" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "earlier" }),
    ],
    lineAfter: [
      { run: 2, seq: 10, ts: 20 },
      { run: 1, seq: 3, ts: 30 },
    ],
  });

  const result = await rerecordCurrentBridgeLane({
    recordingDir: dir,
    providerId: "test-provider",
    bridge: { command: "unused", args: [], cwd: dir, env: {} },
    createAssembler: () => ({ assembleMessage: () => [] }),
  });

  expect(result.file).toBe(join(dir, "bridge→runtime.current.fork.ndjson"));
  expect(readCurrentBridgeLane(dir)?.map(({ run, seq }) => [run, seq])).toEqual([
    [2, 10 + 1 / 3],
    [1, 3 + 1 / 3],
  ]);
  expect(
    withCurrentBridgeLane({
      dir,
      manifest: null,
      entries: [entry("runtime→bridge", 1, 1, "runtime")],
    }).entries.map(({ run, seq }) => [run, seq]),
  ).toEqual([
    [1, 1],
    [1, 3 + 1 / 3],
    [2, 10 + 1 / 3],
  ]);
});
