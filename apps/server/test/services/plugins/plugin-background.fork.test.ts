import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listPluginSchedules,
  pluginSchedules,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { Logger } from "@bb/logger";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { testLogger } from "../../helpers/test-app.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";
import { WorkQuiesceService } from "../../../src/services/system/work-quiesce.js";

const logger = testLogger as unknown as Logger;

async function writePlugin(
  dir: string,
  options: { name: string; serverSource: string },
): Promise<string> {
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      bb: {
        name: "Background fixture",
        description: "Background plugin fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

function setNextRunAt(
  db: DbConnection,
  pluginId: string,
  name: string,
  nextRunAt: number,
): void {
  db.update(pluginSchedules)
    .set({ nextRunAt })
    .where(
      and(
        eq(pluginSchedules.pluginId, pluginId),
        eq(pluginSchedules.name, name),
      ),
    )
    .run();
}

const globals = globalThis as Record<string, unknown>;

describe("plugin background services", () => {
  let db: DbConnection;

  let workDir: string;

  let service: PluginService;

  beforeEach(async () => {
    db = createMigratedConnection();
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-bg-test-"));
    service = createPluginService({
      aiServices: createAiServiceRegistry(),
      telemetry: createNoopTelemetryService(),
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginChanged: () => {},
        onWatchedTargets: () => () => {},
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      loadTimeoutMs: 2000,
      serviceStopTimeoutMs: 100,
      serviceRestartBaseMs: 5,
    });
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("defers service starts while sealed and resumes them after release", async () => {
    const quiesce = new WorkQuiesceService({
      db,
      local: {
        quiesce: () => service.quiesceBackgroundWork(),
        release: () => service.resumeBackgroundWork(),
      },
      transport: {
        listConnectedHostIds: () => [],
        send: async () => {
          throw new Error("no host barrier expected");
        },
      },
    });
    await quiesce.acquire({
      operationId: "update-1",
      ownerSecret: "owner-secret",
      reason: "VPS update",
      ttlMs: 60_000,
    });
    await quiesce.seal({
      operationId: "update-1",
      ownerSecret: "owner-secret",
      candidateRelease: "candidate",
      previousRelease: "previous",
      allowActiveWork: false,
    });
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-quiesced-service",
      serverSource: `
        export default function plugin(bb: any) {
          const g = globalThis as any;
          g.__quiescedStarts = g.__quiescedStarts ?? 0;
          bb.background.service("worker", {
            start(signal: any) {
              g.__quiescedStarts += 1;
              return new Promise<void>((resolve) => {
                signal.addEventListener("abort", () => resolve());
              });
            },
          });
        }
      `,
    });

    const entry = await service.installPath(rootDir);
    expect(globals.__quiescedStarts).toBe(0);
    expect(entry.services).toEqual([{ name: "worker", state: "stopped" }]);

    quiesce.transition({
      operationId: "update-1",
      ownerSecret: "owner-secret",
      expectedPhase: "sealed",
      phase: "activating",
    });
    quiesce.transition({
      operationId: "update-1",
      ownerSecret: "owner-secret",
      expectedPhase: "activating",
      phase: "verifying",
    });
    await quiesce.release({
      operationId: "update-1",
      ownerSecret: "owner-secret",
      resolution: "completed",
    });

    expect(globals.__quiescedStarts).toBe(1);
    expect(
      service.list().find((plugin) => plugin.id === "quiesced-service")
        ?.services,
    ).toEqual([{ name: "worker", state: "running" }]);
  });

  it("reloads an existing service while sealed and starts the replacement after release", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-quiesced-reload",
      serverSource: `
        export default function plugin(bb: any) {
          const g = globalThis as any;
          g.__quiescedReloadStarts = g.__quiescedReloadStarts ?? 0;
          g.__quiescedReloadAborts = g.__quiescedReloadAborts ?? 0;
          bb.background.service("worker", {
            start(signal: any) {
              g.__quiescedReloadStarts += 1;
              return new Promise<void>((resolve) => {
                signal.addEventListener("abort", () => {
                  g.__quiescedReloadAborts += 1;
                  resolve();
                });
              });
            },
          });
        }
      `,
    });
    await service.installPath(rootDir);
    const quiesce = new WorkQuiesceService({
      db,
      local: {
        quiesce: () => service.quiesceBackgroundWork(),
        release: () => service.resumeBackgroundWork(),
      },
      transport: {
        listConnectedHostIds: () => [],
        send: async () => {
          throw new Error("no host barrier expected");
        },
      },
    });

    await quiesce.acquire({
      operationId: "update-reload",
      ownerSecret: "owner-secret",
      reason: "VPS update",
      ttlMs: 60_000,
    });
    await quiesce.seal({
      operationId: "update-reload",
      ownerSecret: "owner-secret",
      candidateRelease: "candidate",
      previousRelease: "previous",
      allowActiveWork: false,
    });
    await service.reload("quiesced-reload");

    expect(globals.__quiescedReloadStarts).toBe(1);
    expect(globals.__quiescedReloadAborts).toBe(1);
    expect(
      service.list().find((plugin) => plugin.id === "quiesced-reload")
        ?.services,
    ).toEqual([{ name: "worker", state: "stopped" }]);

    quiesce.transition({
      operationId: "update-reload",
      ownerSecret: "owner-secret",
      expectedPhase: "sealed",
      phase: "activating",
    });
    quiesce.transition({
      operationId: "update-reload",
      ownerSecret: "owner-secret",
      expectedPhase: "activating",
      phase: "verifying",
    });
    await quiesce.release({
      operationId: "update-reload",
      ownerSecret: "owner-secret",
      resolution: "completed",
    });

    expect(globals.__quiescedReloadStarts).toBe(2);
    expect(
      service.list().find((plugin) => plugin.id === "quiesced-reload")
        ?.services,
    ).toEqual([{ name: "worker", state: "running" }]);
  });
});

