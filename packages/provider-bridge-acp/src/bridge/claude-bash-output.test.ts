import {
  appendFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { threadDeltaNotificationParamsSchema } from "@bb/provider-bridge-protocol";
import { acpToolCallUpdateEventSchema } from "../wire.js";
import {
  attachClaudeBashOutput,
  ClaudeAgentBashOutputWatcher,
  claudeCodeTempRoot,
  observeClaudeBashOutput,
} from "./claude-bash-output.js";

const SESSION_ID = "a75d37d4-session";

function toolCall(fields: Record<string, unknown>) {
  return acpToolCallUpdateEventSchema.parse({
    sessionUpdate: "tool_call",
    kind: "execute",
    status: "pending",
    ...fields,
  });
}

function toolCallUpdate(fields: Record<string, unknown>) {
  return acpToolCallUpdateEventSchema.parse({
    sessionUpdate: "tool_call_update",
    ...fields,
  });
}

function settle(ms = 40): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ClaudeAgentBashOutputWatcher", () => {
  let tempRoot: string;
  let tasksDir: string;
  let published: Array<[string, string]>;
  let parentRefs: Map<string, string | undefined>;
  let watcher: ClaudeAgentBashOutputWatcher;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "bb-acp-bash-"));
    tasksDir = join(tempRoot, "-Users-me-project", SESSION_ID, "tasks");
    await mkdir(tasksDir, { recursive: true });
    published = [];
    parentRefs = new Map();
    watcher = new ClaudeAgentBashOutputWatcher({
      tempRoot,
      sessionId: SESSION_ID,
      pollIntervalMs: 5,
      publish: (toolCallId, text, parentRef) => {
        published.push([toolCallId, text]);
        parentRefs.set(toolCallId, parentRef);
      },
    });
  });

  afterEach(async () => {
    watcher.dispose();
    await rm(tempRoot, { recursive: true, force: true });
  });

  function outputFor(toolCallId: string): string {
    return published
      .filter(([id]) => id === toolCallId)
      .map(([, text]) => text)
      .join("");
  }

  it("streams the one new Bash task file of a lone foreground call and stops at its result", async () => {
    await writeFile(join(tasksDir, "bold00001.output"), "earlier run\n");
    watcher.observe(toolCall({ toolCallId: "toolu_a", name: "Bash" }));
    await settle();
    await mkdir(join(tempRoot, "subagents"), { recursive: true });
    await writeFile(join(tempRoot, "subagents", "agent.jsonl"), "{}\n");
    await symlink(
      join(tempRoot, "subagents", "agent.jsonl"),
      join(tasksDir, "a0subagent.output"),
    );
    await writeFile(join(tasksDir, "m0monitor.output"), "monitor\n");
    await writeFile(join(tasksDir, "b0fg00001.output"), "tick 1\n");
    await vi.waitFor(() => expect(outputFor("toolu_a")).toBe("tick 1\n"));

    await appendFile(join(tasksDir, "b0fg00001.output"), "tick 2\n");
    await vi.waitFor(() =>
      expect(outputFor("toolu_a")).toBe("tick 1\ntick 2\n"),
    );

    watcher.observe(
      toolCallUpdate({ toolCallId: "toolu_a", status: "completed" }),
    );
    await appendFile(join(tasksDir, "b0fg00001.output"), "late\n");
    await settle();
    expect(outputFor("toolu_a")).toBe("tick 1\ntick 2\n");
  });

  it("recognizes Bash from claude-agent-acp tool metadata", async () => {
    watcher.observe(
      toolCall({
        toolCallId: "toolu_meta",
        _meta: { claudeCode: { toolName: "Bash" } },
      }),
    );
    await settle();
    await writeFile(join(tasksDir, "b0meta001.output"), "ok\n");
    await vi.waitFor(() => expect(outputFor("toolu_meta")).toBe("ok\n"));
  });

  it("publishes a subagent Bash call with the parent tool use id", async () => {
    watcher.observe(
      toolCall({
        toolCallId: "toolu_child",
        name: "Bash",
        _meta: { claudeCode: { parentToolUseId: "toolu_agent" } },
      }),
    );
    await settle();
    await writeFile(join(tasksDir, "b0child01.output"), "child\n");
    await vi.waitFor(() => expect(outputFor("toolu_child")).toBe("child\n"));
    expect(parentRefs.get("toolu_child")).toBe("toolu_agent");
  });

  it("publishes an unparented Bash call without a parent ref", async () => {
    watcher.observe(toolCall({ toolCallId: "toolu_main", name: "Bash" }));
    await settle();
    await writeFile(join(tasksDir, "b0main001.output"), "main\n");
    await vi.waitFor(() => expect(outputFor("toolu_main")).toBe("main\n"));
    expect(parentRefs.get("toolu_main")).toBeUndefined();
  });

  it("shows nothing for calls that overlap another Bash call", async () => {
    watcher.observe(toolCall({ toolCallId: "toolu_1", name: "Bash" }));
    watcher.observe(toolCall({ toolCallId: "toolu_2", name: "Bash" }));
    await settle();
    await writeFile(join(tasksDir, "b0one0001.output"), "one\n");
    await settle(60);
    watcher.observe(
      toolCallUpdate({ toolCallId: "toolu_2", status: "completed" }),
    );
    await writeFile(join(tasksDir, "b0two0001.output"), "two\n");
    await settle(60);
    expect(published).toEqual([]);
  });

  it("shows nothing when two new Bash task files appear for one call", async () => {
    watcher.observe(toolCall({ toolCallId: "toolu_x", name: "Bash" }));
    await settle();
    await Promise.all([
      writeFile(join(tasksDir, "b0aaa0001.output"), "a\n"),
      writeFile(join(tasksDir, "b0bbb0001.output"), "b\n"),
    ]);
    await settle(60);
    await writeFile(join(tasksDir, "b0aaa0001.output"), "a\nmore\n");
    await settle(60);
    expect(published).toEqual([]);
  });

  it("never streams a background call and skips its task file later", async () => {
    watcher.observe(
      toolCall({
        toolCallId: "toolu_bg",
        name: "Bash",
        rawInput: { command: "serve", run_in_background: true },
      }),
    );
    watcher.observe(
      toolCallUpdate({
        toolCallId: "toolu_bg",
        status: "completed",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "Command running in background with ID: b0bg00001. Output is being written to: /tmp/x",
            },
          },
        ],
      }),
    );
    watcher.observe(toolCall({ toolCallId: "toolu_fg", name: "Bash" }));
    await settle();
    await writeFile(join(tasksDir, "b0bg00001.output"), "server log\n");
    await writeFile(join(tasksDir, "b0fg00002.output"), "fg\n");
    await vi.waitFor(() => expect(outputFor("toolu_fg")).toBe("fg\n"));
    expect(outputFor("toolu_bg")).toBe("");
  });

  it("ignores tool calls that are not Bash", async () => {
    watcher.observe(toolCall({ toolCallId: "toolu_read", name: "Read" }));
    await settle();
    await writeFile(join(tasksDir, "b0any0001.output"), "x\n");
    await settle(60);
    expect(published).toEqual([]);
  });

  it("derives the per-uid temp root from CLAUDE_CODE_TMPDIR", () => {
    const uid = process.getuid?.() ?? 0;
    expect(claudeCodeTempRoot({ CLAUDE_CODE_TMPDIR: "/var/cc" })).toBe(
      `/var/cc/claude-${uid}`,
    );
    expect(claudeCodeTempRoot({})).toBe(`/tmp/claude-${uid}`);
  });
  it("attaches only for claude-agent-acp and publishes a public output delta", async () => {
    const deltas: unknown[] = [];
    const childEnv = { CLAUDE_CODE_TMPDIR: tempRoot };
    const helperTasksDir = join(
      claudeCodeTempRoot(childEnv),
      "-Users-me-project",
      SESSION_ID,
      "tasks",
    );
    await mkdir(helperTasksDir, { recursive: true });

    expect(
      attachClaudeBashOutput({
        agentName: "other-agent",
        childEnv,
        sessionId: SESSION_ID,
        publish: (newDeltas) => deltas.push(...newDeltas),
      }),
    ).toBeUndefined();

    const helperWatcher = attachClaudeBashOutput({
      agentName: "@agentclientprotocol/claude-agent-acp",
      childEnv,
      sessionId: SESSION_ID,
      publish: (newDeltas) => deltas.push(...newDeltas),
    });
    expect(helperWatcher).toBeDefined();
    if (helperWatcher === undefined) {
      throw new Error("Expected the Claude ACP Bash watcher.");
    }
    try {
      observeClaudeBashOutput(
        helperWatcher,
        toolCall({ toolCallId: "toolu_helper", name: "Bash" }),
      );
      await settle();
      await writeFile(join(helperTasksDir, "b0helper01.output"), "helper\n");
      await vi.waitFor(() => expect(deltas).toHaveLength(1));

      expect(
        threadDeltaNotificationParamsSchema.parse({
          threadId: "thr_helper",
          deltas,
        }).deltas,
      ).toEqual([
        {
          kind: "item.outputDelta",
          key: { providerItemId: "toolu_helper" },
          channel: "command",
          text: "helper\n",
        },
      ]);
    } finally {
      helperWatcher.dispose();
    }
  });

});

