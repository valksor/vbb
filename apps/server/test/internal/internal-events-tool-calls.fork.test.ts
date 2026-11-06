import { eq } from "drizzle-orm";
import {
  createQueuedThreadMessage,
  environments,
  events,
  getEnvironment,
  getThread,
  listEnvironments,
  listQueuedThreadMessages,
  updateThread,
} from "@bb/db";
import {
  PERSONAL_PROJECT_ID,
  turnScope,
  type GitSourceInspection,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  internalAuthHeaders,
  registerTestHostRpcCapture,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { reportNextEnvironmentAttachSuccess } from "../helpers/commands.fork.js";
import { readJson } from "../helpers/json.js";
import { installFakeGitWorktreeProvider } from "../helpers/environment-provider.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEvent,
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";
import { handleUpdateEnvironmentDirectoryToolCall } from "../../src/services/threads/thread-environment-directory.js";
import { handleKeepCheckoutToolCall } from "../../src/services/threads/thread-environment-directory.fork.js";

async function postToolCall(args: {
  arguments?: unknown;
  callId?: string;
  harness: TestAppHarness;
  providerThreadId?: string;
  sessionId: string;
  threadId: string;
  tool: string;
  turnId?: string;
}): Promise<Response> {
  return args.harness.app.request("/internal/session/tool-call", {
    method: "POST",
    headers: internalAuthHeaders(args.harness),
    body: JSON.stringify({
      sessionId: args.sessionId,
      threadId: args.threadId,
      providerThreadId: args.providerThreadId ?? "provider-tool-call",
      turnId: args.turnId ?? "turn-tool-call",
      callId: args.callId ?? "call-tool-call",
      tool: args.tool,
      arguments: args.arguments,
    }),
  });
}

function registerGitSourceInspection(
  harness: TestAppHarness,
  args: {
    hostId: string;
    path: string;
    result?: GitSourceInspection;
    sessionId: string;
  },
): void {
  registerTestHostRpcCapture(harness, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    onInspectGitSource(command) {
      expect(command).toEqual({
        type: "host.inspect_git_source",
        path: args.path,
        remoteRefresh: "background",
      });
    },
    gitSourceInspectionResult:
      args.result ??
      ({
        checkout: {
          kind: "branch",
          branchName: "feature/exploration-base",
          headSha: "1111111111111111111111111111111111111111",
        },
        defaultBranch: "main",
        defaultBranchRelation: "equal",
        isWorktree: false,
        hasUncommittedChanges: false,
        operation: { kind: "none" },
        originDefaultBranch: "origin/main",
      } satisfies GitSourceInspection),
  });
}

