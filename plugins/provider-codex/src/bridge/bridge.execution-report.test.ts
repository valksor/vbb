import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  experimental_createBridgeDeltaEventCollector as createBridgeDeltaEventCollector,
  experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import type { ThreadEvent } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_1787_execution_report";
const RESUMED_PROVIDER_THREAD_ID = "codex-1787-resumed";
const AUTO_SESSION_OPTIONS = {
  model: "gpt-5.5",
  permissionMode: "auto",
  permissionScope: "workspace",
  approvalReviewer: "automatic",
  permissionEscalation: "ask",
} as const;

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;
let providerThreadId: string | null;
let drained: number;
let events: ThreadEvent[];
let collector: ReturnType<typeof createBridgeDeltaEventCollector>;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-1787-ws-"));
  providerThreadId = null;
  drained = 0;
  events = [];
  stubFakeCodexAppServer();
  harness = createBridgeJsonRpcTestHarness(handleLine);
  collector = createBridgeDeltaEventCollector("codex");
});

afterEach(async () => {
  const cleanupId = 994_001;
  harness.sendRequest(cleanupId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId,
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

function executionReports(): Extract<
  ThreadEvent,
  { type: "thread/execution/reported" }
>[] {
  for (const message of harness.messages.slice(drained)) {
    events.push(...collector.assembleMessage(message));
  }
  drained = harness.messages.length;
  return events.filter(
    (event): event is Extract<
      ThreadEvent,
      { type: "thread/execution/reported" }
    > => event.type === "thread/execution/reported",
  );
}

async function completedTurnCount(expected: number): Promise<void> {
  await vi.waitFor(
    () => {
      executionReports();
      expect(events.filter((event) => event.type === "turn/completed")).toHaveLength(
        expected,
      );
    },
    { timeout: 10_000 },
  );
}

async function runTurn(
  id: number,
  clientRequestId: string,
  overrides: { model?: string; serviceTier?: "fast" },
): Promise<void> {
  harness.sendRequest(id, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    input: [{ type: "text", text: "/clear", mentions: [] }],
    clientRequestId,
    options: { ...AUTO_SESSION_OPTIONS, ...overrides },
  });
  expect((await harness.waitForResponse(id)).error).toBeUndefined();
}

it("reports the settings the app-server resolved for a new session", async () => {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: {
      model: "gpt-5.5",
      permissionMode: "auto",
      permissionScope: "workspace",
      approvalReviewer: "automatic",
      permissionEscalation: "ask",
    },
  });
  const started = await harness.waitForResponse(1);
  expect(started.error).toBeUndefined();
  providerThreadId = (started.result as { providerThreadId: string }).providerThreadId;

  expect(executionReports()).toEqual([
    expect.objectContaining({
      scope: expect.objectContaining({ kind: "thread" }),
      execution: {
        model: "gpt-5.5",
        reasoningLevel: "medium",
        permissionMode: "auto",
        serviceTier: "default",
      },
    }),
  ]);
});

it("reports again when a session is resumed", async () => {
  providerThreadId = RESUMED_PROVIDER_THREAD_ID;
  harness.sendRequest(1, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: RESUMED_PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();

  expect(executionReports()).toEqual([
    expect.objectContaining({
      execution: {
        model: "fake-codex-model",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
      },
    }),
  ]);
});

it("reports a changed turn once and retains the prior reasoning level", async () => {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: AUTO_SESSION_OPTIONS,
  });
  const started = await harness.waitForResponse(1);
  expect(started.error).toBeUndefined();
  providerThreadId = (started.result as { providerThreadId: string }).providerThreadId;

  await runTurn(2, "creq_execrptaaa", {});
  await completedTurnCount(1);
  expect(executionReports()).toHaveLength(1);

  await runTurn(3, "creq_execrptbbb", {
    model: "gpt-5.5-mini",
    serviceTier: "fast",
  });
  await completedTurnCount(2);
  expect(executionReports()).toHaveLength(2);

  await runTurn(4, "creq_execrptccc", {
    model: "gpt-5.5-mini",
    serviceTier: "fast",
  });
  await completedTurnCount(3);
  expect(executionReports().map((report) => report.execution)).toEqual([
    {
      model: "gpt-5.5",
      reasoningLevel: "medium",
      permissionMode: "auto",
      serviceTier: "default",
    },
    {
      model: "gpt-5.5-mini",
      reasoningLevel: "medium",
      permissionMode: "auto",
      serviceTier: "fast",
    },
  ]);
}, 30_000);
