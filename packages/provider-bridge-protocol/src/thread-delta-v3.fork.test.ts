import { describe, expect, it } from "vitest";
import { deltaItemShapeSchema, threadDeltaSchema } from "./thread-delta.js";

describe("backgroundTask shape command compatibility", () => {
  const base = {
    type: "backgroundTask",
    familyId: "bash-1",
    taskType: "local_bash",
    description: "Run the build",
    status: "pending",
    taskStatus: "running",
    skipTranscript: false,
  };

  it("parses a backgroundTask shape with and without command", () => {
    const withCommand = deltaItemShapeSchema.safeParse({
      ...base,
      command: "pnpm build",
    });
    expect(withCommand.success).toBe(true);
    expect(withCommand.success && withCommand.data).toMatchObject({
      command: "pnpm build",
    });
    expect(deltaItemShapeSchema.safeParse(base).success).toBe(true);
  });

  it("parses item.progress deltas with and without command", () => {
    const progress = (snapshot: Record<string, unknown>) =>
      threadDeltaSchema.safeParse({
        kind: "item.progress",
        key: { providerItemId: "task:bash-1" },
        snapshot,
        flush: true,
      }).success;
    expect(progress({ ...base, command: "pnpm build" })).toBe(true);
    expect(progress(base)).toBe(true);
  });
});
