import { getAppSettings, setAppSettings } from "@bb/db";
import { turnScope } from "@bb/domain";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runProviderTurnWatchdogSweep } from "../../../src/services/threads/provider-turn-watchdog.js";
import { seedEvent, seedThreadFixture } from "../../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

interface RecordedTurnWatchdogPayload {
  action: "interrupt" | "notify";
  elapsedMs: number;
  thresholdMs: number;
  thread: {
    id: string;
    status: string;
  };
}

const globals = globalThis as Record<string, unknown>;

async function setUpPluginHarness(serverSource: string): Promise<{
  harness: TestAppHarness;
  cleanup(): Promise<void>;
}> {
  const harness = await createTestAppHarness();
  const workDir = await mkdtemp(join(tmpdir(), "bb-plugin-events-"));
  const rootDir = join(workDir, "bb-plugin-observer");
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: "bb-plugin-observer",
      version: "0.1.0",
      bb: {
        name: "Observer fixture",
        description: "Thread events plugin fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), serverSource);
  const entry = await harness.pluginService.installPath(rootDir);
  expect(entry.status).toBe("running");
  return {
    harness,
    async cleanup() {
      await harness.pluginService.stop();
      await rm(workDir, { recursive: true, force: true });
      await harness.cleanup();
    },
  };
}

describe("plugin thread lifecycle events", () => {
  it("delivers provider turn watchdog actions from the production sweep", async () => {
    const recorded: RecordedTurnWatchdogPayload[] = [];
    globals.__watchdogEvents = recorded;
    const { harness, cleanup } = await setUpPluginHarness(`
      export default function plugin(bb: any) {
        bb.events.on("experimental_thread.turnWatchdog", (payload: any) => {
          (globalThis as any).__watchdogEvents.push(payload);
        });
      }
    `);
    try {
      const notifyMs = 5 * 60_000;
      const interruptMs = 10 * 60_000;
      const startedAt = 1_000_000;
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      seedEvent(harness.deps, {
        createdAt: startedAt,
        data: { providerThreadId: "provider-thread-watchdog" },
        environmentId: environment.id,
        providerThreadId: "provider-thread-watchdog",
        scope: turnScope("turn-watchdog"),
        sequence: 1,
        threadId: thread.id,
        type: "turn/started",
      });
      setAppSettings(harness.db, {
        ...getAppSettings(harness.db),
        providerTurnIdleNotifyMs: notifyMs,
        providerTurnIdleInterruptMs: interruptMs,
      });

      expect(
        runProviderTurnWatchdogSweep(harness.deps, {
          now: startedAt + notifyMs,
        }),
      ).toEqual({ notifiedThreadIds: [thread.id], interruptedThreadIds: [] });
      await vi.waitFor(() => expect(recorded).toHaveLength(1));

      expect(
        runProviderTurnWatchdogSweep(harness.deps, {
          now: startedAt + interruptMs,
        }),
      ).toEqual({ notifiedThreadIds: [], interruptedThreadIds: [thread.id] });
      await vi.waitFor(() => expect(recorded).toHaveLength(2));
      expect(recorded).toEqual([
        expect.objectContaining({
          action: "notify",
          elapsedMs: notifyMs,
          thresholdMs: notifyMs,
          thread: expect.objectContaining({ id: thread.id, status: "active" }),
        }),
        expect.objectContaining({
          action: "interrupt",
          elapsedMs: interruptMs,
          thresholdMs: interruptMs,
          thread: expect.objectContaining({ id: thread.id, status: "active" }),
        }),
      ]);

      setAppSettings(harness.db, {
        ...getAppSettings(harness.db),
        providerTurnIdleWatchdogEnabled: false,
      });
      const {
        environment: policyDisabledEnvironment,
        thread: policyDisabledThread,
      } = seedThreadFixture(harness, { thread: { status: "active" } });
      seedEvent(harness.deps, {
        createdAt: startedAt,
        data: { providerThreadId: "provider-thread-policy-disabled" },
        environmentId: policyDisabledEnvironment.id,
        providerThreadId: "provider-thread-policy-disabled",
        scope: turnScope("turn-watchdog-policy-disabled"),
        sequence: 1,
        threadId: policyDisabledThread.id,
        type: "turn/started",
      });
      expect(
        runProviderTurnWatchdogSweep(harness.deps, {
          now: startedAt + interruptMs,
        }),
      ).toEqual({ notifiedThreadIds: [], interruptedThreadIds: [] });
      await Promise.resolve();
      expect(recorded).toHaveLength(2);

      setAppSettings(harness.db, {
        ...getAppSettings(harness.db),
        providerTurnIdleWatchdogEnabled: true,
      });
      await harness.pluginService.setEnabled("observer", false);
      const { environment: disabledEnvironment, thread: disabledThread } =
        seedThreadFixture(harness, { thread: { status: "active" } });
      seedEvent(harness.deps, {
        createdAt: startedAt,
        data: { providerThreadId: "provider-thread-disabled" },
        environmentId: disabledEnvironment.id,
        providerThreadId: "provider-thread-disabled",
        scope: turnScope("turn-watchdog-disabled"),
        sequence: 1,
        threadId: disabledThread.id,
        type: "turn/started",
      });
      const disabledListenerResult = runProviderTurnWatchdogSweep(
        harness.deps,
        { now: startedAt + notifyMs },
      );
      expect(disabledListenerResult.interruptedThreadIds).toEqual([]);
      expect(new Set(disabledListenerResult.notifiedThreadIds)).toEqual(
        new Set([policyDisabledThread.id, disabledThread.id]),
      );
      await Promise.resolve();
      expect(recorded).toHaveLength(2);
    } finally {
      delete globals.__watchdogEvents;
      await cleanup();
    }
  });
});
