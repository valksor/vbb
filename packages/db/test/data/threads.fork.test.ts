import { describe, expect, it, vi } from "vitest";
import { noopNotifier } from "../../src/notifier.js";
import type { DbNotifier } from "../../src/notifier.js";
import {
  createThread,
  listThreadsWithPendingInteractionState,
  listThreadsWithPendingInteractionStateForProjects,
  updateThread,
} from "../../src/data/threads.js";
import { createPendingInteraction } from "../../src/data/pending-interactions.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createMigratedConnection } from "../../src/testing.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  return { db, host, project };
}

describe("threads", () => {
  it.each([
    { name: "plan approval", payload: JSON.stringify({ kind: "approval", subject: { kind: "plan", itemId: "plan-1", plan: "Implement the plan", planFilePath: null }, reason: null, availableDecisions: ["allow_once", "deny"] }), expectedKind: "plan_approval" },
    { name: "question", payload: JSON.stringify({ kind: "user_question", questions: [{ id: "question-1", prompt: "Proceed?", multiSelect: false, allowFreeText: true, required: true }] }), expectedKind: "question" },
    { name: "no pending interaction", payload: null, expectedKind: null },
  ] as const)("projects pending interaction state without query-only columns for $name", ({ name, payload, expectedKind }) => {
    const { db, project } = setup();
    try {
      const thread = createThread(db, noopNotifier, { projectId: project.id, providerId: "codex" });
      if (payload !== null) createPendingInteraction(db, { payload, providerId: "codex", providerRequestId: `projection-request-${name}`, providerThreadId: "projection-provider-thread", threadId: thread.id, turnId: "projection-turn" });
      const returnedRows = [listThreadsWithPendingInteractionState(db, { threadIds: [thread.id] })[0], listThreadsWithPendingInteractionStateForProjects(db, { projectIds: [project.id] })[0]];
      for (const row of returnedRows) {
        expect(row).toMatchObject({ id: thread.id, projectId: project.id, providerId: "codex", hasPendingInteraction: payload !== null, pendingInteractionKind: expectedKind });
        expect(row).not.toHaveProperty("pendingInteractionPayloadKind");
        expect(row).not.toHaveProperty("pendingInteractionApprovalSubjectKind");
      }
    } finally { db.$client.close(); }
  });

  it("notifies when worktree promotion is declined", () => {
    const { db, project } = setup();
    const spy: DbNotifier = {
      notifyThread: vi.fn(),
      notifyEnvironment: vi.fn(),
      notifyHost: vi.fn(),
      notifyProject: vi.fn(),
      notifySystem: vi.fn(),
    };
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      worktreePromotion: "armed",
    });

    updateThread(db, spy, thread.id, { worktreePromotion: "declined" });

    expect(spy.notifyThread).toHaveBeenCalledWith(
      thread.id,
      ["environment-changed"],
      { projectId: project.id },
    );
  });
});
