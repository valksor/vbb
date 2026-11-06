import { listEvents, listQueuedThreadMessages } from "@bb/db";
import type {
  QueuedMessageWaitingOn,
  ThreadQueuedMessage,
} from "@bb/domain";
import type {
  MessageDispatchHookContext,
  PluginHookName,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invokePluginInline,
  setPluginHookProvider,
  type PluginHookRegistration,
} from "../../src/services/plugins/plugin-hook-registry.js";
import { partitionWaiters } from "../../src/services/threads/dispatch-hooks.fork.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import { toThreadQueuedMessage } from "../../src/services/threads/thread-queued-messages.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/dispatch-hooks-project";

type HookRegistry = {
  [K in PluginHookName]: PluginHookRegistration<K>[];
};

function emptyRegistry(): HookRegistry {
  return { "message.dispatch": [] };
}

function installHooks(
  registry: HookRegistry,
  options: { decisionTimeoutMs?: number } = {},
): void {
  setPluginHookProvider({
    listHooks: (hook) => registry[hook],
    invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: options.decisionTimeoutMs ?? 10_000,
  });
}

afterEach(() => {
  setPluginHookProvider(undefined);
});

function seedDispatchFixture(harness: TestAppHarness, hostId: string) {
  const { host } = seedHostSession(harness.deps, { id: hostId });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: WORKSPACE_PATH,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: WORKSPACE_PATH,
  });
  return { environment, host, project };
}

function turnRequests(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId }).filter(
    (event) => event.type === "client/turn/requested",
  );
}

function queuedRows(
  harness: TestAppHarness,
  threadId: string,
): ThreadQueuedMessage[] {
  return listQueuedThreadMessages(harness.db, threadId)
    .map(toThreadQueuedMessage)
    .filter((entry) => entry.waitingOn !== null);
}

function onlyQueuedRow(
  harness: TestAppHarness,
  threadId: string,
): ThreadQueuedMessage {
  const rows = queuedRows(harness, threadId);
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error(`expected exactly one queued row, found ${rows.length}`);
  }
  return rows[0];
}

function seedRunnableThread(
  harness: TestAppHarness,
  args: { hostId: string; status: "idle" },
) {
  const { environment, project } = seedDispatchFixture(harness, args.hostId);
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: args.status,
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: `provider-${args.hostId}`,
    threadId: thread.id,
  });
  return { environment, project, thread };
}

function draftsWaitHandler(context: MessageDispatchHookContext) {
  const isDraft =
    context.experimental_submission?.pluginId === "drafts" ||
    context.queuedMessages.some(
      (message) =>
        message.waitingOn?.kind === "plugin" &&
        message.waitingOn.pluginId === "drafts",
    );
  return isDraft
    ? ({ action: "wait", reason: "Draft" } as const)
    : ({ action: "proceed" } as const);
}

type OwnerChoiceCase = {
  name: string;
  queued: QueuedMessageWaitingOn[];
  submissionId: string | undefined;
  waiterIndex: number | undefined;
  additionalIndexes: number[];
  emptyWaits?: boolean;
};

describe("message.dispatch hook composition", () => {
  it("gives the row to the submitting plugin when an earlier plugin also waits", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry["message.dispatch"].push(
        {
          pluginId: "limiter",
          handler: () => ({ action: "wait", reason: "at capacity" }) as const,
        },
        {
          pluginId: "drafts",
          handler: draftsWaitHandler,
        },
      );
      installHooks(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-hook-submission-owner",
        status: "idle",
      });

      await acceptThreadSendRequest(harness.deps, {
        payload: {
          input: textInput("queued draft"),
          mode: "auto",
          pluginSubmission: { pluginId: "drafts", data: { kind: "draft" } },
        },
        thread,
      });

      expect(onlyQueuedRow(harness, thread.id).waitingOn).toEqual({
        kind: "plugin",
        pluginId: "drafts",
        reason: "Draft (also waiting on limiter: at capacity)",
      });
    });
  });
});

