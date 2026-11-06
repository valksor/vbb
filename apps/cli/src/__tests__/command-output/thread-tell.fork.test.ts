import { describe, expect, it, vi } from "vitest";
import * as fixtures from "../helpers/command-output-fixtures.js";
import {
  setupCommandOutputTestEnvironment,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread tell command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("keeps the send failure when the restore hint lookup fails", async () => {
    stubServerApi({
      "v1.threads.:id.$get": async () => {
        throw new Error("lookup unavailable");
      },
      "v1.threads.:id.send.$post": async () =>
        new Response(
          JSON.stringify({
            code: "thread_environment_unavailable",
            message: "Thread environment is unavailable",
            details: { reason: "destroyed", environmentStatus: "destroyed" },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
    });

    await expect(
      runCommand(["thread", "tell", "thread-gone", "hello"], register),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.error).mock.calls.map((call) => call[0])).toEqual([
      "Error: HTTP 409: Thread environment is unavailable",
    ]);
  });

  it.each([
    ["destroyed", true, "bb thread restore-environment thread-gone"],
    [
      "destroyed",
      false,
      "bb thread spawn --project proj-1 --prompt 'Continue from @thread:thread-gone'",
    ],
    ["never_attached", true, null],
  ] as const)(
    "bb thread tell explains a %s environment (restorable: %s)",
    async (reason, canRestoreEnvironment, hint) => {
      stubServerApi({
        "v1.threads.:id.$get": async () => ({
          ...fixtures.makeThread({
            id: "thread-gone",
            projectId: "proj-1",
            providerId: "codex",
          }),
          canRestoreEnvironment,
        }),
        "v1.threads.:id.send.$post": async () =>
          new Response(
            JSON.stringify({
              code: "thread_environment_unavailable",
              message: "Thread environment is unavailable",
              details: { reason, environmentStatus: null },
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          ),
      });

      await expect(
        runCommand(["thread", "tell", "thread-gone", "hello"], register),
      ).rejects.toThrow("process.exit:1");

      const errors = vi
        .mocked(console.error)
        .mock.calls.map((call) => String(call[0]));
      if (hint === null) {
        expect(errors).toEqual([
          "Error: HTTP 409: Thread environment is unavailable",
        ]);
      } else {
        expect(errors.some((line) => line.includes(hint))).toBe(true);
      }
    },
  );
});
