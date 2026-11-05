import { describe, expect, it } from "vitest";
import {
  RECORDINGS_ROOT,
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
