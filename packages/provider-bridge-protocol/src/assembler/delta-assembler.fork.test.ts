import { describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import type { DeltaItemShape, ThreadDelta } from "../thread-delta.js";
import {
  createDeltaAssembler,
  type DeltaAssembler,
} from "./delta-assembler.js";

const THREAD_ID = "thr_1";

function assemble(
  assembler: DeltaAssembler,
  ...deltas: ThreadDelta[]
): ThreadEvent[] {
  return assembler.assemble({ threadId: THREAD_ID, deltas });
}

describe("delta assembler background tasks and progress policy", () => {
  function createClockedAssembler(progressThrottleMs?: number) {
    let nowMs = 0;
    const assembler = createDeltaAssembler({
      providerId: "claude-code",
      entropyPrefix: "as-test",
      now: () => nowMs,
      textDeltaFlushMs: 0,
      ...(progressThrottleMs === undefined ? {} : { progressThrottleMs }),
    });
    return {
      assembler,
      advance(ms: number) {
        nowMs += ms;
      },
    };
  }

  function taskShape(
    overrides: Partial<
      Extract<DeltaItemShape, { type: "backgroundTask" }>
    > = {},
  ): Extract<DeltaItemShape, { type: "backgroundTask" }> {
    return {
      type: "backgroundTask",
      familyId: "wf-1",
      taskType: "local_workflow",
      description: "run the workflow",
      status: "pending",
      taskStatus: "running",
      skipTranscript: false,
      foreground: false,
      ...overrides,
    };
  }

  const TASK_KEY = { providerItemId: "task:wf-1" };

  it("stores command and a flushed output path that arrives inside the throttle window", () => {
    const { assembler, advance } = createClockedAssembler();
    assemble(
      assembler,
      { kind: "turn.open" },
      {
        kind: "item.open",
        key: TASK_KEY,
        item: taskShape({ taskType: "local_bash", command: "pnpm build" }),
      },
    );
    const itemId = assembler.getBbItemId(THREAD_ID, "task:wf-1") ?? "";

    advance(100);
    const outputFile = "/tmp/claude-501/proj/sess/tasks/wf-1.output";
    const events = assemble(assembler, {
      kind: "item.progress",
      key: TASK_KEY,
      snapshot: taskShape({
        taskType: "local_bash",
        command: "pnpm build",
        outputFile,
      }),
      flush: true,
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "item/backgroundTask/progress",
        item: expect.objectContaining({
          id: itemId,
          command: "pnpm build",
          outputFile,
        }),
      }),
    ]);
  });
});
