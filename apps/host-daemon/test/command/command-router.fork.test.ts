import {
  hostDaemonCommandQuiescePolicyByType,
  hostDaemonCommandRegistry,
  type HostDaemonCommand,
  type HostDaemonOnlineRpcRequestMessage,
  type HostDaemonOnlineRpcResponseMessage,
  type HostDaemonRpcCommand,
} from "@bb/host-daemon-contract";
import {
  encodeClientTurnRequestIdNumber,
  type ClientTurnRequestId,
  type PromptInput,
} from "@bb/domain";
import { createDeferredPromise } from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
import { CommandRouter } from "../../src/command-router.js";
import {
  createHarness,
  noopEventSink,
  unexpectedProjectAttachmentFetch,
  unexpectedProviderMaintenance,
  DISPATCH_TEST_BRIDGE_LAUNCH,
  fetchDispatchTestArtifact,
} from "./dispatch-helpers.js";

type RouterHarness = ReturnType<typeof createHarness>;
type TextPromptInput = Extract<PromptInput, { type: "text" }>;
type ThreadStartCommand = Extract<HostDaemonCommand, { type: "thread.start" }>;

interface RunRouterCommandArgs {
  command: HostDaemonRpcCommand;
  requestId: string;
  router: CommandRouter;
}

let nextClientRequestIdValue = 1;

function createClientRequestId(): ClientTurnRequestId {
  const requestId = encodeClientTurnRequestIdNumber({
    value: nextClientRequestIdValue,
  });
  nextClientRequestIdValue += 1;
  return requestId;
}

function createRouter(harness: RouterHarness): CommandRouter {
  return new CommandRouter({
    dataDir: "/tmp/bb-router-test-data",
    eventSink: noopEventSink,
    fetchProjectAttachment: unexpectedProjectAttachmentFetch,
    fetchPluginHostArtifact: fetchDispatchTestArtifact,
    ...unexpectedProviderMaintenance,
    logger: {
      debug: () => undefined,
      warn: () => undefined,
    },
    runtimeManager: harness.manager,
    threadStorageRootPath: "/tmp/bb-router-test-thread-storage",
  });
}

function createThreadStartCommand(): ThreadStartCommand {
  return {
    bridgeLaunch: DISPATCH_TEST_BRIDGE_LAUNCH,
    type: "thread.start",
    environmentId: "env-router",
    threadId: "thread-router-start",
    workspaceContext: {
      workspacePath: "/tmp/env-router",
    },
    projectId: "project-router",
    providerId: "fake",
    requestId: createClientRequestId(),
    input: [textPromptInput("start")],
    options: {
      model: "gpt-5",
      serviceTier: "default",
      reasoningLevel: "medium",
      providerOptions: {},
      permissionMode: "full",
      permissionScope: "full",
      approvalReviewer: null,
      permissionEscalation: null,
    },
    instructions: "Be a helpful coding agent.",
    dynamicTools: [],
    contributedEnv: [],
    injectedSkillSources: [],
    instructionMode: "append",
  };
}

function textPromptInput(text: string): TextPromptInput {
  return { type: "text", text, mentions: [] };
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function runRouterCommand({
  command,
  requestId,
  router,
}: RunRouterCommandArgs): Promise<HostDaemonOnlineRpcResponseMessage> {
  const message: HostDaemonOnlineRpcRequestMessage = {
    type: "host-rpc.request",
    requestId,
    command,
  };
  return router.handleOnlineRpcRequest(message);
}

describe("CommandRouter", () => {
  it("rejects execution starts after the work barrier while allowing stop", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-router" });
    const router = createRouter(harness);

    const quiesce = await runRouterCommand({
      command: {
        type: "work.quiesce",
        operationId: "update-1",
        expiresAt: Date.now() + 60_000,
      },
      requestId: "quiesce-env-router",
      router,
    });
    expect(quiesce).toMatchObject({
      ok: true,
      result: { operationId: "update-1", gatePhase: "draining" },
    });

    const start = await runRouterCommand({
      command: createThreadStartCommand(),
      requestId: "start-during-quiesce",
      router,
    });
    expect(start).toMatchObject({ ok: false, errorCode: "work_quiesced" });

    const executionStartDescriptors = Object.values(
      hostDaemonCommandRegistry,
    ).filter(
      (descriptor) =>
        hostDaemonCommandQuiescePolicyByType[descriptor.type] ===
        "execution-start",
    );
    for (const descriptor of executionStartDescriptors) {
      const response = await runRouterCommand({
        command: { type: descriptor.type } as HostDaemonRpcCommand,
        requestId: `quiesced-${descriptor.type}`,
        router,
      });
      expect(response, descriptor.type).toMatchObject({
        ok: false,
        errorCode: "work_quiesced",
      });
    }

    const stop = await runRouterCommand({
      command: {
        type: "thread.stop",
        intent: "interrupt",
        environmentId: "env-router",
        threadId: "thread-router-start",
      },
      requestId: "stop-during-quiesce",
      router,
    });
    expect(stop).not.toMatchObject({ errorCode: "work_quiesced" });
  });

  it("rejects a start queued immediately behind the work barrier", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-router" });
    const router = createRouter(harness);
    const barrierTask = runRouterCommand({
      command: {
        type: "work.quiesce",
        operationId: "update-1",
        expiresAt: Date.now() + 60_000,
      },
      requestId: "quiesce-before-start",
      router,
    });
    const startTask = runRouterCommand({
      command: createThreadStartCommand(),
      requestId: "start-behind-quiesce",
      router,
    });

    await expect(barrierTask).resolves.toMatchObject({ ok: true });
    await expect(startTask).resolves.toMatchObject({
      ok: false,
      errorCode: "work_quiesced",
    });
  });

  it("acknowledges a work barrier behind an earlier start admission", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-router" });
    await harness.manager.ensureEnvironment({
      environmentId: "env-router",
      workspacePath: "/tmp/env-router",
    });
    const startEntered = createDeferredPromise<void>();
    const releaseStart = createDeferredPromise<void>();
    const originalStartThread = harness.runtime.startThread;
    harness.runtime.startThread = async (args) => {
      startEntered.resolve();
      await releaseStart.promise;
      return originalStartThread(args);
    };
    const router = createRouter(harness);
    const startTask = runRouterCommand({
      command: createThreadStartCommand(),
      requestId: "start-before-quiesce",
      router,
    });
    await startEntered.promise;

    let barrierResolved = false;
    const barrierTask = runRouterCommand({
      command: {
        type: "work.quiesce",
        operationId: "update-1",
        expiresAt: Date.now() + 60_000,
      },
      requestId: "quiesce-behind-start",
      router,
    }).then((response) => {
      barrierResolved = true;
      return response;
    });
    await flushAsyncWork();
    expect(barrierResolved).toBe(false);

    releaseStart.resolve();
    expect((await startTask).ok).toBe(true);
    expect(await barrierTask).toMatchObject({
      ok: true,
      result: {
        gatePhase: "draining",
        activity: { activeByKind: { thread: 1 } },
      },
    });
  });
});
