import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { killProcessesReferencingPath } from "@bb/test-helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DynamicTool, ReasoningLevel } from "@bb/domain";
import {
  assembleCapturedThreadEvents,
  captureBridgeJsonRpcOutput,
} from "@bb/provider-bridge-protocol/testing";
import type {
  BridgeJsonRpcOutputMessage,
  CapturedBridgeJsonRpcOutput,
} from "@bb/provider-bridge-protocol/testing";

import { handleLine } from "./bridge.js";

const FAKE_AGENT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fake-acp-agent.mjs",
);

let output: CapturedBridgeJsonRpcOutput;

let workspaceDir: string;

let nextThreadSerial = 0;

let nextRequestId = 1;

const realSetTimeout = setTimeout;

let testSignal: AbortSignal;

const sentRequestIds = new Set<number>();

const threadStartRequests = new Map<number, string>();

function requestId(): number {
  nextRequestId += 1;
  return nextRequestId;
}

function sendRequest(method: string, params: object): number {
  const id = requestId();
  sentRequestIds.add(id);
  if (
    (method === "thread/start" ||
      method === "thread/resume" ||
      method === "thread/fork") &&
    "threadId" in params &&
    typeof params.threadId === "string"
  ) {
    threadStartRequests.set(id, params.threadId);
  }
  handleLine(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  return id;
}

async function waitFor<T>(
  resolveValue: () => T | undefined,
  description: string,
  timeoutMs = 15_000,
  signal: AbortSignal | null = testSignal,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    signal?.throwIfAborted();
    const value = resolveValue();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolveTick) => realSetTimeout(resolveTick, 20));
  }
}

function findResponse(id: number): BridgeJsonRpcOutputMessage | undefined {
  return output.messages.find((message) => message.id === id);
}

async function waitForResponse(
  id: number,
): Promise<BridgeJsonRpcOutputMessage> {
  return waitFor(() => findResponse(id), `response ${id}`);
}

function notifications(method: string): BridgeJsonRpcOutputMessage[] {
  return output.messages.filter((message) => message.method === method);
}

function threadEvents(): Record<string, unknown>[] {
  return assembleCapturedThreadEvents(
    output.messages,
    "acp",
  ) as unknown as Record<string, unknown>[];
}

function threadEventsOfType(type: string): Record<string, unknown>[] {
  return threadEvents().filter((event) => event.type === type);
}

const bbThreadIdByProviderThreadId = new Map<string, string>();

function bbThreadIdFor(providerThreadId: string): string {
  const recorded = bbThreadIdByProviderThreadId.get(providerThreadId);
  if (recorded !== undefined) {
    return recorded;
  }
  for (const message of notifications("thread/identity")) {
    const params = message.params;
    if (
      typeof params === "object" &&
      params !== null &&
      !Array.isArray(params) &&
      params.providerThreadId === providerThreadId &&
      typeof params.threadId === "string"
    ) {
      return params.threadId;
    }
  }
  throw new Error(`No bb thread id recorded for ${providerThreadId}`);
}

const CLIENT_REQUEST_ID = "creq_abcdefghjk";

function executionOptions(args: {
  permissionMode?: "accept-edits" | "full";
  permissionEscalation?: "ask" | "deny" | null;
  envVars?: Record<string, string>;
  instructions?: string;
  model?: string;
  reasoningLevel?: ReasoningLevel;
  serviceTier?: "default" | "fast";
  providerOptions?: Record<string, unknown>;
}): Record<string, unknown> {
  const permissionMode = args.permissionMode ?? "full";
  return {
    ...(permissionMode === "full"
      ? {
          permissionMode: "full",
          permissionScope: "full",
          approvalReviewer: null,
          permissionEscalation: null,
        }
      : {
          permissionMode: "accept-edits",
          permissionScope: "workspace",
          approvalReviewer: "user",
          permissionEscalation: args.permissionEscalation ?? "ask",
        }),
    ...(args.envVars ? { envVars: args.envVars } : {}),
    ...(args.instructions ? { instructions: args.instructions } : {}),
    ...(args.model ? { model: args.model } : {}),
    ...(args.reasoningLevel ? { reasoningLevel: args.reasoningLevel } : {}),
    ...(args.serviceTier ? { serviceTier: args.serviceTier } : {}),
    ...(args.providerOptions ? { providerOptions: args.providerOptions } : {}),
  };
}

