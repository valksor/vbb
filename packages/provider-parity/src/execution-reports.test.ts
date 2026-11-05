import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RECORDINGS_ROOT,
  ROW_COUNTS_PATH,
  countCellInputs,
  listRecordedCells,
  projectParityRows,
  recordedCellInputs,
} from "./index.js";

const expectedReports: Readonly<Record<string, number>> = {
  "approval-allow": 1,
  "approval-deny": 1,
  "auth-failure": 1,
  compaction: 2,
  fork: 1,
  "plan-mode": 1,
  resume: 2,
  steer: 2,
  "stop-interrupt": 2,
  subagent: 1,
  "turn-tools": 1,
  "user-question": 1,
  "web-search": 1,
};

const cells = listRecordedCells(RECORDINGS_ROOT).filter(
  (cell) =>
    cell.provider === "claude-code" &&
    Object.hasOwn(expectedReports, cell.cell),
);

const expectedCodexReports: Readonly<Record<string, number>> = {
  "approval-allow": 1,
  "approval-deny": 1,
  "archived-resume": 2,
  "auth-failure": 1,
  compaction: 2,
  "empty-rollout": 1,
  fork: 1,
  "missing-rollout": 2,
  "plan-mode": 1,
  resume: 2,
  steer: 2,
  "stop-interrupt": 2,
  subagent: 1,
  "turn-tools": 1,
  "user-question": 1,
  "web-search": 1,
};

const codexCells = listRecordedCells(RECORDINGS_ROOT).filter(
  (cell) =>
    cell.provider === "codex" && Object.hasOwn(expectedCodexReports, cell.cell),
);

const rowCounts = JSON.parse(readFileSync(ROW_COUNTS_PATH, "utf8")) as Record<
  string,
  { events: number; rows: number; unhandled: number; grammarDrops: number }
>;

const projectionPositionFields = new Set([
  "completedAt",
  "createdAt",
  "id",
  "messageSeq",
  "sourceSeqEnd",
  "sourceSeqStart",
  "startedAt",
]);

function withoutProjectionPositions(rows: unknown[]): unknown[] {
  return JSON.parse(
    JSON.stringify(rows, (key, value) =>
      projectionPositionFields.has(key) ? 0 : value,
    ),
  ) as unknown[];
}

describe("Claude execution report recordings", () => {
  it.each(cells)("keeps $cell timeline rows unchanged", (cell) => {
    const inputs = recordedCellInputs(cell);
    const reports = inputs.events.filter(
      (event) => event.type === "thread/execution/reported",
    );
    const eventsWithoutReports = inputs.events.filter(
      (event) => event.type !== "thread/execution/reported",
    );
    const rowsWithoutReports = projectParityRows({
      events: eventsWithoutReports,
      providerId: cell.provider,
    });

    expect(reports).toHaveLength(expectedReports[cell.cell]);
    expect(withoutProjectionPositions(rowsWithoutReports)).toEqual(
      withoutProjectionPositions(inputs.rows),
    );
    expect(countCellInputs({ ...inputs, events: eventsWithoutReports })).toEqual(
      expect.objectContaining({
        events: countCellInputs(inputs).events - expectedReports[cell.cell],
        rows: countCellInputs(inputs).rows,
      }),
    );
  });
});

describe("Codex execution report recordings", () => {
  it("selects every declared Codex cell", () => {
    expect(codexCells.map((cell) => cell.cell).sort()).toEqual(
      Object.keys(expectedCodexReports).sort(),
    );
  });

  it.each(codexCells)("keeps $cell timeline rows unchanged", (cell) => {
    const inputs = recordedCellInputs(cell);
    const reports = inputs.events.filter(
      (event) => event.type === "thread/execution/reported",
    );
    const eventsWithoutReports = inputs.events.filter(
      (event) => event.type !== "thread/execution/reported",
    );
    const rowsWithoutReports = projectParityRows({
      events: eventsWithoutReports,
      providerId: cell.provider,
    });

    expect(inputs.invalidDeltas).toEqual([]);
    expect(inputs.grammarViolations).toEqual([]);
    expect(countCellInputs(inputs)).toEqual(rowCounts[`codex/${cell.cell}`]);
    expect(reports).toHaveLength(expectedCodexReports[cell.cell]);
    expect(withoutProjectionPositions(rowsWithoutReports)).toEqual(
      withoutProjectionPositions(inputs.rows),
    );
    expect(countCellInputs({ ...inputs, events: eventsWithoutReports })).toEqual(
      expect.objectContaining({
        events: countCellInputs(inputs).events - expectedCodexReports[cell.cell],
        rows: countCellInputs(inputs).rows,
      }),
    );
  });
});
