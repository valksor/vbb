import { describe, expect, it } from "vitest";
import { threadScope, turnScope } from "@bb/domain";
import { noopNotifier } from "../../src/notifier.js";
import { createEnvironment } from "../../src/data/environments.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { insertEvents } from "../../src/data/events.js";
import {
  createPendingInteraction,
  setPendingInteractionResolved,
  setPendingInteractionResolving,
} from "../../src/data/pending-interactions.js";
import { listProviderTurnIdleWatchdogCandidates } from "../../src/data/provider-turn-watchdog.js";
import { advanceThreadPruning } from "../../src/data/thread-pruning.js";
import { deleteThread } from "../../src/data/threads.js";
import { listEvents } from "../../src/data/events.js";
import { createMigratedConnection } from "../../src/testing.js";

const emptyItemFields = {
  itemId: null,
  itemKind: null,
  parentToolCallId: null,
} as const;

const NOW = 1_000_000;
const THRESHOLD = 1_000;
const INTERRUPT_THRESHOLD = 2_000;

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "host-a" });
  const { project } = createProject(db, noopNotifier, {
    name: "project-a",
    source: { type: "local_path", hostId: host.id, path: "/tmp/a" },
  });
  const environment = createEnvironment(db, noopNotifier, {
    providerOwnsPath: false,
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/a",
  });
  const thread = createThread(db, noopNotifier, {
    environmentId: environment.id,
    projectId: project.id,
    providerId: "codex",
    status: "active",
  });
  return { db, environment, host, project, thread };
}

interface EventInput {
  sequence: number;
  type: string;
  createdAt: number;
  turnId?: string;
}

function seed(
  db: ReturnType<typeof setup>["db"],
  threadId: string,
  events: EventInput[],
): void {
  insertEvents(
    db,
    noopNotifier,
    events.map((event) => ({
      threadId,
      sequence: event.sequence,
      type: event.type as never,
      scope: event.turnId ? turnScope(event.turnId) : threadScope(),
      createdAt: event.createdAt,
      environmentId: null,
      providerThreadId: null,
      ...emptyItemFields,
      data: JSON.stringify({}),
    })),
  );
}

function listCandidates(db: ReturnType<typeof setup>["db"]) {
  return listProviderTurnIdleWatchdogCandidates(db, {
    idleThresholdMs: THRESHOLD,
    interruptThresholdMs: INTERRUPT_THRESHOLD,
    limit: 25,
    now: NOW,
  });
}