interface AgentLaunchArgs {
  dialectId?: string;
  parameterizedModelPicker?: boolean;
  agent?: { command: string; args: string[] };
  envVars?: Record<string, string>;
  modelListArgs?: string[];
  selectFlag?: string;
  primaryModels?: string[];
  reasoningProbePriorityModelIds?: string[];
  modelPickerPrimaryModels?: string[];
  reasoningCli?: {
    flag: string;
    supportedLevels: ReasoningLevel[];
    levelValues?: Partial<Record<ReasoningLevel, string>>;
    defaultLevel?: ReasoningLevel;
  };
  nativeReasoning?: {
    configId: string;
    supportedLevels: ReasoningLevel[];
    levelValues?: Partial<Record<ReasoningLevel, string>>;
    defaultLevel?: ReasoningLevel;
  };
  permissionCli?: {
    full?: string[];
    workspaceWrite?: string[];
    readonly?: string[];
    insertAfterArgs?: number;
  };
}

function acpLaunchSpec(args: AgentLaunchArgs): Record<string, unknown> {
  const agent = args.agent ?? {
    command: process.execPath,
    args: [FAKE_AGENT_PATH],
  };
  return {
    displayName: "Fake ACP",
    command: agent.command,
    args: agent.args,
    env: args.envVars ?? {},
    ...(args.modelListArgs
      ? {
          modelCli: {
            listArgs: [...agent.args, ...args.modelListArgs],
            ...(args.selectFlag ? { selectFlag: args.selectFlag } : {}),
            primaryModels: args.primaryModels ?? [],
          },
        }
      : {}),
    ...(args.reasoningCli ? { reasoningCli: args.reasoningCli } : {}),
    ...(args.nativeReasoning ? { nativeReasoning: args.nativeReasoning } : {}),
    ...(args.permissionCli ? { permissionCli: args.permissionCli } : {}),
  };
}

function launchProviderOptions(args: AgentLaunchArgs): Record<string, unknown> {
  return {
    ...(args.dialectId ? { acpDialect: args.dialectId } : {}),
    ...(args.parameterizedModelPicker === true
      ? { parameterizedModelPicker: true }
      : {}),
    ...(args.reasoningProbePriorityModelIds
      ? { reasoningProbePriorityModelIds: args.reasoningProbePriorityModelIds }
      : {}),
    ...(args.modelPickerPrimaryModels
      ? { primaryModels: args.modelPickerPrimaryModels }
      : {}),
    acpLaunchSpec: acpLaunchSpec(args),
  };
}

interface StartThreadArgs extends AgentLaunchArgs {
  permissionMode?: "accept-edits" | "full";
  permissionEscalation?: "ask" | "deny" | null;
  instructions?: string;
  dynamicTools?: DynamicTool[];
  model?: string;
  reasoningLevel?: ReasoningLevel;
  serviceTier?: "default" | "fast";
  additionalWorkspaceWriteRoots?: string[];
}

async function startThread(args?: StartThreadArgs): Promise<{
  bbThreadId: string;
  providerThreadId: string;
}> {
  nextThreadSerial += 1;
  const bbThreadId = `thread-${nextThreadSerial}`;
  const id = sendRequest("thread/start", {
    threadId: bbThreadId,
    cwd: workspaceDir,
    instructionMode: "append",
    options: executionOptions({
      ...args,
      providerOptions: {
        ...launchProviderOptions(args ?? {}),
        ...(args?.additionalWorkspaceWriteRoots
          ? {
              additionalWorkspaceWriteRoots: args.additionalWorkspaceWriteRoots,
            }
          : {}),
      },
    }),
    ...(args?.dynamicTools ? { dynamicTools: args.dynamicTools } : {}),
  });
  const response = await waitForResponse(id);
  if (response.error) {
    throw new Error(`thread/start failed: ${response.error.message}`);
  }
  const result = response.result;
  if (
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result) ||
    typeof result.providerThreadId !== "string"
  ) {
    throw new Error("thread/start did not return a providerThreadId");
  }
  bbThreadIdByProviderThreadId.set(result.providerThreadId, bbThreadId);
  return { bbThreadId, providerThreadId: result.providerThreadId };
}

