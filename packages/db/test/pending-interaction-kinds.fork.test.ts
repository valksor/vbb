import { describe, expect, it } from "vitest";
import type { DbConnection } from "../src/connection.js";
import { noopNotifier } from "../src/notifier.js";
import { createProject } from "../src/data/projects.js";
import { upsertHost } from "../src/data/hosts.js";
import { getOldestPendingInteractionKindInputs } from "../src/data/pending-interactions.fork.js";
import { pendingInteractions } from "../src/schema.js";
import {
  createThread,
  listThreadsWithPendingInteractionState,
  listThreadsWithPendingInteractionStateForProjects,
} from "../src/data/threads.js";
import { createMigratedConnection } from "../src/testing.js";

interface SetupResult {
  db: DbConnection;
  project: { id: string };
}

function setup(): SetupResult {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, {
    name: "pending-kind-host",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "pending-kind-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/pending-kind" },
  });
  return { db, project };
}

function createProjectThread(
  db: DbConnection,
  project: { id: string },
  name: string,
) {
  return createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    title: name,
    titleFallback: name,
  });
}

function insertPendingInteraction(
  db: DbConnection,
  args: {
    id: string;
    threadId: string;
    payload: string;
    createdAt: number;
    status?: "pending" | "resolving" | "resolved";
  },
): void {
  db.insert(pendingInteractions)
    .values({
      id: args.id,
      threadId: args.threadId,
      originKind: "provider",
      turnId: `turn-${args.id}`,
      providerId: "codex",
      providerThreadId: `provider-thread-${args.id}`,
      providerRequestId: `request-${args.id}`,
      status: args.status ?? "pending",
      payload: args.payload,
      resolution: null,
      statusReason: null,
      createdAt: args.createdAt,
      expiresAt: null,
      resolvedAt: null,
      updatedAt: args.createdAt,
    })
    .run();
}

function planApprovalPayload(): string {
  return JSON.stringify({
    kind: "approval",
    subject: {
      kind: "plan",
      itemId: "item-plan",
      plan: "Rework the interaction glyphs",
      planFilePath: "/tmp/plan.md",
    },
    reason: null,
    availableDecisions: ["allow_once", "deny"],
  });
}

function commandApprovalPayload(): string {
  return JSON.stringify({
    kind: "approval",
    subject: {
      kind: "command",
      itemId: "item-command",
      command: "git push",
      cwd: "/tmp/project",
      actions: [],
      sessionGrant: null,
    },
    reason: null,
    availableDecisions: ["allow_once", "deny"],
  });
}

function userQuestionPayload(): string {
  return JSON.stringify({
    kind: "user_question",
    questions: [
      {
        id: "q0",
        prompt: "Which layout?",
        multiSelect: false,
        options: [{ value: "a", label: "A" }],
        allowFreeText: true,
      },
    ],
  });
}

function pluginPayload(): string {
  return JSON.stringify({ kind: "plugin", title: "Hold on", data: {} });
}

function extensionPayload(): string {
  return JSON.stringify({
    kind: "my-plugin/form",
    title: "Form",
    data: {},
  });
}

