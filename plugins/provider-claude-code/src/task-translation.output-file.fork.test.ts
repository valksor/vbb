import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ThreadEvent,
  ThreadEventBackgroundTaskItem,
  ThreadEventItem,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import {
  createClaudeDeltaHarness,
  loadSessionFixture,
  spawningToolUseMessage,
} from "./delta-test-harness.js";

const PROGRESS_THROTTLE_MS = 500;

function isBackgroundTaskItem(
  item: ThreadEventItem,
): item is ThreadEventBackgroundTaskItem {
  return item.type === "backgroundTask";
}

function backgroundTaskItem(event: ThreadEvent): ThreadEventBackgroundTaskItem {
  if (
    (event.type === "item/started" ||
      event.type === "item/backgroundTask/progress" ||
      event.type === "item/backgroundTask/completed") &&
    isBackgroundTaskItem(event.item)
  ) {
    return event.item;
  }
  throw new Error(`Event ${event.type} did not carry a backgroundTask item`);
}

const TASK_EVENT_TYPES = [
  "item/backgroundTask/progress",
  "item/backgroundTask/completed",
] as const;

function collectTaskEvents(events: ThreadEvent[]): ThreadEvent[] {
  return events.filter(
    (event) =>
      (TASK_EVENT_TYPES as readonly string[]).includes(event.type) ||
      (event.type === "item/started" && isBackgroundTaskItem(event.item)),
  );
}

