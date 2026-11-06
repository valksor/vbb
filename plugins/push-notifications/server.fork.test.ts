import type { PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { EnvHttpProxyAgent } from "undici";
import { describe, expect, it, vi } from "vitest";
import { CLIENT_NOTIFICATION_CHANNEL } from "./contract.js";
import { createPushNotificationsPlugin } from "./server.js";
import type {
  ExpoAlertPushMessage,
  ExpoPushMessage,
  PushSenderFetch,
} from "./sender.js";

type ThreadResponse = PluginThreadEventPayloads["thread.idle"]["thread"];
type PendingInteraction =
  PluginThreadEventPayloads["interaction.pending"]["interaction"];

const COALESCE_MS = 10;
const CHILD_STATES = [
  { name: "starting", status: "starting", queued: "none", silent: true },
  { name: "active", status: "active", queued: "none", silent: true },
  { name: "stopping", status: "stopping", queued: "none", silent: true },
  {
    name: "pending+waiting",
    status: "pending",
    queued: "waiting",
    silent: true,
  },
  { name: "idle", status: "idle", queued: "none", silent: false },
  { name: "error", status: "error", queued: "none", silent: false },
  { name: "pending+none", status: "pending", queued: "none", silent: false },
  {
    name: "pending+failed",
    status: "pending",
    queued: "failed",
    silent: false,
  },
] as const;
const EXPO_URL = "http://expo.test/push";

interface FakeExpo {
  fetch: PushSenderFetch;
  requests: ExpoPushMessage[][];
}

function createFakeExpo(): FakeExpo {
  const requests: ExpoPushMessage[][] = [];
  const fetch: PushSenderFetch = async (url, init) => {
    expect(url).toBe(EXPO_URL);
    expect(init.dispatcher).toBeInstanceOf(EnvHttpProxyAgent);
    const messages = JSON.parse(init.body) as ExpoPushMessage[];
    requests.push(messages);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: messages.map((message) => ({
            status: "ok",
            id: `ticket-${message.to}`,
          })),
        }),
    };
  };
  return { fetch, requests };
}

function alertMessage(
  message: ExpoPushMessage | undefined,
): ExpoAlertPushMessage {
  if (message === undefined || !("title" in message)) {
    throw new Error("Expected an alert push message");
  }
  return message;
}

function pendingQuestion(threadId: string, prompt: string): PendingInteraction {
  return {
    id: `interaction-${threadId}`,
    threadId,
    status: "pending",
    statusReason: null,
    createdAt: 1,
    expiresAt: null,
    resolvedAt: null,
    turnId: `turn-${threadId}`,
    providerId: "codex",
    providerThreadId: `provider-${threadId}`,
    providerRequestId: `request-${threadId}`,
    origin: {
      kind: "provider",
      providerId: "codex",
      providerThreadId: `provider-${threadId}`,
      providerRequestId: `request-${threadId}`,
    },
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "question-1",
          prompt,
          multiSelect: false,
          allowFreeText: true,
          required: true,
        },
      ],
    },
    resolution: null,
  };
}

