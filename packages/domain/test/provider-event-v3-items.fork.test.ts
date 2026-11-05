import { describe, expect, it } from "vitest";
import { threadEventItemSchema } from "../src/index.js";

describe("backgroundTask item command compatibility", () => {
  const base = {
    type: "backgroundTask",
    id: "item_bg",
    familyId: "bash-1",
    taskType: "local_bash",
    description: "Run the build",
    status: "pending",
    taskStatus: "running",
    skipTranscript: false,
    foreground: false,
  };

  it("parses a backgroundTask item with and without command", () => {
    const withCommand = threadEventItemSchema.safeParse({
      ...base,
      command: "pnpm build",
      outputFile: "/tmp/claude-501/p/s/tasks/bash-1.output",
    });
    expect(withCommand.success).toBe(true);
    expect(withCommand.success && withCommand.data).toMatchObject({
      command: "pnpm build",
    });
    expect(threadEventItemSchema.safeParse(base).success).toBe(true);
  });
});