describe("listProviderTurnIdleWatchdogCandidates", () => {
  it.each([
    { createdAt: NOW - THRESHOLD, name: "at the threshold", expected: 1 },
    {
      createdAt: NOW - THRESHOLD + 1,
      name: "just below the threshold",
      expected: 0,
    },
  ])("flags an active turn idle $name", ({ createdAt, expected }) => {
    const { db, thread } = setup();
    seed(db, thread.id, [
      { sequence: 1, type: "turn/started", createdAt, turnId: "turn-1" },
    ]);

    const candidates = listCandidates(db);
    expect(candidates).toHaveLength(expected);
    if (expected === 1) {
      expect(candidates[0]).toMatchObject({
        threadId: thread.id,
        activeTurnId: "turn-1",
        hasPriorWatchdogEvent: false,
        elapsedMs: THRESHOLD,
      });
    }
  });

  it("excludes a turn with recent activity (streaming)", () => {
    const { db, thread } = setup();
    seed(db, thread.id, [
      { sequence: 1, type: "turn/started", createdAt: NOW - 2_000, turnId: "turn-1" },
      {
        sequence: 2,
        type: "item/agentMessage/delta",
        createdAt: NOW - 500,
        turnId: "turn-1",
      },
    ]);

    expect(listCandidates(db)).toHaveLength(0);
  });

  it.each([
    {
      event: {
        type: "item/agentMessage/delta",
        turnId: "turn-1",
      },
      expected: 0,
      name: "recent qualifying activity",
    },
    {
      event: { type: "system/notice", turnId: undefined },
      expected: 1,
      name: "a recent unrelated system notice",
    },
  ])("distinguishes $name", ({ event, expected }) => {
    const { db, thread } = setup();
    seed(db, thread.id, [
      {
        sequence: 1,
        type: "turn/started",
        createdAt: NOW - 2_000,
        turnId: "turn-1",
      },
      {
        sequence: 2,
        type: event.type,
        createdAt: NOW - THRESHOLD + 1,
        ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
      },
    ]);

    expect(listCandidates(db)).toHaveLength(expected);
  });

  it("excludes a turn awaiting a pending interaction", () => {
    const { db, thread } = setup();
    seed(db, thread.id, [
      { sequence: 1, type: "turn/started", createdAt: NOW - 2_000, turnId: "turn-1" },
    ]);
    createPendingInteraction(db, {
      threadId: thread.id,
      turnId: "turn-1",
      providerId: "codex",
      providerThreadId: "provider-thread-1",
      providerRequestId: "request-1",
      payload: JSON.stringify({ subject: { kind: "command" } }),
    });

    expect(listCandidates(db)).toHaveLength(0);
  });

  it.each([
    {
      expected: 0,
      name: "a pending interaction on the active turn",
      transition: "pending",
      turnId: "turn-1",
    },
    {
      expected: 0,
      name: "a resolving interaction on the active turn",
      transition: "resolving",
      turnId: "turn-1",
    },
    {
      expected: 1,
      name: "a resolved interaction on the active turn",
      transition: "resolved",
      turnId: "turn-1",
    },
    {
      expected: 1,
      name: "a pending interaction on another turn",
      transition: "pending",
      turnId: "turn-other",
    },
  ])("$name does not change the wrong candidate set", ({
    expected,
    transition,
    turnId,
  }) => {
    const { db, thread } = setup();
    seed(db, thread.id, [
      {
        sequence: 1,
        type: "turn/started",
        createdAt: NOW - 2_000,
        turnId: "turn-1",
      },
    ]);
    const interaction = createPendingInteraction(db, {
      threadId: thread.id,
      turnId,
      providerId: "codex",
      providerThreadId: "provider-thread-1",
      providerRequestId: "request-1",
      payload: JSON.stringify({ subject: { kind: "command" } }),
    });
    if (transition === "resolving") {
      setPendingInteractionResolving(db, {
        id: interaction.id,
        resolution: "approved",
      });
    }
    if (transition === "resolved") {
      setPendingInteractionResolved(db, {
        id: interaction.id,
        resolution: "approved",
      });
    }

    expect(listCandidates(db)).toHaveLength(expected);
  });

  it("excludes a turn that already completed", () => {
    const { db, thread } = setup();
    seed(db, thread.id, [
      { sequence: 1, type: "turn/started", createdAt: NOW - 2_000, turnId: "turn-1" },
      {
        sequence: 2,
        type: "turn/completed",
        createdAt: NOW - 1_900,
        turnId: "turn-1",
      },
    ]);

    expect(listCandidates(db)).toHaveLength(0);
  });

  it("marks hasPriorWatchdogEvent once a watchdog event exists in the turn", () => {
    const { db, thread } = setup();
    seed(db, thread.id, [
      { sequence: 1, type: "turn/started", createdAt: NOW - 2_000, turnId: "turn-1" },
      {
        sequence: 2,
        type: "system/provider-turn-watchdog",
        createdAt: NOW - 1_000,
      },
    ]);

    const candidates = listCandidates(db);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.hasPriorWatchdogEvent).toBe(true);
  });

  it("skips notified candidates below interruption before applying the limit", () => {
    const { db, environment, project, thread } = setup();
    const notifiedThreads = Array.from({ length: 25 }, (_, index) =>
      index === 0
        ? thread
        : createThread(db, noopNotifier, {
            environmentId: environment.id,
            projectId: project.id,
            providerId: "codex",
            status: "active",
          }),
    );
    const actionableThread = createThread(db, noopNotifier, {
      environmentId: environment.id,
      projectId: project.id,
      providerId: "codex",
      status: "active",
    });

    for (const [index, notifiedThread] of notifiedThreads.entries()) {
      seed(db, notifiedThread.id, [
        {
          sequence: 1,
          type: "turn/started",
          createdAt: NOW - 1_500 - index,
          turnId: `turn-notified-${index}`,
        },
        {
          sequence: 2,
          type: "system/provider-turn-watchdog",
          createdAt: NOW - 1_000 - index,
        },
      ]);
    }
    seed(db, actionableThread.id, [
      {
        sequence: 1,
        type: "turn/started",
        createdAt: NOW - 1_500 - notifiedThreads.length,
        turnId: "turn-actionable",
      },
    ]);

    expect(listCandidates(db).map((candidate) => candidate.threadId)).toEqual([
      actionableThread.id,
    ]);
    expect(
      listProviderTurnIdleWatchdogCandidates(db, {
        idleThresholdMs: THRESHOLD,
        interruptThresholdMs: THRESHOLD,
        limit: 25,
        now: NOW,
      }).map((candidate) => candidate.threadId),
    ).toHaveLength(25);
  });

  it("retains watchdog history through ordinary pruning and cascades it on thread deletion", () => {
    const { db, environment, project, thread } = setup();
    const unrelatedThread = createThread(db, noopNotifier, {
      environmentId: environment.id,
      projectId: project.id,
      providerId: "codex",
      status: "idle",
    });
    for (const currentThread of [thread, unrelatedThread]) {
      seed(db, currentThread.id, [
        {
          sequence: 1,
          type: "turn/started",
          createdAt: NOW - 2_000,
          turnId: `turn-${currentThread.id}`,
        },
        {
          sequence: 2,
          type: "system/provider-turn-watchdog",
          createdAt: NOW - 1_500,
        },
      ]);
    }

    advanceThreadPruning(db, { threadId: thread.id });
    expect(listEvents(db, { threadId: thread.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "system/provider-turn-watchdog" }),
      ]),
    );

    expect(deleteThread(db, noopNotifier, thread.id)).toBe(true);
    expect(listEvents(db, { threadId: thread.id })).toEqual([]);
    expect(listEvents(db, { threadId: unrelatedThread.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "system/provider-turn-watchdog" }),
      ]),
    );
  });
});
