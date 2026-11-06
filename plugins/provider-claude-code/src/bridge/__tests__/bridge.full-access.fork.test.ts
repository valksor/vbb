import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CanUseTool,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  JsonValue,
  RuntimePermissionPolicy,
} from "@get-bb/plugin-sdk/provider-bridge";

const { forkClaudeSessionMock, queryMock, contextQueryMock } = vi.hoisted(() => ({
  forkClaudeSessionMock: vi.fn(),
  queryMock: vi.fn(),
  contextQueryMock: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (args: {
    options?: { persistSession?: boolean; forkSession?: boolean };
  }) =>
    args.options?.persistSession === false && args.options.forkSession === true
      ? contextQueryMock(args)
      : queryMock(args),
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn((_name, _desc, _schema, handler) => handler),
}));

vi.mock("../session-fork.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../session-fork.js")>()),
  forkClaudeSession: forkClaudeSessionMock,
}));

import { handleLine } from "../bridge.js";
import { buildSessionOptions } from "../session-options.js";
import type { ClaudePermissionMode } from "../../interactive-contract.js";
import {
  experimental_assembleCapturedThreadEvents as assembleCapturedThreadEvents,
  experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness,
} from "@get-bb/plugin-sdk/provider-bridge/testing";

type BridgeSessionOptions = ReturnType<typeof buildSessionOptions>;

type BridgeSessionHooks = NonNullable<BridgeSessionOptions["hooks"]>;

type BridgeJsonRpcTestHarness = ReturnType<
  typeof createBridgeJsonRpcTestHarness
>;

type SdkResultUsage = Extract<SDKMessage, { type: "result" }>["usage"];

function createResultUsage(): SdkResultUsage {
  return {
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    inference_geo: "",
    input_tokens: 0,
    iterations: [],
    output_tokens: 0,
    server_tool_use: {
      web_fetch_requests: 0,
      web_search_requests: 0,
    },
    service_tier: "standard",
    speed: "standard",
  };
}

interface AssistantToolUseMessageArgs {
  parentToolUseId: string | null;
  toolInput: Record<string, unknown>;
  toolName: string;
  toolUseId: string;
}

interface ControlledClaudeQuery {
  mcpServerStatus: ReturnType<typeof vi.fn>;
  getContextUsage: ReturnType<typeof vi.fn>;
  applyFlagSettings: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  emit(message: SDKMessage): void;
  fail(error: Error): void;
  finish(): void;
  initializationResult: ReturnType<typeof vi.fn>;
  interrupt: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  setPermissionMode: ReturnType<typeof vi.fn>;
  supportedCommands: ReturnType<typeof vi.fn>;
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage>;
}

interface ClaudeQueryCallOptions {
  allowDangerouslySkipPermissions?: boolean;
  mcpServers?: BridgeSessionOptions["mcpServers"];
  canUseTool?: CanUseTool;
  env?: Record<string, string | undefined>;
  extraArgs?: Record<string, string | null>;
  hooks?: BridgeSessionHooks;
  model?: string;
  permissionMode?: ClaudePermissionMode;
  resume?: string;
  sandbox?: BridgeSessionOptions["sandbox"];
  settings?: BridgeSessionOptions["settings"];
  sessionId?: string;
  disallowedTools?: string[];
  settingSources?: string[];
  stderr?: (data: string) => void;
}

interface ClaudeQueryCall {
  options: ClaudeQueryCallOptions;
  prompt: AsyncIterable<SDKUserMessage>;
}

interface ControlledClaudeQueryMessageResult {
  result: IteratorResult<SDKMessage>;
  type: "result";
}

interface ControlledClaudeQueryErrorResult {
  error: Error;
  type: "error";
}

type ControlledClaudeQueryResult =
  | ControlledClaudeQueryMessageResult
  | ControlledClaudeQueryErrorResult;

const tempDirs: string[] = [];

