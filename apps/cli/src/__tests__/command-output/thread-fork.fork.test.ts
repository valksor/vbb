import { describe, expect, it, vi } from "vitest";
import {
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread fork command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it.each(["worktree", "branch"])(
    "sends explicit %s promotion",
    async (promotion) => {
      const post = vi.fn(async () =>
        fixtures.makeThread({
          id: "thread-new",
          projectId: "proj-1",
          providerId: "codex",
        }),
      );
      stubServerApi({ "v1.threads.fork.$post": post });
      await runCommand(
        [...["thread", "fork", "thread-source"], "--promote", promotion],
        register,
      );
      expect(post).toHaveBeenCalledWith({
        json: expect.objectContaining({
          environment: { type: "project-default", promotion },
        }),
      });
    },
  );

  it.each(["--environment", "--new-environment", "--base-branch"])(
    "rejects promotion with %s before uploads or provisioning",
    async (flag) => {
      const post = vi.fn();
      stubServerApi({ "v1.threads.fork.$post": post });
      await expect(
        runCommand(
          [
            ...["thread", "fork", "thread-source"],
            "--promote",
            "branch",
            flag,
            "value",
            "--file",
            "/nonexistent/attachment",
          ],
          register,
        ),
      ).rejects.toThrow("process.exit:1");
      expect(vi.mocked(console.error).mock.calls[0]?.[0]).toContain(
        `Cannot combine --promote with ${flag}`,
      );
      expect(post).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects unknown promotion targets before uploads", async () => {
    stubServerApi({});
    await expect(
      runCommand(
        [
          ...["thread", "fork", "thread-source"],
          "--promote",
          "invalid",
          "--file",
          "/nonexistent/attachment",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(vi.mocked(console.error).mock.calls[0]?.[0]).toContain(
      "--promote must be worktree or branch",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