function providerThreadIdOf(response: BridgeJsonRpcOutputMessage): string {
  const result = response.result;
  if (
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result) ||
    typeof result.providerThreadId !== "string"
  ) {
    throw new Error(
      `construction response carries no providerThreadId: ${JSON.stringify(response)}`,
    );
  }
  return result.providerThreadId;
}

function sendTurnRequest(
  method: "turn/start" | "turn/steer",
  providerThreadId: string,
  params: Record<string, unknown>,
): number {
  return sendRequest(method, {
    threadId: bbThreadIdFor(providerThreadId),
    providerThreadId,
    clientRequestId: CLIENT_REQUEST_ID,
    options: executionOptions({}),
    ...params,
  });
}

async function waitForTurnCompleted(): Promise<Record<string, unknown>> {
  return waitFor(
    () => threadEventsOfType("turn/completed").at(-1),
    "turn/completed thread event",
  );
}

beforeEach(({ signal }) => {
  testSignal = signal;
  bbThreadIdByProviderThreadId.clear();
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-acp-bridge-test-"));
  output = captureBridgeJsonRpcOutput();
});

afterEach(async () => {
  try {
    await waitFor(
      () =>
        [...threadStartRequests.keys()].every(
          (id) => findResponse(id) !== undefined,
        )
          ? true
          : undefined,
      "pending thread starts before cleanup",
      20_000,
      null,
    );
    for (const [startId, threadId] of threadStartRequests) {
      const started = findResponse(startId);
      if (!started || started.error) continue;
      const id = sendRequest("thread/stop", {
        threadId,
        providerThreadId: providerThreadIdOf(started),
        intent: "interrupt",
        activeTurnId: null,
      });
      const response = await waitFor(
        () => findResponse(id),
        `cleanup response ${id}`,
        15_000,
        null,
      );
      expect(response.error).toBeUndefined();
    }
    await waitFor(
      () =>
        [...sentRequestIds].every((id) => findResponse(id) !== undefined)
          ? true
          : undefined,
      "pending bridge requests after cleanup",
      20_000,
      null,
    );
  } finally {
    sentRequestIds.clear();
    threadStartRequests.clear();
    vi.unstubAllEnvs();
    output.restore();
    await killProcessesReferencingPath(workspaceDir);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
}, 30_000);

describe("acp bridge", () => {
  it.each([
    ["@agentclientprotocol/claude-agent-acp", "live tick\n"],
    ["some-other-agent", ""],
  ])(
    "streams a running Bash task file only for claude-agent-acp (%s)",
    async (agentName, expectedLiveOutput) => {
      const claudeTmp = mkdtempSync(join(tmpdir(), "bb-acp-claude-tmp-"));
      try {
        const { providerThreadId } = await startThread({
          permissionMode: "full",
          permissionEscalation: "ask",
          envVars: {
            FAKE_ACP_AGENT_NAME: agentName,
            CLAUDE_CODE_TMPDIR: claudeTmp,
          },
        });
        const turnId = sendTurnRequest("turn/start", providerThreadId, {
          input: [{ type: "text", text: "claude-bash", mentions: [] }],
        });
        await waitForResponse(turnId);
        await waitForTurnCompleted();

        expect(
          threadEventsOfType("item/commandExecution/outputDelta")
            .map((event) => event.delta)
            .join(""),
        ).toBe(expectedLiveOutput);
        expect(
          threadEventsOfType("item/completed").map((event) => event.item),
        ).toContainEqual(
          expect.objectContaining({
            type: "commandExecution",
            aggregatedOutput: "live tick\n",
          }),
        );
      } finally {
        rmSync(claudeTmp, { recursive: true, force: true });
      }
    },
  );
});