interface StartBridgeThreadArgs {
  bridge: BridgeJsonRpcTestHarness;
  threadId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isClaudeQueryCall(value: unknown): value is ClaudeQueryCall {
  if (!isRecord(value) || !isRecord(value.options)) {
    return false;
  }
  const { prompt } = value;
  if (
    prompt === null ||
    typeof prompt !== "object" ||
    !(Symbol.asyncIterator in prompt)
  ) {
    return false;
  }
  return (
    value.options.canUseTool === undefined ||
    typeof value.options.canUseTool === "function"
  );
}

function getLatestQueryCall(): ClaudeQueryCall {
  const latestCall = queryMock.mock.calls.at(-1)?.[0];
  if (!isClaudeQueryCall(latestCall)) {
    throw new Error("Expected Claude SDK query options");
  }
  return latestCall;
}

function getLastCanUseTool(): CanUseTool {
  const latestCall = queryMock.mock.calls.at(-1)?.[0];
  if (!isClaudeQueryCall(latestCall) || !latestCall.options.canUseTool) {
    throw new Error("Expected Claude SDK query to receive canUseTool");
  }
  return latestCall.options.canUseTool;
}

function createControlledClaudeQuery(): ControlledClaudeQuery {
  let finishNext: ((result: IteratorResult<SDKMessage>) => void) | undefined;
  let failNext: ((error: Error) => void) | undefined;
  const pendingResults: ControlledClaudeQueryResult[] = [];
  function pushResult(result: IteratorResult<SDKMessage>): void {
    if (finishNext) {
      const resolve = finishNext;
      finishNext = undefined;
      failNext = undefined;
      resolve(result);
      return;
    }
    pendingResults.push({ type: "result", result });
  }
  function pushError(error: Error): void {
    if (failNext) {
      const reject = failNext;
      finishNext = undefined;
      failNext = undefined;
      reject(error);
      return;
    }
    pendingResults.push({ type: "error", error });
  }
  const iterator: AsyncIterator<SDKMessage> = {
    next: () => {
      const pending = pendingResults.shift();
      if (pending?.type === "result") return Promise.resolve(pending.result);
      if (pending?.type === "error") return Promise.reject(pending.error);
      return new Promise<IteratorResult<SDKMessage>>((resolve, reject) => {
        finishNext = resolve;
        failNext = reject;
      });
    },
    return: async () => {
      finishNext = undefined;
      failNext = undefined;
      return { value: undefined, done: true };
    },
  };
  return {
    applyFlagSettings: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(() => {
      pushResult({ value: undefined, done: true });
    }),
    emit(message: SDKMessage): void {
      pushResult({ value: message, done: false });
    },
    fail(error: Error): void {
      pushError(error);
    },
    finish() {
      pushResult({ value: undefined, done: true });
    },
    mcpServerStatus: vi
      .fn()
      .mockResolvedValue([{ name: "bb-bridge", status: "connected" }]),
    getContextUsage: vi.fn().mockResolvedValue(null),
    initializationResult: vi.fn(),
    interrupt: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    supportedCommands: vi.fn().mockResolvedValue([]),
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
}

async function readNextPrompt(call: ClaudeQueryCall): Promise<SDKUserMessage> {
  const result = await call.prompt[Symbol.asyncIterator]().next();
  if (result.done) {
    throw new Error("Expected Claude prompt input");
  }
  return result.value;
}

function createAssistantToolUseMessage(
  args: AssistantToolUseMessageArgs,
): SDKMessage {
  return {
    type: "assistant",
    message: {
      id: `message-${args.toolUseId}`,
      type: "message",
      role: "assistant",
      container: null,
      content: [
        {
          type: "tool_use",
          id: args.toolUseId,
          name: args.toolName,
          input: args.toolInput,
        },
      ],
      context_management: null,
      model: "claude-sonnet-5",
      stop_details: null,
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: createResultUsage(),
    },
    parent_tool_use_id: args.parentToolUseId,
    uuid: `00000000-0000-4000-8000-${args.toolUseId}`,
    session_id: "session-1",
  };
}

function canonicalOptions(args?: {
  permissionEscalation?: "ask" | "deny";
  providerOptions?: Record<string, JsonValue>;
}): Record<string, JsonValue> {
  return {
    permissionMode: "accept-edits",
    permissionScope: "workspace",
    approvalReviewer: "user",
    permissionEscalation: args?.permissionEscalation ?? "ask",
    instructions: "test",
    providerOptions: {
      workflowsEnabled: false,
      ...args?.providerOptions,
    },
  };
}

function canonicalTurnParams(args: {
  threadId: string;
  providerThreadId?: string;
  expectedTurnId?: string;
  input: JsonValue[];
  permissionEscalation?: "ask" | "deny";
  providerOptions?: Record<string, JsonValue>;
}): Record<string, JsonValue> {
  return {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId ?? args.threadId,
    ...(args.expectedTurnId !== undefined
      ? { expectedTurnId: args.expectedTurnId }
      : {}),
    clientRequestId: "creq_abcdefghjk",
    input: args.input,
    options: canonicalOptions(args),
  };
}

async function startBridgeThread(args: StartBridgeThreadArgs): Promise<void> {
  args.bridge.sendRequest(1, "thread/start", {
    cwd: "/tmp/worktree",
    instructionMode: "append",
    options: canonicalOptions({}),
    threadId: args.threadId,
  });
  await args.bridge.waitForResponse(1);
}

describe("bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextQueryMock.mockImplementation(() => createControlledClaudeQuery());
    forkClaudeSessionMock.mockResolvedValue({ sessionId: "forked-session-1" });
    queryMock.mockReturnValue({
      initializationResult: vi.fn().mockResolvedValue({
        account: {},
        models: [
          {
            value: "default",
            displayName: "Default (recommended)",
            description:
              "Opus 4.8 with 1M context [NEW] · Most capable for complex work",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
          },
          {
            value: "claude-haiku-4-5",
            displayName: "Haiku",
            description: "Haiku 4.5",
          },
          {
            value: "claude-sonnet-4-6",
            displayName: "Sonnet",
            description: "Sonnet 4.6 · Best for everyday tasks",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high"],
          },
          {
            value: "claude-sonnet-4-6[1m]",
            displayName: "Sonnet (1M context)",
            description: "Sonnet 4.6 with 1M context · Billed as extra usage",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high"],
          },
        ],
      }),
      close: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Bash canUseTool policy", () => {
    const FULL_POLICY = {
      permissionMode: "full",
      permissionScope: "full",
      approvalReviewer: null,
      permissionEscalation: null,
    } satisfies RuntimePermissionPolicy;

    it.each([{ name: "full bypass allows Bash input unchanged" }])(
      "$name",
      async () => {
        const bridge = createBridgeJsonRpcTestHarness(handleLine);
        const queries: ControlledClaudeQuery[] = [];
        queryMock.mockImplementation(() => {
          const query = createControlledClaudeQuery();
          queries.push(query);
          return query;
        });

        try {
          const startRequestId = 1;
          const stopRequestId = startRequestId + 1;
          const threadId = "thread-bash-policy-full-bypass-allow";
          const toolUseID = "tool-bash-policy-full-bypass-allow";
          const input = {
            command: "git status --short",
            description: "Permission boundary test",
          };
          bridge.sendRequest(startRequestId, "thread/start", {
            threadId,
            cwd: "/tmp/worktree",
            instructionMode: "append",
            options: {
              ...FULL_POLICY,
              instructions: "test",
              providerOptions: {
                workflowsEnabled: false,
              },
            },
          });
          await bridge.waitForResponse(startRequestId);

          const canUseTool = getLastCanUseTool();
          const result = await canUseTool("Bash", input, {
            blockedPath: undefined,
            decisionReason: "This command requires approval",
            requestId: "control-request",
            signal: new AbortController().signal,
            toolUseID,
          });
          if (result === null) {
            throw new Error(
              "Expected full bypass allows Bash input unchanged to return a decision",
            );
          }

          expect(result).toMatchObject({
            behavior: "allow",
            toolUseID,
            updatedInput: {
              command: "git status --short",
              description: "Permission boundary test",
            },
          });
          expect("decisionClassification" in result).toBe(false);

          bridge.sendRequest(stopRequestId, "thread/stop", {
            threadId,
            providerThreadId: threadId,
            intent: "interrupt",
            activeTurnId: null,
          });
          await bridge.flushWork();
          queries[0]?.finish();
          await bridge.waitForResponse(stopRequestId);
        } finally {
          bridge.restore();
        }
      },
    );
  });
});