async function setup() {
  const expo = createFakeExpo();
  const threads = new Map<string, ThreadResponse>();
  const interactions = new Map<string, PendingInteraction[]>();
  const metadata = new Map<string, Record<string, unknown>>();
  const queuedWork = new Map<string, "none" | "waiting" | "failed">();
  const listCalls: (string | undefined)[] = [];
  const listFailure: { error: Error | null } = { error: null };
  let nextId = 1;
  const listAncestors = vi.fn(
    async ({ threadIds }: { threadIds: readonly string[] }) => ({
      threads: [...new Set(threadIds)].flatMap((threadId) => {
        if (!threads.has(threadId)) return [];
        const ancestorIds: string[] = [];
        let parentId = threads.get(threadId)?.parentThreadId ?? null;
        while (parentId !== null && threads.has(parentId)) {
          ancestorIds.push(parentId);
          parentId = threads.get(parentId)?.parentThreadId ?? null;
        }
        return [{ threadId, ancestorIds }];
      }),
    }),
  );
  const fake = createFakePluginHost({
    pluginId: "push-notifications",
    settings: { expoPushUrl: EXPO_URL },
    sdk: {
      threads: {
        get: async ({ threadId }) => {
          const thread = threads.get(threadId);
          if (!thread) throw new Error("Thread not found");
          return thread;
        },
        experimental_listAncestors: listAncestors,
        experimental_listDescendants: async ({
          threadIds,
          includeArchived = false,
          includeHidden = false,
        }) => ({
          threads: [...new Set(threadIds)].flatMap((threadId) => {
            if (!threads.has(threadId)) return [];
            const walked: ThreadResponse[] = [];
            for (let index = -1; index < walked.length; index += 1) {
              const parentId = index < 0 ? threadId : walked[index]?.id;
              for (const thread of threads.values()) {
                if (thread.parentThreadId === parentId) walked.push(thread);
              }
            }
            const descendantIds = walked
              .filter(
                (thread) =>
                  (includeArchived || thread.archivedAt === null) &&
                  (includeHidden || thread.visibility === "visible"),
              )
              .map((thread) => thread.id);
            return [{ threadId, descendantIds }];
          }),
        }),
        getPluginMetadata: async ({ threadId }) => {
          if (!threads.has(threadId)) throw new Error("Thread not found");
          return metadata.get(threadId) ?? {};
        },
        updatePluginMetadata: async ({ threadId, set, remove }) => {
          if (!threads.has(threadId)) throw new Error("Thread not found");
          const next = { ...(metadata.get(threadId) ?? {}), ...set };
          for (const key of remove ?? []) delete next[key];
          if (Object.keys(next).length === 0) metadata.delete(threadId);
          else metadata.set(threadId, next);
          return next;
        },
        experimental_listPluginMetadata: async ({ threadIds }) => ({
          threads: threadIds.flatMap((threadId) => {
            const value = metadata.get(threadId);
            return value === undefined ? [] : [{ threadId, metadata: value }];
          }),
        }),
        list: async (filter) => {
          listCalls.push(filter?.parentThreadId);
          if (listFailure.error) throw listFailure.error;
          return [...threads.values()]
            .filter(
              (thread) =>
                (filter?.parentThreadId === undefined ||
                  thread.parentThreadId === filter.parentThreadId) &&
                (filter?.archived !== false || thread.archivedAt === null) &&
                (filter?.includeHidden === true ||
                  thread.visibility === "visible"),
            )
            .map((thread) => ({
              ...thread,
              queuedWork: queuedWork.get(thread.id) ?? "none",
            }));
        },
        interactions: {
          list: async ({ threadId }) => interactions.get(threadId) ?? [],
        },
      },
    },
  });
  await createPushNotificationsPlugin({
    coalesceMs: COALESCE_MS,
    createId: () => `subscription-${nextId++}`,
    fetch: expo.fetch,
  })(fake.bb);

  async function addSubscription(
    expoPushToken = "ExponentPushToken[phone]",
    deviceLabel = "Phone",
  ) {
    return fake.harness.behavior.callRpc("pushSubscriptions.add", {
      expoPushToken,
      platform: "ios",
      deviceLabel,
    });
  }

  function setThread(overrides: Partial<ThreadResponse> = {}) {
    const thread = makeThreadResponse({
      id: `thread-${threads.size + 1}`,
      projectId: "project-1",
      status: "idle",
      title: "Fix the flaky test",
      latestAttentionAt: 100,
      ...overrides,
    });
    threads.set(thread.id, thread);
    return thread;
  }

  const service = fake.harness.behavior.runService("push-sender");

  async function stopService() {
    service.controller.abort();
    await service.done;
  }

  async function cleanup() {
    await stopService();
    await fake.harness.lifecycle.dispose();
  }

  async function setLevel(threadId: string, level: string) {
    return fake.harness.behavior.callRpc("threadNotifications.set", {
      threadId,
      level,
    });
  }

  function signals(channel: string) {
    return fake.harness.realtimeSignals.filter(
      (signal) => signal.channel === channel,
    );
  }

  return {
    ...fake,
    addSubscription,
    cleanup,
    clientSignals: () => signals(CLIENT_NOTIFICATION_CHANNEL),
    expo,
    interactions,
    setLevel,
    listCalls,
    listFailure,
    queuedWork,
    setThread,
    stopService,
    threads,
  };
}

