import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { makePlanApprovalPayload } from "../helpers/command-output-fixtures.fork.js";
import { jsonResponse } from "../helpers/thread-show-api.fork.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread interactions command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread interactions show prints the deny message when the resolution carries one", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-show-deny-message",
        providerId: "claude-code",
        threadId: "thread-show-deny-message",
        status: "resolved",
        resolvedAt: Date.now(),
        payload: makePlanApprovalPayload("item-plan-deny"),
        resolution: {
          decision: "deny",
          message: "Wait for the deploy window\u0007",
        },
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
    });

    await runCommand(
      [
        "thread",
        "interactions",
        "show",
        "int-show-deny-message",
        "thread-show-deny-message",
      ],
      register,
    );

    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines).toContain("Resolution:");
    expect(lines).toContain("  Decision: deny");
    expect(lines).toContain("  Message: Wait for the deploy window");
  });

  it("bb thread interactions show omits the deny message when the resolution has none", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-show-deny-plain",
        providerId: "codex",
        threadId: "thread-show-deny-plain",
        status: "resolved",
        resolvedAt: Date.now(),
        resolution: {
          decision: "deny",
        },
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
    });

    await runCommand(
      [
        "thread",
        "interactions",
        "show",
        "int-show-deny-plain",
        "thread-show-deny-plain",
      ],
      register,
    );

    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines).toContain("  Decision: deny");
    expect(lines.some((line) => line.startsWith("  Message:"))).toBe(false);
  });

  it("bb thread interactions deny passes --message for plan approvals", async () => {
    const payload = makePlanApprovalPayload("item-plan-deny");
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-plan-deny",
        providerId: "claude-code",
        threadId: "thread-plan-deny",
        payload,
      }),
    );
    const resolveInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-plan-deny",
        providerId: "claude-code",
        threadId: "thread-plan-deny",
        payload,
        status: "resolving",
        resolvedAt: null,
        resolution: {
          decision: "deny",
          message: "Drop the migration step, then propose the plan again.",
        },
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await runCommand(
      [
        "thread",
        "interactions",
        "deny",
        "int-plan-deny",
        "thread-plan-deny",
        "--message",
        "Drop the migration step, then propose the plan again.",
      ],
      register,
    );

    expect(resolveInteraction).toHaveBeenCalledWith({
      param: {
        id: "thread-plan-deny",
        interactionId: "int-plan-deny",
      },
      json: {
        decision: "deny",
        message: "Drop the migration step, then propose the plan again.",
      },
    });
  });

  it("bb thread interactions deny rejects --message for non-plan approvals before posting", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-command-deny-message",
        providerId: "codex",
        threadId: "thread-command-deny-message",
        payload: fixtures.makeCommandApprovalPayload("item-command-deny"),
      }),
    );
    const resolveInteraction = vi.fn();
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await expect(
      runCommand(
        [
          "thread",
          "interactions",
          "deny",
          "int-command-deny-message",
          "thread-command-deny-message",
          "--message",
          "Drop the migration step.",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(resolveInteraction).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "A deny message is only accepted for plan approvals",
    );
  });

  it("bb thread interactions respond prints the app-answer refusal and exits non-zero", async () => {
    const respond = vi.fn(async () =>
      jsonResponse(403, {
        code: "app_answer_required",
        message: "This form must be answered in the bb app.",
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.respond.$post": respond,
    });

    await expect(
      runCommand(
        [
          "thread",
          "interactions",
          "respond",
          "int-plan-form",
          "thread-plan-form",
          "--value",
          '{"approved":true}',
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(respond).toHaveBeenCalledOnce();
    expect(collectLogLines(vi.mocked(console.error))).toEqual([
      "Error: Failed to respond to interaction int-plan-form: HTTP 403: This form must be answered in the bb app.",
    ]);
  });
});