describe("oldest pending interaction kind", () => {
  it("classifies each payload kind through both read paths", () => {
    const { db, project } = setup();
    const planThread = createProjectThread(db, project, "plan");
    const commandThread = createProjectThread(db, project, "command");
    const questionThread = createProjectThread(db, project, "question");
    const pluginThread = createProjectThread(db, project, "plugin");
    const extensionThread = createProjectThread(db, project, "extension");
    const resolvedThread = createProjectThread(db, project, "resolved");
    const idleThread = createProjectThread(db, project, "idle");

    insertPendingInteraction(db, {
      id: "pint_plan_1",
      threadId: planThread.id,
      payload: planApprovalPayload(),
      createdAt: 100,
    });
    insertPendingInteraction(db, {
      id: "pint_command_1",
      threadId: commandThread.id,
      payload: commandApprovalPayload(),
      createdAt: 100,
    });
    insertPendingInteraction(db, {
      id: "pint_question_1",
      threadId: questionThread.id,
      payload: userQuestionPayload(),
      createdAt: 100,
    });
    insertPendingInteraction(db, {
      id: "pint_plugin_1",
      threadId: pluginThread.id,
      payload: pluginPayload(),
      createdAt: 100,
    });
    insertPendingInteraction(db, {
      id: "pint_extension_1",
      threadId: extensionThread.id,
      payload: extensionPayload(),
      createdAt: 100,
    });
    insertPendingInteraction(db, {
      id: "pint_resolved_1",
      threadId: resolvedThread.id,
      payload: planApprovalPayload(),
      createdAt: 100,
      status: "resolved",
    });

    const expected = new Map([
      [planThread.id, "plan_approval"],
      [commandThread.id, "approval"],
      [questionThread.id, "question"],
      [pluginThread.id, "question"],
      [extensionThread.id, "question"],
      [resolvedThread.id, null],
      [idleThread.id, null],
    ] as const);

    const listRows = listThreadsWithPendingInteractionState(db, {
      projectId: project.id,
      includeHidden: false,
    });
    const projectRows = listThreadsWithPendingInteractionStateForProjects(db, {
      projectIds: [project.id],
    });
    for (const rows of [listRows, projectRows]) {
      expect(
        new Map(rows.map((row) => [row.id, row.pendingInteractionKind])),
      ).toEqual(expected);
      expect(
        new Map(rows.map((row) => [row.id, row.hasPendingInteraction])),
      ).toEqual(
        new Map([...expected].map(([id, kind]) => [id, kind !== null])),
      );
    }

    for (const [threadId, kind] of expected) {
      if (kind === null) {
        expect(
          getOldestPendingInteractionKindInputs(db, threadId),
          threadId,
        ).toBeNull();
        continue;
      }
      expect(
        getOldestPendingInteractionKindInputs(db, threadId),
        threadId,
      ).toMatchObject({ payloadKind: expect.any(String) });
    }
    expect(
      getOldestPendingInteractionKindInputs(db, planThread.id)
        ?.approvalSubjectKind,
    ).toBe("plan");
    expect(
      getOldestPendingInteractionKindInputs(db, commandThread.id)
        ?.approvalSubjectKind,
    ).toBe("command");
    expect(
      getOldestPendingInteractionKindInputs(db, questionThread.id)?.payloadKind,
    ).toBe("user_question");

    db.$client.close();
  });

  it("reports the older pending row's kind when two rows disagree", () => {
    const { db, project } = setup();
    const thread = createProjectThread(db, project, "two-rows");
    insertPendingInteraction(db, {
      id: "pint_older_plan",
      threadId: thread.id,
      payload: planApprovalPayload(),
      createdAt: 100,
    });
    insertPendingInteraction(db, {
      id: "pint_newer_question",
      threadId: thread.id,
      payload: userQuestionPayload(),
      createdAt: 200,
    });

    expect(
      getOldestPendingInteractionKindInputs(db, thread.id)?.payloadKind,
    ).toBe("approval");
    expect(
      getOldestPendingInteractionKindInputs(db, thread.id)?.approvalSubjectKind,
    ).toBe("plan");
    expect(
      listThreadsWithPendingInteractionState(db, {
        projectId: project.id,
        includeHidden: false,
      }).find((row) => row.id === thread.id)?.pendingInteractionKind,
    ).toBe("plan_approval");

    db.$client.close();
  });

  it("classifies the newest pending row while an older resolving row is active", () => {
    const { db, project } = setup();
    const thread = createProjectThread(db, project, "resolving-vs-pending");
    insertPendingInteraction(db, {
      id: "pint_resolving_plan",
      threadId: thread.id,
      payload: planApprovalPayload(),
      createdAt: 100,
      status: "resolving",
    });
    insertPendingInteraction(db, {
      id: "pint_pending_question",
      threadId: thread.id,
      payload: userQuestionPayload(),
      createdAt: 200,
    });

    expect(getOldestPendingInteractionKindInputs(db, thread.id)).toEqual({
      payloadKind: "user_question",
      approvalSubjectKind: null,
    });
    expect(
      listThreadsWithPendingInteractionState(db, {
        projectId: project.id,
        includeHidden: false,
      }).find((row) => row.id === thread.id)?.pendingInteractionKind,
    ).toBe("question");
    expect(
      listThreadsWithPendingInteractionStateForProjects(db, {
        projectIds: [project.id],
      }).find((row) => row.id === thread.id)?.pendingInteractionKind,
    ).toBe("question");

    db.$client.close();
  });

  it("breaks created_at ties by ascending id through both read paths", () => {
    const { db, project } = setup();
    const thread = createProjectThread(db, project, "tiebreak");
    insertPendingInteraction(db, {
      id: "pint_b",
      threadId: thread.id,
      payload: userQuestionPayload(),
      createdAt: 500,
    });
    insertPendingInteraction(db, {
      id: "pint_a",
      threadId: thread.id,
      payload: planApprovalPayload(),
      createdAt: 500,
    });

    expect(getOldestPendingInteractionKindInputs(db, thread.id)).toEqual({
      payloadKind: "approval",
      approvalSubjectKind: "plan",
    });
    const listRow = listThreadsWithPendingInteractionState(db, {
      projectId: project.id,
      includeHidden: false,
    }).find((row) => row.id === thread.id);
    expect(listRow?.pendingInteractionKind).toBe("plan_approval");
    const projectRow = listThreadsWithPendingInteractionStateForProjects(db, {
      projectIds: [project.id],
    }).find((row) => row.id === thread.id);
    expect(projectRow?.pendingInteractionKind).toBe("plan_approval");

    db.$client.close();
  });

  it("falls back to the generic kind for corrupt or non-string payload kinds", () => {
    const { db, project } = setup();
    const corruptThread = createProjectThread(db, project, "corrupt");
    const numericKindThread = createProjectThread(db, project, "numeric");
    const healthyThread = createProjectThread(db, project, "healthy");
    insertPendingInteraction(db, {
      id: "pint_corrupt",
      threadId: corruptThread.id,
      payload: '{"kind":"approval","subject":',
      createdAt: 100,
    });
    insertPendingInteraction(db, {
      id: "pint_numeric",
      threadId: numericKindThread.id,
      payload: JSON.stringify({ kind: 42, questions: [] }),
      createdAt: 100,
    });
    insertPendingInteraction(db, {
      id: "pint_healthy",
      threadId: healthyThread.id,
      payload: userQuestionPayload(),
      createdAt: 100,
    });

    const rows = listThreadsWithPendingInteractionState(db, {
      projectId: project.id,
      includeHidden: false,
    });
    expect(
      new Map(rows.map((row) => [row.id, row.pendingInteractionKind])),
    ).toEqual(
      new Map([
        [corruptThread.id, "approval"],
        [numericKindThread.id, "approval"],
        [healthyThread.id, "question"],
      ]),
    );
    expect(getOldestPendingInteractionKindInputs(db, corruptThread.id)).toEqual(
      { payloadKind: null, approvalSubjectKind: null },
    );
    expect(
      getOldestPendingInteractionKindInputs(db, numericKindThread.id),
    ).toEqual({ payloadKind: null, approvalSubjectKind: null });

    db.$client.close();
  });
});