async function waitForCoalesce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, COALESCE_MS * 4));
}

describe("push sender", () => {
  it("sends distinct provider turn watchdog notifications", async () => {
    const host = await setup();
    try {
      await host.addSubscription();
      const stalled = host.setThread({ status: "active" });
      await host.harness.behavior.emitThreadEvent(
        "experimental_thread.turnWatchdog",
        {
          thread: stalled,
          action: "notify",
          elapsedMs: 6 * 60 * 60_000,
          thresholdMs: 6 * 60 * 60_000,
        },
      );

      await vi.waitFor(() => expect(host.expo.requests).toHaveLength(1));
      expect(host.expo.requests[0]?.[0]).toMatchObject({
        body: "Turn stalled — no activity for 6 hours",
        data: { kind: "turn-watchdog", threadId: stalled.id },
      });

      const stopped = host.setThread({ status: "stopping" });
      await host.harness.behavior.emitThreadEvent(
        "experimental_thread.turnWatchdog",
        {
          thread: stopped,
          action: "interrupt",
          elapsedMs: 12 * 60 * 60_000,
          thresholdMs: 12 * 60 * 60_000,
        },
      );

      await vi.waitFor(() => expect(host.expo.requests).toHaveLength(2));
      expect(host.expo.requests[1]?.[0]).toMatchObject({
        body: "bb stopped a stalled turn after 12 hours",
        data: { kind: "turn-watchdog", threadId: stopped.id },
      });
    } finally {
      await host.cleanup();
    }
  });

  it.each(CHILD_STATES)(
    "idle parent with a child that is $name: silent=$silent",
    async ({ status, queued, silent }) => {
      const host = await setup();
      try {
        await host.addSubscription();
        const parent = host.setThread({ id: "parent" });
        host.setThread({ id: "child", parentThreadId: parent.id, status });
        host.queuedWork.set("child", queued);

        await host.harness.behavior.emitThreadEvent("thread.idle", {
          thread: parent,
          lastAssistantText: "Parent turn done",
        });
        await vi.waitFor(() => expect(host.listCalls).toContain(parent.id));
        if (silent) {
          await waitForCoalesce();
          expect(host.expo.requests).toEqual([]);
          expect(host.harness.realtimeSignals).toEqual([]);
        } else {
          await vi.waitFor(() => expect(host.expo.requests).toHaveLength(1));
          expect(host.expo.requests[0]?.[0]).toMatchObject({
            body: "Parent turn done",
            data: { kind: "turn-finished", threadId: parent.id },
          });
          expect(host.harness.realtimeSignals).toHaveLength(1);
        }
      } finally {
        await host.cleanup();
      }
    },
  );

  it.each([
    {
      name: "an unrelated top-level thread",
      overrides: { id: "other", status: "active" as const },
    },
    {
      name: "another parent's child",
      overrides: {
        id: "other",
        parentThreadId: "someone-else",
        status: "active" as const,
      },
    },
    {
      name: "a running grandchild below an idle child",
      overrides: {
        id: "other",
        parentThreadId: "child",
        status: "active" as const,
      },
    },
    {
      name: "a hidden child",
      overrides: {
        id: "other",
        parentThreadId: "parent",
        status: "active" as const,
        visibility: "hidden" as const,
      },
    },
    {
      name: "an archived child",
      overrides: {
        id: "other",
        parentThreadId: "parent",
        status: "active" as const,
        archivedAt: 5,
      },
    },
  ])("does not mute an idle parent because of $name", async ({ overrides }) => {
    const host = await setup();
    try {
      await host.addSubscription();
      const parent = host.setThread({ id: "parent" });
      if (
        "parentThreadId" in overrides &&
        overrides.parentThreadId === "child"
      ) {
        host.setThread({
          id: "child",
          parentThreadId: parent.id,
          status: "idle",
        });
      }
      host.setThread(overrides);

      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: parent,
        lastAssistantText: "Parent turn done",
      });
      await vi.waitFor(() => expect(host.listCalls).toContain(parent.id));
      await vi.waitFor(() => expect(host.expo.requests).toHaveLength(1));
      expect(host.expo.requests[0]?.[0]).toMatchObject({
        data: { kind: "turn-finished", threadId: parent.id },
      });
      expect(host.clientSignals()).toHaveLength(1);
    } finally {
      await host.cleanup();
    }
  });

  it("fails open when the child lookup rejects", async () => {
    const host = await setup();
    try {
      await host.addSubscription();
      host.listFailure.error = new Error("list unavailable");
      const parent = host.setThread({ id: "parent" });
      host.setThread({
        id: "child",
        parentThreadId: parent.id,
        status: "active",
      });

      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: parent,
        lastAssistantText: "Parent turn done",
      });
      await vi.waitFor(() => expect(host.expo.requests).toHaveLength(1));
      expect(host.expo.requests[0]?.[0]).toMatchObject({
        body: "Parent turn done",
        data: { kind: "turn-finished", threadId: parent.id },
      });
      expect(host.listCalls).toContain(parent.id);

      const asking = host.setThread({ id: "asking" });
      const interaction = pendingQuestion(asking.id, "Proceed?");
      host.interactions.set(asking.id, [interaction]);
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: asking,
        lastAssistantText: "Waiting",
      });
      await host.harness.behavior.emitThreadEvent("interaction.pending", {
        thread: asking,
        interaction,
      });
      await vi.waitFor(() => expect(host.expo.requests).toHaveLength(2));
      expect(host.expo.requests[1]?.[0]).toMatchObject({
        body: "Proceed?",
        data: { kind: "pending-interaction", threadId: asking.id },
      });
    } finally {
      await host.cleanup();
    }
  });

  it("still sends the pending-interaction push for a parent with a running child", async () => {
    const host = await setup();
    try {
      await host.addSubscription();
      const parent = host.setThread({ id: "parent" });
      host.setThread({
        id: "child",
        parentThreadId: parent.id,
        status: "active",
      });
      const interaction = pendingQuestion(parent.id, "Proceed?");
      host.interactions.set(parent.id, [interaction]);

      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: parent,
        lastAssistantText: "Waiting on the child",
      });
      await host.harness.behavior.emitThreadEvent("interaction.pending", {
        thread: parent,
        interaction,
      });
      await vi.waitFor(() => expect(host.expo.requests).toHaveLength(1));
      expect(host.expo.requests[0]?.[0]).toMatchObject({
        body: "Proceed?",
        data: { kind: "pending-interaction", threadId: parent.id },
      });
      expect(host.listCalls).toEqual([]);
    } finally {
      await host.cleanup();
    }
  });

  it("notifies on a later parent completion after the immediate child becomes idle", async () => {
    const host = await setup();
    try {
      await host.addSubscription();
      const parent = host.setThread({ id: "parent" });
      const child = host.setThread({
        id: "child",
        parentThreadId: parent.id,
        status: "active",
      });
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: parent,
        lastAssistantText: "Waiting on the child",
      });
      await waitForCoalesce();
      expect(host.expo.requests).toEqual([]);
      expect(host.clientSignals()).toEqual([]);
      host.threads.set(child.id, { ...child, status: "idle" });
      await waitForCoalesce();
      expect(host.expo.requests).toEqual([]);
      expect(host.clientSignals()).toEqual([]);
      await host.harness.behavior.emitThreadEvent("thread.idle", {
        thread: parent,
        lastAssistantText: "Parent finished after the child",
      });
      await vi.waitFor(() => expect(host.expo.requests).toHaveLength(1));
      expect(host.expo.requests[0]?.[0]).toMatchObject({
        body: "Parent finished after the child",
        data: { kind: "turn-finished", threadId: parent.id },
      });
      expect(host.clientSignals()).toHaveLength(1);
    } finally {
      await host.cleanup();
    }
  });

  it.each(["thread-error", "turn-watchdog"] as const)(
    "still sends %s while an immediate child is running",
    async (kind) => {
      const host = await setup();
      try {
        await host.addSubscription();
        const parent = host.setThread({
          id: "parent",
          status: kind === "thread-error" ? "error" : "active",
        });
        host.setThread({
          id: "child",
          parentThreadId: parent.id,
          status: "active",
        });
        if (kind === "thread-error") {
          await host.harness.behavior.emitThreadEvent("thread.failed", {
            thread: parent,
            error: "Parent failed",
          });
        } else {
          await host.harness.behavior.emitThreadEvent(
            "experimental_thread.turnWatchdog",
            {
              thread: parent,
              action: "notify",
              elapsedMs: 6 * 60 * 60_000,
              thresholdMs: 6 * 60 * 60_000,
            },
          );
        }
        await vi.waitFor(() => expect(host.expo.requests).toHaveLength(1));
        expect(host.expo.requests[0]?.[0]).toMatchObject({
          body:
            kind === "thread-error"
              ? "Parent failed"
              : "Turn stalled — no activity for 6 hours",
          data: { kind, threadId: parent.id },
        });
        expect(host.clientSignals()).toHaveLength(1);
        expect(host.listCalls).toEqual([]);
      } finally {
        await host.cleanup();
      }
    },
  );

  it.each([
    {
      action: "notify",
      body: "Turn stalled — no activity for 6 hours",
      thresholdMs: 6 * 60 * 60_000,
    },
    {
      action: "interrupt",
      body: "bb stopped a stalled turn after 12 hours",
      thresholdMs: 12 * 60 * 60_000,
    },
  ] as const)(
    "delivers the $action watchdog action only to all and input-only threads",
    async ({ action, body, thresholdMs }) => {
      const host = await setup();
      try {
        await host.addSubscription();
        const all = host.setThread({
          id: `watchdog-all-${action}`,
          status: "active",
        });
        const inputOnly = host.setThread({
          id: `watchdog-input-${action}`,
          status: "active",
        });
        const muted = host.setThread({
          id: `watchdog-muted-${action}`,
          status: "active",
        });
        await host.setLevel(inputOnly.id, "input-only");
        await host.setLevel(muted.id, "muted");

        for (const thread of [all, inputOnly, muted]) {
          await host.harness.behavior.emitThreadEvent(
            "experimental_thread.turnWatchdog",
            {
              thread,
              action,
              elapsedMs: thresholdMs,
              thresholdMs,
            },
          );
        }

        await vi.waitFor(() => expect(host.expo.requests).toHaveLength(2));
        const messages = host.expo.requests.flat().map(alertMessage);
        expect(messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              body,
              data: expect.objectContaining({
                kind: "turn-watchdog",
                threadId: all.id,
              }),
            }),
            expect.objectContaining({
              body,
              data: expect.objectContaining({
                kind: "turn-watchdog",
                threadId: inputOnly.id,
              }),
            }),
          ]),
        );
        expect(messages.map((message) => message.data.threadId)).not.toContain(
          muted.id,
        );
      } finally {
        await host.cleanup();
      }
    },
  );
});