describe("message.dispatch hooks on the queue drain", () => {
  it("keeps a held draft queued after an earlier waiter stops waiting", async () => {
    await withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        let atCapacity = true;
        let limiterCalls = 0;
        const registry = emptyRegistry();
        registry["message.dispatch"].push(
          {
            pluginId: "limiter",
            handler: () => {
              limiterCalls += 1;
              return atCapacity
                ? ({ action: "wait", reason: "at capacity" } as const)
                : ({ action: "proceed" } as const);
            },
          },
          { pluginId: "drafts", handler: draftsWaitHandler },
        );
        installHooks(registry);
        const { thread } = seedRunnableThread(harness, {
          hostId: "host-draft-hold-drain",
          status: "idle",
        });
        const turnsBefore = turnRequests(harness, thread.id).length;

        seedQueuedMessage(harness.deps, {
          content: textInput("queued draft"),
          threadId: thread.id,
          waitingOn: { kind: "plugin", pluginId: "drafts", reason: "Draft" },
        });
        expect(onlyQueuedRow(harness, thread.id).waitingOn).toMatchObject({
          pluginId: "drafts",
        });
        expect(turnRequests(harness, thread.id)).toHaveLength(turnsBefore);

        const callsBeforeFirstRecheck = limiterCalls;
        await runQueuedMessageDispatch(harness.deps, {
          kind: "plugin-recheck",
        });
        expect(limiterCalls).toBeGreaterThan(callsBeforeFirstRecheck);
        expect(onlyQueuedRow(harness, thread.id).waitingOn).toMatchObject({
          pluginId: "drafts",
        });

        atCapacity = false;
        vi.setSystemTime(Date.now() + 1_100);
        const callsBeforeSecondRecheck = limiterCalls;
        await runQueuedMessageDispatch(harness.deps, {
          kind: "plugin-recheck",
        });
        expect(limiterCalls).toBeGreaterThan(callsBeforeSecondRecheck);
        expect(onlyQueuedRow(harness, thread.id).waitingOn).toMatchObject({
          pluginId: "drafts",
        });
        expect(turnRequests(harness, thread.id)).toHaveLength(turnsBefore);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("dispatch wait owner selection", () => {
  const cases: OwnerChoiceCase[] = [
    {
      name: "no owner",
      queued: [],
      submissionId: undefined,
      waiterIndex: 0,
      additionalIndexes: [1, 2],
    },
    {
      name: "missing submission owner",
      queued: [],
      submissionId: "unknown",
      waiterIndex: 0,
      additionalIndexes: [1, 2],
    },
    {
      name: "owner already first",
      queued: [],
      submissionId: "limiter",
      waiterIndex: 0,
      additionalIndexes: [1, 2],
    },
    {
      name: "submission owner later",
      queued: [],
      submissionId: "drafts",
      waiterIndex: 1,
      additionalIndexes: [0, 2],
    },
    {
      name: "durable owner wins",
      queued: [{ kind: "plugin", pluginId: "drafts", reason: "Draft" }],
      submissionId: "quiet-hours",
      waiterIndex: 1,
      additionalIndexes: [0, 2],
    },
    {
      name: "unmatched durable owner",
      queued: [{ kind: "plugin", pluginId: "unknown", reason: "Unknown" }],
      submissionId: "drafts",
      waiterIndex: 0,
      additionalIndexes: [1, 2],
    },
    {
      name: "non-plugin first row",
      queued: [{ kind: "thread-busy" }],
      submissionId: "drafts",
      waiterIndex: 1,
      additionalIndexes: [0, 2],
    },
    {
      name: "later row ignored",
      queued: [
        { kind: "thread-busy" },
        { kind: "plugin", pluginId: "drafts", reason: "Draft" },
      ],
      submissionId: "quiet-hours",
      waiterIndex: 2,
      additionalIndexes: [0, 1],
    },
    {
      name: "empty wait set",
      queued: [{ kind: "plugin", pluginId: "drafts", reason: "Draft" }],
      submissionId: "drafts",
      waiterIndex: undefined,
      additionalIndexes: [],
      emptyWaits: true,
    },
  ];

  it.each(cases)("$name", async (testCase) => {
    await withTestHarness(async (harness) => {
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-wait-owner-table",
        status: "idle",
      });
      const queuedMessages = testCase.queued.map((waitingOn) =>
        toThreadQueuedMessage(
          seedQueuedMessage(harness.deps, {
            content: textInput("queued message"),
            threadId: thread.id,
            waitingOn,
          }),
        ),
      );
      const waits = testCase.emptyWaits
        ? []
        : [
            { pluginId: "limiter", reason: "Capacity", sendAt: 101 },
            { pluginId: "drafts", reason: "Draft", sendAt: 202 },
            { pluginId: "quiet-hours", reason: "Quiet", sendAt: 303 },
          ];
      const { waiter, additionalWaiters } = partitionWaiters(
        {
          queuedMessages,
          pluginSubmission:
            testCase.submissionId === undefined
              ? undefined
              : { pluginId: testCase.submissionId },
        },
        waits,
      );

      expect(waiter).toBe(
        testCase.waiterIndex === undefined
          ? undefined
          : waits[testCase.waiterIndex],
      );
      expect(additionalWaiters).toHaveLength(testCase.additionalIndexes.length);
      testCase.additionalIndexes.forEach((waiterIndex, index) => {
        expect(additionalWaiters[index]).toBe(waits[waiterIndex]);
      });
    });
  });
});