describe("plugin schedules", () => {
  let db: DbConnection;

  let workDir: string;

  let service: PluginService;

  beforeEach(async () => {
    db = createMigratedConnection();
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-sched-test-"));
    service = createPluginService({
      aiServices: createAiServiceRegistry(),
      telemetry: createNoopTelemetryService(),
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginChanged: () => {},
        onWatchedTargets: () => () => {},
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      loadTimeoutMs: 2000,
    });
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  async function installTicker(): Promise<void> {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-ticker",
      serverSource: `
        export default function plugin(bb: any) {
          const g = globalThis as any;
          g.__tickRuns = 0;
          bb.background.schedule("tick", "*/5 * * * *", async () => {
            g.__tickRuns += 1;
          });
        }
      `,
    });
    await service.installPath(rootDir);
  }

  it("leaves a due schedule unclaimed while work is sealed", async () => {
    await installTicker();
    const dueAt = Date.now() - 60_000;
    setNextRunAt(db, "ticker", "tick", dueAt);
    const quiesce = new WorkQuiesceService({
      db,
      local: {
        quiesce: () => service.quiesceBackgroundWork(),
        release: () => service.resumeBackgroundWork(),
      },
      transport: {
        listConnectedHostIds: () => [],
        send: async () => {
          throw new Error("no host barrier expected");
        },
      },
    });
    await quiesce.acquire({
      operationId: "update-schedule",
      ownerSecret: "owner-secret",
      reason: "VPS update",
      ttlMs: 60_000,
    });
    await quiesce.seal({
      operationId: "update-schedule",
      ownerSecret: "owner-secret",
      candidateRelease: "candidate",
      previousRelease: "previous",
      allowActiveWork: false,
    });

    await service.sweepDueSchedules(Date.now());

    expect(globals.__tickRuns).toBe(0);
    expect(listPluginSchedules(db, "ticker")[0]?.nextRunAt).toBe(dueAt);

    quiesce.transition({
      operationId: "update-schedule",
      ownerSecret: "owner-secret",
      expectedPhase: "sealed",
      phase: "activating",
    });
    quiesce.transition({
      operationId: "update-schedule",
      ownerSecret: "owner-secret",
      expectedPhase: "activating",
      phase: "verifying",
    });
    await quiesce.release({
      operationId: "update-schedule",
      ownerSecret: "owner-secret",
      resolution: "completed",
    });
    await service.sweepDueSchedules(Date.now());

    expect(globals.__tickRuns).toBe(1);
    expect(listPluginSchedules(db, "ticker")[0]?.nextRunAt).toBeGreaterThan(
      dueAt,
    );
  });
});