describe("internal event and tool-call routes", () => {
  it("declines promotion when update_environment_directory confirms the current checkout", async () => {
    await withTestHarness(async (harness) => {
      const { currentEnvironment, session, thread } = seedPromotableThread(
        harness,
        { hostId: "host-confirm-current-checkout" },
      );

      const response = await postToolCall({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        turnId: "turn-confirm-current-checkout",
        tool: "update_environment_directory",
        arguments: { path: currentEnvironment.path },
      });

      await expect(readJson(response)).resolves.toMatchObject({
        success: true,
        contentItems: [
          {
            type: "inputText",
            text: expect.stringContaining("already using"),
          },
        ],
      });
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(
        currentEnvironment.id,
      );
      expect(getThread(harness.db, thread.id)?.worktreePromotion).toBe(
        "declined",
      );
    });
  });

  it("does not decline promotion from a stale current-directory snapshot", async () => {
    await withTestHarness(async (harness) => {
      const { currentEnvironment, thread, project } = seedPromotableThread(
        harness,
        { hostId: "host-stale-current-directory" },
      );
      const worktreeEnvironment = seedEnvironment(harness.deps, {
        hostId: "host-stale-current-directory",
        projectId: project.id,
        path: WORKTREE_PATH,
        environmentProviderId: "git-worktree",
        environmentProviderPluginId: "environment-git-worktree",
        providerOwnsPath: true,
      });
      harness.db
        .update(environments)
        .set({ isWorktree: true })
        .where(eq(environments.id, worktreeEnvironment.id))
        .run();
      updateThread(harness.db, harness.hub, thread.id, {
        environmentId: worktreeEnvironment.id,
      });

      const response = await handleUpdateEnvironmentDirectoryToolCall(
        harness.deps,
        {
          currentEnvironment,
          input: { path: currentEnvironment.path },
          thread,
          turnId: "turn-stale-current-directory",
        },
      );

      expect(response).toMatchObject({ success: false });
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(
        worktreeEnvironment.id,
      );
      expect(getThread(harness.db, thread.id)?.worktreePromotion).toBe("armed");
    });
  });

  it("still rejects message_user after the turn start is stored", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-message-user",
        sequence: 1,
        type: "turn/started",
        scope: turnScope("turn-2"),
        data: {
          providerThreadId: "provider-message-user",
        },
      });

      const response = await harness.app.request(
        "/internal/session/tool-call",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            threadId: thread.id,
            providerThreadId: "provider-message-user",
            turnId: "turn-2",
            callId: "call-2",
            tool: "message_user",
            arguments: {
              text: "Need input from the user",
            },
          }),
        },
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        success: false,
        contentItems: [
          { type: "inputText", text: "Unsupported tool: message_user" },
        ],
      });
      const storedEvents = harness.db
        .select()
        .from(events)
        .where(eq(events.threadId, thread.id))
        .orderBy(events.sequence)
        .all();
      expect(storedEvents).toHaveLength(1);
    });
  });

  const WORKTREE_PATH = "/tmp/bb-managed/worktrees/lazy-promotion";

  function seedPromotableThread(
    harness: TestAppHarness,
    args: {
      hostId: string;
      projectId?: string;
      title?: string;
      environment?: { worktree?: boolean };
    },
  ) {
    const { host, session } = seedHostSession(harness.deps, {
      id: args.hostId,
    });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
      path: "/tmp/configured-project-source",
    });
    const currentEnvironment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: args.projectId ?? project.id,
      path: "/tmp/explicit-alternate-checkout",
      branchName: "feature/exploration-base",
      ...(args.environment?.worktree === true
        ? {
            environmentProviderId: "git-worktree",
            environmentProviderPluginId: "environment-git-worktree",
            providerOwnsPath: true,
          }
        : {
            environmentProviderId: "project-checkout",
            environmentProviderPluginId: "environment-project-checkout",
          }),
    });
    const thread = seedThread(harness.deps, {
      projectId: args.projectId ?? project.id,
      environmentId: currentEnvironment.id,
      title: args.title ?? "Lazy worktree promotion",
    });
    seedThreadRuntimeState(harness.deps, {
      threadId: thread.id,
      environmentId: currentEnvironment.id,
      providerThreadId: "provider-tool-call",
      inputText: "Implement lazy worktree promotion",
      model: "gpt-5.4",
      permissionMode: "accept-edits",
      reasoningLevel: "high",
      serviceTier: "fast",
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: currentEnvironment.id,
      providerThreadId: "provider-tool-call",
      sequence: 3,
      type: "turn/started",
      scope: turnScope("turn-enter-worktree"),
      data: { providerThreadId: "provider-tool-call" },
    });
    return { currentEnvironment, host, project, session, thread };
  }

  it("creates a managed worktree from the exact checkout and queues continuation", async () => {
    await withTestHarness(async (harness) => {
      const managedWorktreePath =
        "/tmp/bb-host-data/host-enter-worktree/plugins/environment-git-worktree/host-data/worktrees/lazy-promotion/repo";
      const provider = installFakeGitWorktreeProvider(() => ({
        action: "ready",
        environment: {
          type: "host",
          hostId: "host-enter-worktree",
          path: managedWorktreePath,
        },
      }));
      const { currentEnvironment, session, thread } = seedPromotableThread(
        harness,
        { hostId: "host-enter-worktree" },
      );
      registerGitSourceInspection(harness, {
        hostId: "host-enter-worktree",
        sessionId: session.id,
        path: currentEnvironment.path ?? "",
      });

      const responsePromise = postToolCall({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        turnId: "turn-enter-worktree",
        tool: "bb_enter_worktree",
        arguments: {},
      });
      await reportNextEnvironmentAttachSuccess(harness, null, {
        path: managedWorktreePath,
        isWorktree: true,
        branchName: "bb/lazy-worktree-promotion",
      });
      const response = await responsePromise;

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        success: true,
        contentItems: [
          {
            type: "inputText",
            text: expect.stringContaining("queued continuation"),
          },
        ],
      });

      const createContext = await provider.waitForProvision();
      expect(createContext.inputs).toEqual({
        branch: {
          kind: "named",
          name: "1111111111111111111111111111111111111111",
        },
      });
      expect(createContext.projectCheckout?.path).toBe(
        "/tmp/explicit-alternate-checkout",
      );

      const enteredEnvironment = getEnvironment(
        harness.db,
        getThread(harness.db, thread.id)?.environmentId ?? "",
      );
      expect(enteredEnvironment).toMatchObject({
        environmentProviderId: "git-worktree",
        environmentProviderPluginId: "environment-git-worktree",
        providerOwnsPath: true,
        status: "ready",
        isWorktree: true,
        path: managedWorktreePath,
      });
      expect(enteredEnvironment?.environmentProviderSelection).toEqual({
        machine: { type: "existing", hostId: "host-enter-worktree" },
        inputs: {
          branch: {
            kind: "named",
            name: "1111111111111111111111111111111111111111",
          },
        },
      });

      const queuedMessages = listQueuedThreadMessages(harness.db, thread.id);
      expect(queuedMessages).toHaveLength(1);
      expect(queuedMessages[0]).toMatchObject({
        model: "gpt-5.4",
        permissionMode: "accept-edits",
        reasoningLevel: "high",
        serviceTier: "fast",
      });
      expect(JSON.parse(queuedMessages[0]?.content ?? "[]")).toEqual([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("newly prepared worktree"),
          visibility: "agent-only",
        }),
      ]);
    });
  });

  it("skips the continuation when a superseding user message is queued", async () => {
    await withTestHarness(async (harness) => {
      installFakeGitWorktreeProvider(() => ({
        action: "ready",
        environment: {
          type: "host",
          hostId: "host-enter-worktree-superseded",
          path: WORKTREE_PATH,
        },
      }));
      const { currentEnvironment, session, thread } = seedPromotableThread(
        harness,
        { hostId: "host-enter-worktree-superseded" },
      );
      registerGitSourceInspection(harness, {
        hostId: "host-enter-worktree-superseded",
        sessionId: session.id,
        path: currentEnvironment.path ?? "",
      });
      createQueuedThreadMessage(harness.db, harness.hub, {
        threadId: thread.id,
        content: textInput("Do this instead"),
        senderThreadId: null,
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
        waitingOn: { kind: "thread-busy" },
        sendAt: null,
        payload: { kind: "inline" },
        systemNotice: null,
      });

      const responsePromise = postToolCall({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        turnId: "turn-enter-worktree",
        tool: "bb_enter_worktree",
        arguments: {},
      });
      await reportNextEnvironmentAttachSuccess(harness, null, {
        path: WORKTREE_PATH,
        isWorktree: true,
        branchName: "bb/lazy-worktree-promotion",
      });
      await expect(responsePromise).resolves.toMatchObject({ status: 200 });

      const queuedMessages = listQueuedThreadMessages(harness.db, thread.id);
      expect(queuedMessages).toHaveLength(1);
      expect(JSON.parse(queuedMessages[0]?.content ?? "[]")).toEqual(
        textInput("Do this instead"),
      );
    });
  });

  it("does not create another worktree when the environment is already one", async () => {
    await withTestHarness(async (harness) => {
      const provider = installFakeGitWorktreeProvider(() => ({
        action: "ready",
        environment: {
          type: "host",
          hostId: "host-already-worktree",
          path: WORKTREE_PATH,
        },
      }));
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-already-worktree",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/configured-project-source",
      });
      const worktreeEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: WORKTREE_PATH,
        providerOwnsPath: true,
        environmentProviderId: "git-worktree",
        environmentProviderPluginId: "environment-git-worktree",
      });
      harness.db
        .update(environments)
        .set({ isWorktree: true })
        .where(eq(environments.id, worktreeEnvironment.id))
        .run();
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: worktreeEnvironment.id,
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: worktreeEnvironment.id,
        providerThreadId: "provider-tool-call",
        sequence: 3,
        type: "turn/started",
        scope: turnScope("turn-enter-worktree"),
        data: { providerThreadId: "provider-tool-call" },
      });

      const response = await postToolCall({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        turnId: "turn-enter-worktree",
        tool: "bb_enter_worktree",
        arguments: {},
      });

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        success: true,
        contentItems: [
          {
            type: "inputText",
            text: expect.stringContaining("already using the worktree"),
          },
        ],
      });
      expect(provider.contexts).toHaveLength(0);
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(
        worktreeEnvironment.id,
      );
    });
  });

  it("refuses promotion when the checkout has uncommitted changes", async () => {
    await withTestHarness(async (harness) => {
      const provider = installFakeGitWorktreeProvider(() => ({
        action: "ready",
        environment: {
          type: "host",
          hostId: "host-dirty-checkout",
          path: WORKTREE_PATH,
        },
      }));
      const { currentEnvironment, session, thread } = seedPromotableThread(
        harness,
        { hostId: "host-dirty-checkout" },
      );
      registerGitSourceInspection(harness, {
        hostId: "host-dirty-checkout",
        sessionId: session.id,
        path: currentEnvironment.path ?? "",
        result: {
          checkout: {
            kind: "branch",
            branchName: "feature/exploration-base",
            headSha: "1111111111111111111111111111111111111111",
          },
          defaultBranch: "main",
          defaultBranchRelation: "equal",
          isWorktree: false,
          hasUncommittedChanges: true,
          operation: { kind: "none" },
          originDefaultBranch: "origin/main",
        },
      });

      const response = await postToolCall({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        turnId: "turn-enter-worktree",
        tool: "bb_enter_worktree",
        arguments: {},
      });

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: expect.stringContaining("uncommitted changes"),
          },
        ],
      });
      expect(provider.contexts).toHaveLength(0);
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(
        currentEnvironment.id,
      );
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
    });
  });

  it("refuses promotion when the checkout has no commits", async () => {
    await withTestHarness(async (harness) => {
      installFakeGitWorktreeProvider(() => ({
        action: "ready",
        environment: {
          type: "host",
          hostId: "host-unborn-checkout",
          path: WORKTREE_PATH,
        },
      }));
      const { currentEnvironment, session, thread } = seedPromotableThread(
        harness,
        { hostId: "host-unborn-checkout" },
      );
      registerGitSourceInspection(harness, {
        hostId: "host-unborn-checkout",
        sessionId: session.id,
        path: currentEnvironment.path ?? "",
        result: {
          checkout: { kind: "unborn", branchName: "main" },
          defaultBranch: null,
          defaultBranchRelation: null,
          isWorktree: false,
          hasUncommittedChanges: false,
          operation: { kind: "none" },
          originDefaultBranch: null,
        },
      });

      const response = await postToolCall({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        turnId: "turn-enter-worktree",
        tool: "bb_enter_worktree",
        arguments: {},
      });

      await expect(readJson(response)).resolves.toMatchObject({
        success: false,
        contentItems: [
          { type: "inputText", text: expect.stringContaining("no commits") },
        ],
      });
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(
        currentEnvironment.id,
      );
    });
  });

  it("records a declined promotion that outlives the turn that declined it", async () => {
    await withTestHarness(async (harness) => {
      const { currentEnvironment, session, thread } = seedPromotableThread(
        harness,
        { hostId: "host-keep-checkout" },
      );
      expect(getThread(harness.db, thread.id)?.worktreePromotion).toBe("armed");

      const response = await postToolCall({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        turnId: "turn-enter-worktree",
        tool: "bb_keep_checkout",
        arguments: {},
      });

      await expect(readJson(response)).resolves.toMatchObject({
        success: true,
      });
      expect(getThread(harness.db, thread.id)?.worktreePromotion).toBe(
        "declined",
      );
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(
        currentEnvironment.id,
      );

      const stalePromotionResponse = await postToolCall({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        turnId: "turn-enter-worktree",
        tool: "bb_enter_worktree",
        arguments: {},
      });
      await expect(readJson(stalePromotionResponse)).resolves.toMatchObject({
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: expect.stringContaining("promotion was declined"),
          },
        ],
      });
    });
  });

  it("refuses to decline promotion from inside a worktree", async () => {
    await withTestHarness(async (harness) => {
      const { session, thread } = seedPromotableThread(harness, {
        hostId: "host-keep-checkout-in-worktree",
        environment: { worktree: true },
      });

      const response = await postToolCall({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        turnId: "turn-enter-worktree",
        tool: "bb_keep_checkout",
        arguments: {},
      });

      await expect(readJson(response)).resolves.toMatchObject({
        success: false,
      });
      expect(getThread(harness.db, thread.id)?.worktreePromotion).toBe("armed");
    });
  });

  it("refuses a stale keep-checkout call after the thread enters a worktree", async () => {
    await withTestHarness(async (harness) => {
      const { currentEnvironment, thread, project } = seedPromotableThread(
        harness,
        { hostId: "host-stale-keep-checkout" },
      );
      const worktreeEnvironment = seedEnvironment(harness.deps, {
        hostId: "host-stale-keep-checkout",
        projectId: project.id,
        path: WORKTREE_PATH,
        environmentProviderId: "git-worktree",
        environmentProviderPluginId: "environment-git-worktree",
        providerOwnsPath: true,
      });
      harness.db
        .update(environments)
        .set({ isWorktree: true })
        .where(eq(environments.id, worktreeEnvironment.id))
        .run();
      updateThread(harness.db, harness.hub, thread.id, {
        environmentId: worktreeEnvironment.id,
      });

      const response = handleKeepCheckoutToolCall(harness.deps, {
        currentEnvironment,
        input: {},
        thread,
      });

      expect(response).toMatchObject({ success: false });
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(
        worktreeEnvironment.id,
      );
      expect(getThread(harness.db, thread.id)?.worktreePromotion).toBe("armed");
    });
  });

  it("reclaims a provisioned worktree when promotion is declined before attachment", async () => {
    await withTestHarness(async (harness) => {
      installFakeGitWorktreeProvider(() => ({
        action: "ready",
        environment: {
          type: "host",
          hostId: "host-concurrent-decline",
          path: WORKTREE_PATH,
        },
      }));
      const { currentEnvironment, session, thread, project } =
        seedPromotableThread(harness, { hostId: "host-concurrent-decline" });
      registerGitSourceInspection(harness, {
        hostId: "host-concurrent-decline",
        sessionId: session.id,
        path: currentEnvironment.path ?? "",
      });

      const enterResponsePromise = postToolCall({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        turnId: "turn-concurrent-decline",
        tool: "bb_enter_worktree",
        arguments: {},
      });
      const attachCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.attach" &&
          command.path === WORKTREE_PATH,
      );

      const keepResponse = await postToolCall({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        turnId: "turn-concurrent-decline",
        tool: "bb_keep_checkout",
        arguments: {},
      });
      await expect(readJson(keepResponse)).resolves.toMatchObject({
        success: true,
      });

      await reportQueuedCommandSuccess(harness, attachCommand, {
        path: WORKTREE_PATH,
        isGitRepo: true,
        isWorktree: true,
        branchName: "bb/lazy-worktree-promotion",
        defaultBranch: "main",
        transcript: [],
      });

      await expect(readJson(await enterResponsePromise)).resolves.toMatchObject(
        {
          success: false,
          contentItems: [
            {
              type: "inputText",
              text: expect.stringContaining("promotion was declined"),
            },
          ],
        },
      );
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(
        currentEnvironment.id,
      );
      expect(getThread(harness.db, thread.id)?.worktreePromotion).toBe(
        "declined",
      );
      const preparedWorktree = listEnvironments(harness.db, {
        projectId: project.id,
      }).find((environment) => environment.path === WORKTREE_PATH);
      expect(preparedWorktree?.teardownStatus).not.toBeNull();
    });
  });

  it("reclaims the worktree when the thread changes environment during provisioning", async () => {
    await withTestHarness(async (harness) => {
      installFakeGitWorktreeProvider(() => ({
        action: "ready",
        environment: {
          type: "host",
          hostId: "host-environment-changed",
          path: WORKTREE_PATH,
        },
      }));
      const { currentEnvironment, session, thread, project } =
        seedPromotableThread(harness, { hostId: "host-environment-changed" });
      const otherEnvironment = seedEnvironment(harness.deps, {
        hostId: "host-environment-changed",
        projectId: project.id,
        path: "/tmp/some-other-checkout",
      });
      registerGitSourceInspection(harness, {
        hostId: "host-environment-changed",
        sessionId: session.id,
        path: currentEnvironment.path ?? "",
      });

      const responsePromise = postToolCall({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        turnId: "turn-enter-worktree",
        tool: "bb_enter_worktree",
        arguments: {},
      });
      const attachCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.attach" &&
          command.path === WORKTREE_PATH,
      );
      updateThread(harness.db, harness.hub, thread.id, {
        environmentId: otherEnvironment.id,
      });
      await reportQueuedCommandSuccess(harness, attachCommand, {
        path: WORKTREE_PATH,
        isGitRepo: true,
        isWorktree: true,
        branchName: "bb/lazy-worktree-promotion",
        defaultBranch: "main",
        transcript: [],
      });

      await expect(readJson(await responsePromise)).resolves.toMatchObject({
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: expect.stringContaining("Thread environment changed"),
          },
        ],
      });
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(
        otherEnvironment.id,
      );
      const preparedWorktree = listEnvironments(harness.db, {
        projectId: project.id,
      }).find((environment) => environment.path === WORKTREE_PATH);
      expect(preparedWorktree?.teardownStatus).not.toBeNull();
    });
  });

  it("rejects worktree promotion for personal projects", async () => {
    await withTestHarness(async (harness) => {
      const provider = installFakeGitWorktreeProvider(() => ({
        action: "ready",
        environment: {
          type: "host",
          hostId: "host-personal-promotion",
          path: WORKTREE_PATH,
        },
      }));
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-personal-promotion",
      });
      const currentEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: PERSONAL_PROJECT_ID,
        path: "/tmp/personal-workspace",
      });
      const thread = seedThread(harness.deps, {
        projectId: PERSONAL_PROJECT_ID,
        environmentId: currentEnvironment.id,
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: currentEnvironment.id,
        providerThreadId: "provider-tool-call",
        sequence: 3,
        type: "turn/started",
        scope: turnScope("turn-enter-worktree"),
        data: { providerThreadId: "provider-tool-call" },
      });

      const response = await postToolCall({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        turnId: "turn-enter-worktree",
        tool: "bb_enter_worktree",
        arguments: {},
      });

      await expect(readJson(response)).resolves.toMatchObject({
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: expect.stringContaining("standard projects"),
          },
        ],
      });
      expect(provider.contexts).toHaveLength(0);
    });
  });
});
