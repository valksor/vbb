import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  setupCommandOutputTestEnvironment,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { makeTimelineResponse } from "../helpers/command-output-fixtures.js";
import { makeBackgroundTaskRow } from "../helpers/command-output-fixtures.fork.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

const ESC = "\u001b";

describe("bb thread background command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  function stubTimeline(commands: ReturnType<typeof makeBackgroundTaskRow>[]) {
    const getTimeline = vi.fn(async () => ({
      ...makeTimelineResponse([]),
      activeBackgroundCommands: commands,
    }));
    return getTimeline;
  }

  it("lists active background commands with item id, status, elapsed time and the full command", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(200_000));
    try {
      const getTimeline = stubTimeline([
        makeBackgroundTaskRow({
          itemId: "item_a",
          startedAt: 140_000,
          command: "pnpm exec vitest watch --reporter=dot",
          description: "Watch tests",
        }),
        makeBackgroundTaskRow({
          itemId: "item_b",
          startedAt: 195_000,
          command: null,
          description: "Tail the log",
        }),
        makeBackgroundTaskRow({
          itemId: "item_c",
          taskType: "local_agent",
          startedAt: 199_000,
          description: "Inspect banner",
          outputAvailable: false,
        }),
      ]);
      stubServerApi({ "v1.threads.:id.timeline.$get": getTimeline });

      await runCommand(["thread", "background", "thread-1"], register);

      expect(getTimeline).toHaveBeenCalledWith({
        param: { id: "thread-1" },
        query: { summaryOnly: "true" },
      });
      expect(collectLogLines(vi.mocked(console.log))).toEqual([
        "item_a  running  1m 0s  pnpm exec vitest watch --reporter=dot",
        "item_b  running  5s  Tail the log",
        "item_c  running  1s  [agent] Inspect banner",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sanitises command text in the listing so a task cannot inject escapes or forge rows", async () => {
    stubServerApi({
      "v1.threads.:id.timeline.$get": stubTimeline([
        makeBackgroundTaskRow({
          itemId: "item_a",
          startedAt: Date.now(),
          command: `echo hi${ESC}]52;c;ZXZpbA==\u0007\nitem_forged  running  0s  fake`,
          description: `desc${ESC}[2J`,
        }),
        makeBackgroundTaskRow({
          itemId: "item_b",
          startedAt: Date.now(),
          command: null,
          description: `line one\r\nline two${ESC}[31m`,
        }),
      ]),
    });

    await runCommand(["thread", "background", "thread-1"], register);

    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^item_a {2}running {2}\d+s {2}echo hi item_forged {2}running {2}0s {2}fake$/,
    );
    expect(lines[1]).toMatch(
      /^item_b {2}running {2}\d+s {2}line one line two$/,
    );
    expect(lines.join("\n")).not.toContain(ESC);
  });

  it("--json keeps the command text unmodified", async () => {
    const command = `echo${ESC}]52;c;ZXZpbA==\u0007\nnext`;
    stubServerApi({
      "v1.threads.:id.timeline.$get": stubTimeline([
        makeBackgroundTaskRow({ itemId: "item_a", command }),
      ]),
    });

    await runCommand(["thread", "background", "thread-1", "--json"], register);

    const payload = JSON.parse(
      String(vi.mocked(console.log).mock.calls[0]?.[0]),
    );
    expect(payload.tasks[0].command).toBe(command);
  });

  it("prints a plain message and exits 0 when nothing is running", async () => {
    stubServerApi({ "v1.threads.:id.timeline.$get": stubTimeline([]) });

    await runCommand(["thread", "background", "thread-1"], register);

    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "No background commands running.",
    ]);
  });

  it("--json lists the tasks", async () => {
    stubServerApi({
      "v1.threads.:id.timeline.$get": stubTimeline([
        makeBackgroundTaskRow({
          itemId: "item_a",
          command: "sleep 100",
          startedAt: Date.now() - 2_000,
        }),
      ]),
    });

    await runCommand(["thread", "background", "thread-1", "--json"], register);

    const payload = JSON.parse(
      String(vi.mocked(console.log).mock.calls[0]?.[0]),
    );
    expect(payload.threadId).toBe("thread-1");
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0]).toMatchObject({
      itemId: "item_a",
      kind: "command",
      status: "running",
      command: "sleep 100",
      outputAvailable: true,
    });
  });

  it("--task prints the sanitised tail and notes truncation on stderr", async () => {
    const getOutput = vi.fn(async () => ({
      state: "available" as const,
      text: `${ESC}]8;;https://x.test${ESC}\\link${ESC}]8;;${ESC}\\ ${ESC}[32mok${ESC}[0m\n10%\r100%\n`,
      truncated: true,
      totalBytes: 5_000_000,
    }));
    stubServerApi({
      "v1.threads.:id.timeline.$get": stubTimeline([]),
      "v1.threads.:id.background-tasks.:itemId.output.$get": getOutput,
    });

    await runCommand(
      [
        "thread",
        "background",
        "thread-1",
        "--task",
        "item_a",
        "--tail-bytes",
        "2048",
      ],
      register,
    );

    expect(getOutput).toHaveBeenCalledWith({
      param: { id: "thread-1", itemId: "item_a" },
      query: { tailBytes: "2048" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      `link ${ESC}[32mok${ESC}[0m\n100%`,
    ]);
    expect(collectLogLines(vi.mocked(console.error))).toContain(
      "Output truncated to its tail; the full output is 5000000 bytes.",
    );
  });

  it("--task --raw prints the output unmodified", async () => {
    const text = `${ESC}]52;c;ZXZpbA==\u0007raw\r\n`;
    stubServerApi({
      "v1.threads.:id.timeline.$get": stubTimeline([]),
      "v1.threads.:id.background-tasks.:itemId.output.$get": vi.fn(
        async () => ({
          state: "available" as const,
          text,
          truncated: false,
          totalBytes: text.length,
        }),
      ),
    });

    await runCommand(
      ["thread", "background", "thread-1", "--task", "item_a", "--raw"],
      register,
    );

    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      text.replace(/\n$/, ""),
    ]);
  });

  it("--task rejects a background agent without reading output", async () => {
    const getOutput = vi.fn();
    stubServerApi({
      "v1.threads.:id.timeline.$get": stubTimeline([
        makeBackgroundTaskRow({
          itemId: "item_agent",
          taskType: "local_agent",
          description: "Inspect banner",
        }),
      ]),
      "v1.threads.:id.background-tasks.:itemId.output.$get": getOutput,
    });

    await expect(
      runCommand(
        ["thread", "background", "thread-1", "--task", "item_agent"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(getOutput).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.error))).toContain(
      "Error: Task item_agent is a background agent; only background commands have output.",
    );
  });

  it.each([
    [
      "pending",
      "Task item_a has not written an output file yet. Try again shortly.",
    ],
    ["busy", "Task item_a output is changing too quickly to read. Try again."],
  ] as const)(
    "--task maps %s to a plain note and exits 0",
    async (state, note) => {
      stubServerApi({
        "v1.threads.:id.timeline.$get": stubTimeline([]),
        "v1.threads.:id.background-tasks.:itemId.output.$get": vi.fn(
          async () => ({ state, text: "", truncated: false, totalBytes: 0 }),
        ),
      });

      await runCommand(
        ["thread", "background", "thread-1", "--task", "item_a"],
        register,
      );

      expect(collectLogLines(vi.mocked(console.log))).toEqual([]);
      expect(collectLogLines(vi.mocked(console.error))).toContain(note);
    },
  );

  it("--task fails with a clear message when output is unavailable", async () => {
    stubServerApi({
      "v1.threads.:id.timeline.$get": stubTimeline([]),
      "v1.threads.:id.background-tasks.:itemId.output.$get": vi.fn(
        async () => ({
          state: "unavailable" as const,
          text: "",
          truncated: false,
          totalBytes: 0,
        }),
      ),
    });

    await expect(
      runCommand(
        ["thread", "background", "thread-1", "--task", "item_a"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogLines(vi.mocked(console.error))[0]).toContain(
      "Output isn't available for task item_a.",
    );
  });

  it("--task --json exits 0 and reports an unavailable state", async () => {
    stubServerApi({
      "v1.threads.:id.timeline.$get": stubTimeline([]),
      "v1.threads.:id.background-tasks.:itemId.output.$get": vi.fn(
        async () => ({
          state: "unavailable" as const,
          text: "",
          truncated: false,
          totalBytes: 0,
        }),
      ),
    });

    await runCommand(
      ["thread", "background", "thread-1", "--task", "item_a", "--json"],
      register,
    );

    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toMatchObject({ itemId: "item_a", state: "unavailable" });
  });

  it("rejects --tail-bytes outside the supported range and flags that need --task", async () => {
    stubServerApi({ "v1.threads.:id.timeline.$get": stubTimeline([]) });

    await expect(
      runCommand(
        [
          "thread",
          "background",
          "thread-1",
          "--task",
          "item_a",
          "--tail-bytes",
          "0",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(["thread", "background", "thread-1", "--raw"], register),
    ).rejects.toThrow("process.exit:1");

    const errors = collectLogLines(vi.mocked(console.error));
    expect(errors).toContain(
      "Error: --tail-bytes must be an integer between 1 and 1048576.",
    );
    expect(errors).toContain("Error: --tail-bytes and --raw require --task.");
  });
});
