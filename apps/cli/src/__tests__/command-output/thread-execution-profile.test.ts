import { describe, expect, it, vi } from "vitest";
import * as domain from "@bb/domain";
import {
  collectLogLines,
  runCommand,
  setupCommandOutputTestEnvironment,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import {
  jsonResponse,
  stubThreadShowApi,
} from "../helpers/thread-show-api.fork.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("thread execution profile output", () => {
  setupCommandOutputTestEnvironment();
  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");
  const thread: domain.Thread = fixtures.makeThread({
    id: "thread-show-execution",
    projectId: "proj-1",
    providerId: "claude-code",
    status: "idle",
    createdAt: 1,
    updatedAt: 2,
  });

  it("prints a provider report and its receipt time", async () => {
    const reportedAt = 1_760_000_000_000;
    const executionProfile = vi.fn(async () => ({
      lastRequested: null,
      overrides: { model: null, reasoningLevel: null },
      nextTurn: null,
      executed: {
        model: "claude-opus-4-6",
        reasoningLevel: "medium",
        permissionMode: "auto",
        serviceTier: "fast",
        reportedAt,
      },
    }));
    stubThreadShowApi({
      "v1.threads.:id.$get": vi.fn(async () => thread),
      "v1.threads.:id.timeline.$get": fixtures.makeEmptyTimelineGetMock(),
      "v1.threads.:id.execution-profile.$get": executionProfile,
    });
    await runCommand(["thread", "show", thread.id], register);
    expect(executionProfile).toHaveBeenCalledWith({ param: { id: thread.id } });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "    Executed:       claude-opus-4-6 · medium · auto · fast",
    );
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      `    Reported:       ${new Date(reportedAt).toLocaleString()}`,
    );
  });

  it("omits the profile for an older server and prints null reports", async () => {
    stubThreadShowApi({
      "v1.threads.:id.$get": vi.fn(async () => thread),
      "v1.threads.:id.timeline.$get": fixtures.makeEmptyTimelineGetMock(),
    });
    await runCommand(["thread", "show", thread.id], register);
    expect(collectLogLines(vi.mocked(console.log))).not.toContain("  Execution:");

    stubThreadShowApi({
      "v1.threads.:id.$get": vi.fn(async () => thread),
      "v1.threads.:id.timeline.$get": fixtures.makeEmptyTimelineGetMock(),
      "v1.threads.:id.execution-profile.$get": async () => ({
        lastRequested: null,
        overrides: { model: null, reasoningLevel: null },
        nextTurn: null,
        executed: null,
      }),
    });
    await runCommand(["thread", "show", thread.id], register);
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "    Executed:       not reported by the provider",
    );
  });

  it("propagates non-404 profile errors", async () => {
    stubThreadShowApi({
      "v1.threads.:id.$get": vi.fn(async () => thread),
      "v1.threads.:id.timeline.$get": fixtures.makeEmptyTimelineGetMock(),
      "v1.threads.:id.execution-profile.$get": async () =>
        jsonResponse(500, { code: "internal", message: "database locked" }),
    });
    await expect(runCommand(["thread", "show", thread.id], register)).rejects.toThrow(
      "process.exit:1",
    );
    expect(
      collectLogLines(vi.mocked(console.error)).some((line) =>
        line.includes("database locked"),
      ),
    ).toBe(true);
  });
});
