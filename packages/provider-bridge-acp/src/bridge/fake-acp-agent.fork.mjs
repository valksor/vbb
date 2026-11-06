import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function forkAgentCapabilities() {
  return process.env.FAKE_ACP_AGENT_NAME
    ? {
        agentInfo: {
          name: process.env.FAKE_ACP_AGENT_NAME,
          version: "0.0.0",
        },
      }
    : {};
}

export async function handleForkPrompt({
  text,
  notifyUpdate,
  sleep,
  activeSessionId,
}) {
  const tempRoot = process.env.CLAUDE_CODE_TMPDIR;
  if (!text.includes("claude-bash") || tempRoot === undefined) {
    return false;
  }
  notifyUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "toolu_bash_1",
    name: "Bash",
    title: "Terminal",
    kind: "execute",
    status: "pending",
    rawInput: {},
  });
  await sleep(100);
  const tasksDir = join(
    tempRoot,
    `claude-${process.getuid?.() ?? 0}`,
    "-fake-project",
    activeSessionId,
    "tasks",
  );
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(join(tasksDir, "b0fake001.output"), "live tick\n");
  await sleep(1_500);
  notifyUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "toolu_bash_1",
    status: "completed",
    content: [
      { type: "content", content: { type: "text", text: "live tick\n" } },
    ],
  });
  return true;
}
