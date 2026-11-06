import { describe, expect, it } from "vitest";
import {
  RECORDINGS_ROOT,
  listRecordedCells,
  readBridgeRecording,
  recordedCellInputs,
  type RecordedCell,
} from "./index.js";
import { withCurrentBridgeLane } from "@bb/provider-bridge-protocol/testing";

type JsonRecord = Record<string, unknown>;

const selectedCellKeys = [
  "claude-code/approval-allow",
  "claude-code/approval-deny",
  "claude-code/auth-failure",
  "claude-code/compaction",
  "claude-code/fork",
  "claude-code/plan-mode",
  "claude-code/resume",
  "claude-code/steer",
  "claude-code/stop-interrupt",
  "claude-code/subagent",
  "claude-code/turn-tools",
  "claude-code/user-question",
  "claude-code/web-search",
  "codex/approval-allow",
  "codex/approval-deny",
  "codex/archived-resume",
  "codex/auth-failure",
  "codex/compaction",
  "codex/empty-rollout",
  "codex/fork",
  "codex/missing-rollout",
  "codex/plan-mode",
  "codex/resume",
  "codex/steer",
  "codex/stop-interrupt",
  "codex/subagent",
  "codex/turn-tools",
  "codex/user-question",
  "codex/web-search",
] as const;

const checkpointCases = [
  ["claude-code/compaction", 54, "436042e1-4222-487c-b32b-010944974bfb"],
  ["claude-code/steer", 54, "436042e1-4222-487c-b32b-010944974bfb"],
  ["codex/auth-failure", 19, "01a0222d-4a40-7610-b7bb-a7c51f6b0d2e"],
] as const;

const thinkingCases = [
  ["claude-code/plan-mode", [10, 11, 12, 15, 16, 17, 32, 33, 34, 35]],
  ["claude-code/subagent", [7, 8, 9]],
] as const;

const grantCases = [
  ["claude-code/approval-allow", 8],
  ["claude-code/approval-deny", 8],
  ["claude-code/plan-mode", 30],
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw new TypeError("expected a JSON object");
  }
  return value as JsonRecord;
}

function cellKey(cell: RecordedCell): string {
  return `${cell.provider}/${cell.cell}`;
}

const cellsByKey = new Map(
  listRecordedCells(RECORDINGS_ROOT).map((cell) => [cellKey(cell), cell]),
);

function cell(key: string): RecordedCell {
  const value = cellsByKey.get(key);
  if (value === undefined) throw new Error(`missing recording cell ${key}`);
  return value;
}

function selectedMessages(key: string): JsonRecord[] {
  return withCurrentBridgeLane(readBridgeRecording(cell(key).dir)).entries
    .filter((entry) => entry.dir === "bridge→runtime")
    .map((entry) => asRecord(JSON.parse(entry.line)));
}

function deltas(message: JsonRecord): JsonRecord[] {
  if (!isRecord(message.params)) return [];
  const params = message.params;
  const value = params.deltas;
  if (!Array.isArray(value)) return [];
  return value.map(asRecord);
}

function messageDeltas(key: string, index: number): JsonRecord[] {
  const message = selectedMessages(key)[index];
  if (message === undefined) throw new Error(`missing ${key} record ${index}`);
  return deltas(message);
}

describe("fork recording selection", () => {
  it("selects all fork cells with their complete current bridge lanes", () => {
    const selectedCells = selectedCellKeys.map(cell);
    const selectedEntries = selectedCells.flatMap((value) =>
      withCurrentBridgeLane(readBridgeRecording(value.dir)).entries.filter(
        (entry) => entry.dir === "bridge→runtime",
      ),
    );

    expect(selectedCells).toHaveLength(29);
    expect(selectedEntries).toHaveLength(944);
  });

  it("assembles the ordered execution reports from the selected wire payloads", () => {
    const selectedCells = selectedCellKeys.map(cell);
    const wireExecutions = selectedCellKeys.flatMap((key) =>
      selectedMessages(key).flatMap((message) =>
        deltas(message)
          .filter((delta) => delta.kind === "thread.execution")
          .map((delta) => delta.execution),
      ),
    );
    const reports = selectedCells.flatMap((value) =>
      recordedCellInputs(value).events.filter(
        (event) => event.type === "thread/execution/reported",
      ),
    );

    expect(wireExecutions).toHaveLength(39);
    expect(reports).toHaveLength(39);
    expect(reports.map((event) => event.execution)).toEqual(wireExecutions);
  });

  it("opens the turn before every selected Claude acceptance notification", () => {
    const accepted = selectedCellKeys
      .filter((key) => key.startsWith("claude-code/"))
      .flatMap(selectedMessages)
      .flatMap((message) => {
        const values = deltas(message);
        return values.flatMap((delta, index) =>
          delta.kind === "input.accepted" ? [values[index - 1]] : [],
        );
      });

    expect(accepted).toHaveLength(19);
    expect(accepted.map((delta) => delta?.kind)).toEqual(
      Array.from({ length: 19 }, () => "turn.open"),
    );
  });

  it.each(checkpointCases)(
    "%s record %i keeps its producer checkpoint",
    (key, index, checkpoint) => {
      const boundary = messageDeltas(key, index).find(
        (delta) => delta.kind === "turn.boundary",
      );

      expect(asRecord(boundary).providerCheckpointId).toBe(checkpoint);
    },
  );

  it.each(thinkingCases)(
    "%s uses the current thinking key",
    (key, indices) => {
      const keys = indices.map((index) => {
        const delta = messageDeltas(key, index).find((value) =>
          String(value.kind).startsWith("item.text"),
        );
        return asRecord(asRecord(delta).key).channel;
      });

      expect(keys).toEqual(indices.map(() => "thinking"));
    },
  );

  it.each(grantCases)("%s keeps the current Bash grant", (key, index) => {
    const params = asRecord(selectedMessages(key)[index]?.params);
    const payload = asRecord(params.payload);
    const subject = asRecord(payload.subject);
    const grant = asRecord(subject.sessionGrant);

    expect(grant.network).toBeNull();
  });
});
