import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import plugin, { TOOL_NAME } from "./server.js";

const questions = [
  {
    question: "Which database should we use?",
    header: "Database",
    multiSelect: false,
    options: [
      {
        label: "Postgres (Recommended)",
        description: "Relational, needs a server.",
        preview: "CREATE TABLE users (id uuid primary key);",
      },
      { label: "SQLite", description: "Embedded, zero setup." },
    ],
  },
];

async function resultText(
  result: Awaited<ReturnType<FakePluginHost["harness"]["callAgentTool"]>>,
): Promise<string> {
  if (typeof result === "string") return result;
  const [part] = result.content;
  if (part?.type !== "text") throw new Error("expected a text result");
  return part.text;
}

describe("asking a question", () => {
  it("does not let the agent proceed when the question times out", async () => {
    const host = createFakePluginHost({ pluginId: "ask-user-question" });
    host.bb.ui.requestInput = () =>
      Promise.resolve({ outcome: "cancelled", reason: "timeout" });
    plugin(host.bb as unknown as Parameters<typeof plugin>[0]);

    const result = await host.harness.callAgentTool(TOOL_NAME, { questions });

    expect(result).toMatchObject({ isError: true });
    const text = await resultText(result);
    expect(text).toContain("Stop here and wait for the user");
    expect(text).not.toContain("Proceed");
    expect(text).not.toContain("best judgment");
  });

  it("does not let the agent proceed when the question is interrupted", async () => {
    const host = createFakePluginHost({ pluginId: "ask-user-question" });
    host.bb.ui.requestInput = () =>
      Promise.resolve({ outcome: "cancelled", reason: "server-restarted" });
    plugin(host.bb as unknown as Parameters<typeof plugin>[0]);

    const result = await host.harness.callAgentTool(TOOL_NAME, { questions });

    expect(result).toMatchObject({ isError: true });
    expect(await resultText(result)).toContain("Stop and wait for the user");
  });
});
