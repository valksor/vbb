import { describe, expect, it, vi } from "vitest";
import * as domain from "@bb/domain";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  runCommand,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import {
  jsonResponse,
  stubThreadShowApi,
} from "../helpers/thread-show-api.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread show command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread show prints archived branch-promotion state", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-archived-promotion",
      projectId: "proj-1",
      providerId: "codex",
      status: "idle",
      createdAt: 1,
      updatedAt: 2,
      archivedAt: 1_700_000_000_000,
      promotionTarget: "branch",
      worktreePromotion: "armed",
    });
    const get = vi.fn(async () => thread);
    const timelineGet = fixtures.makeEmptyTimelineGetMock();
    stubThreadShowApi({
      "v1.threads.:id.$get": get,
      "v1.threads.:id.timeline.$get": timelineGet,
    });

    await runCommand(["thread", "show", "thread-archived-promotion"], register);

    expect(get).toHaveBeenCalledWith({
      param: { id: "thread-archived-promotion" },
    });
    expect(timelineGet).toHaveBeenCalledWith({
      param: { id: "thread-archived-promotion" },
      query: { summaryOnly: "true" },
    });
    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines.some((line) => line.includes("Archived:"))).toBe(true);
    expect(lines).toContain("  Promotion target: branch");
    expect(lines).toContain("  Promotion state: armed");
  });

  it("bb thread show prints the execution profile with the time the provider reported it", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-show-execution",
      projectId: "proj-1",
      providerId: "codex",
      status: "idle",
      createdAt: 1,
      updatedAt: 2,
    });
    const reportedAt = 1_760_000_000_000;
    const executionProfile = vi.fn(async () => ({
      lastRequested: null,
      overrides: { model: null, reasoningLevel: null },
      nextTurn: null,
      executed: {
        model: "gpt-5.5-mini",
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

    await runCommand(["thread", "show", "thread-show-execution"], register);

    expect(executionProfile).toHaveBeenCalledWith({
      param: { id: "thread-show-execution" },
    });
    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines).toContain("  Execution:");
    expect(lines).toContain(
      "    Executed:       gpt-5.5-mini · medium · auto · fast",
    );
    expect(lines).toContain(
      `    Reported:       ${new Date(reportedAt).toLocaleString()}`,
    );
  });

  it("bb thread show omits the execution profile when an older server has no such route", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-show-old-server",
      projectId: "proj-1",
      providerId: "codex",
      status: "idle",
      createdAt: 1,
      updatedAt: 2,
    });
    stubThreadShowApi({
      "v1.threads.:id.$get": vi.fn(async () => thread),
      "v1.threads.:id.timeline.$get": fixtures.makeEmptyTimelineGetMock(),
    });

    await runCommand(["thread", "show", "thread-show-old-server"], register);

    expect(collectLogLines(vi.mocked(console.log))).not.toContain(
      "  Execution:",
    );
    expect(collectLogLines(vi.mocked(console.error))).toEqual([]);
  });

  it("bb thread show fails instead of hiding a server error from the execution profile", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-show-profile-error",
      projectId: "proj-1",
      providerId: "codex",
      status: "idle",
      createdAt: 1,
      updatedAt: 2,
    });
    stubThreadShowApi({
      "v1.threads.:id.$get": vi.fn(async () => thread),
      "v1.threads.:id.timeline.$get": fixtures.makeEmptyTimelineGetMock(),
      "v1.threads.:id.execution-profile.$get": async () =>
        jsonResponse(500, { code: "internal", message: "database locked" }),
    });

    await expect(
      runCommand(["thread", "show", "thread-show-profile-error"], register),
    ).rejects.toThrow("process.exit:1");

    expect(
      collectLogLines(vi.mocked(console.error)).some((line) =>
        line.includes("database locked"),
      ),
    ).toBe(true);
  });
});