describe("claude-code background task translation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function advanceClock(ms: number): void {
    vi.setSystemTime(Date.now() + ms);
  }

  describe("local_bash command and output file", () => {
    const THREAD = "bb-thread-1";
    const OUTPUT_FILE =
      "/tmp/claude-501/-proj/session-1/tasks/bmn5wv33k.output";

    function startBashTask(
      harness: ReturnType<typeof createClaudeDeltaHarness>,
      overrides: Record<string, unknown> = {},
    ): ThreadEvent[] {
      const context = { threadId: THREAD };
      harness.translate(
        spawningToolUseMessage({
          toolUseId: "toolu_bash_1",
          toolName: "Bash",
          input: { command: "pnpm run build --watch", run_in_background: true },
        }),
        context,
      );
      return harness.translate(
        {
          type: "system",
          subtype: "task_started",
          task_id: "bmn5wv33k",
          tool_use_id: "toolu_bash_1",
          description: "Watch the build",
          task_type: "local_bash",
          uuid: "u-1",
          session_id: "session-1",
          ...overrides,
        },
        context,
      );
    }

    it("carries the parent Bash command on the started item", () => {
      const harness = createClaudeDeltaHarness();
      const started = collectTaskEvents(startBashTask(harness));
      expect(backgroundTaskItem(started[0]!)).toMatchObject({
        description: "Watch the build",
        command: "pnpm run build --watch",
      });
    });

    it("omits command for non-bash tasks", () => {
      const harness = createClaudeDeltaHarness();
      const context = { threadId: THREAD };
      harness.translate(
        spawningToolUseMessage({
          toolUseId: "toolu_wf_1",
          toolName: "Workflow",
          input: { script: "x" },
        }),
        context,
      );
      const started = collectTaskEvents(
        harness.translate(
          {
            type: "system",
            subtype: "task_started",
            task_id: "wf-1",
            tool_use_id: "toolu_wf_1",
            description: "A workflow",
            task_type: "local_workflow",
            uuid: "u-1",
            session_id: "session-1",
          },
          context,
        ),
      );
      expect(backgroundTaskItem(started[0]!).command).toBeUndefined();
    });

    it("flushes a progress carrying the output path for a backgrounded task", () => {
      const harness = createClaudeDeltaHarness();
      startBashTask(harness, { is_backgrounded: true });
      advanceClock(10);
      const events = harness.setBackgroundTaskOutputFile(THREAD, {
        taskId: "bmn5wv33k",
        providerItemKey: "task:bmn5wv33k",
        path: OUTPUT_FILE,
      });
      expect(events).toHaveLength(1);
      expect(backgroundTaskItem(events[0]!)).toMatchObject({
        command: "pnpm run build --watch",
        outputFile: OUTPUT_FILE,
      });
    });

    it("stores the path silently for a foreground task and emits it when the task moves to the background", () => {
      const harness = createClaudeDeltaHarness();
      const context = { threadId: THREAD };
      startBashTask(harness, { is_backgrounded: false });
      advanceClock(PROGRESS_THROTTLE_MS + 1);
      expect(
        harness.setBackgroundTaskOutputFile(THREAD, {
          taskId: "bmn5wv33k",
          providerItemKey: "task:bmn5wv33k",
          path: OUTPUT_FILE,
        }),
      ).toEqual([]);

      advanceClock(PROGRESS_THROTTLE_MS + 1);
      const moved = collectTaskEvents(
        harness.translate(
          {
            type: "system",
            subtype: "task_updated",
            task_id: "bmn5wv33k",
            patch: { is_backgrounded: true },
            uuid: "u-2",
            session_id: "session-1",
          },
          context,
        ),
      );
      expect(moved.map((event) => event.type)).toEqual(["item/started"]);
      expect(backgroundTaskItem(moved[0]!)).toMatchObject({
        outputFile: OUTPUT_FILE,
      });
    });

    it("does not flush a repeated background patch for a background task", () => {
      const harness = createClaudeDeltaHarness();
      startBashTask(harness);
      const deltas = harness.translator.translate(
        {
          type: "system",
          subtype: "task_updated",
          task_id: "bmn5wv33k",
          patch: { is_backgrounded: true },
          uuid: "u-2",
          session_id: "session-1",
        },
        { threadId: THREAD },
      );
      expect(deltas).toEqual([expect.not.objectContaining({ flush: true })]);
    });

    it("is a no-op for unknown, terminal, and superseded tasks", () => {
      const harness = createClaudeDeltaHarness();
      const context = { threadId: THREAD };
      startBashTask(harness, { is_backgrounded: true });
      const args = {
        taskId: "bmn5wv33k",
        providerItemKey: "task:bmn5wv33k",
        path: OUTPUT_FILE,
      };
      expect(
        harness.setBackgroundTaskOutputFile(THREAD, {
          ...args,
          taskId: "unknown",
        }),
      ).toEqual([]);
      expect(
        harness.setBackgroundTaskOutputFile(THREAD, {
          ...args,
          providerItemKey: "task:bmn5wv33k#2",
        }),
      ).toEqual([]);

      harness.translate(
        {
          type: "system",
          subtype: "task_notification",
          task_id: "bmn5wv33k",
          tool_use_id: "toolu_bash_1",
          status: "completed",
          output_file: "",
          summary: "done",
          uuid: "u-3",
          session_id: "session-1",
        },
        context,
      );
      expect(harness.setBackgroundTaskOutputFile(THREAD, args)).toEqual([]);
      expect(
        harness.translator.backgroundTaskItemKey(THREAD, "bmn5wv33k"),
      ).toBeUndefined();
    });

    it("exposes the current provider item key and keeps the stored path through completion", () => {
      const harness = createClaudeDeltaHarness();
      const context = { threadId: THREAD };
      startBashTask(harness, { is_backgrounded: true });
      expect(
        harness.translator.backgroundTaskItemKey(THREAD, "bmn5wv33k"),
      ).toBe("task:bmn5wv33k");
      advanceClock(10);
      harness.setBackgroundTaskOutputFile(THREAD, {
        taskId: "bmn5wv33k",
        providerItemKey: "task:bmn5wv33k",
        path: OUTPUT_FILE,
      });
      const completed = harness
        .translate(
          {
            type: "system",
            subtype: "task_notification",
            task_id: "bmn5wv33k",
            tool_use_id: "toolu_bash_1",
            status: "completed",
            output_file: "",
            summary: "done",
            uuid: "u-3",
            session_id: "session-1",
          },
          context,
        )
        .filter((event) => event.type === "item/backgroundTask/completed");
      expect(backgroundTaskItem(completed[0]!)).toMatchObject({
        command: "pnpm run build --watch",
        outputFile: OUTPUT_FILE,
      });
    });

    it("a captured completion output_file still matches the tasks/<familyId>.output contract", () => {
      const captured = loadSessionFixture(
        "workflow-task-stop.ndjson",
        "transcripts",
      ).filter(
        (message) =>
          message.subtype === "task_notification" &&
          typeof message.output_file === "string" &&
          message.output_file.length > 0,
      );
      expect(captured.length).toBeGreaterThan(0);
      for (const message of captured) {
        expect(message.output_file).toMatch(
          new RegExp(`^/.+/tasks/${String(message.task_id)}\\.output$`),
        );
      }
    });
  });
});
