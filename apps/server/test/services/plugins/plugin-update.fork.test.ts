import { execFile } from "node:child_process";
import { cpSync } from "node:fs";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  acquireWorkQuiesceLease,
  isWorkAdmissionOpen,
  listOpenWorkAdmissions,
  getInstalledPlugin,
  getInstalledPluginRegistration,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { Logger } from "@bb/logger";
import {
  createGitSubdirectoryComparer,
  gitMirrorCacheDir,
  type GitSubdirectoryComparisonFailure,
} from "../../../src/services/plugins/git-subtree-mirror.js";
import {
  PluginInstallCancelledError,
  runCancellableInstall,
} from "../../../src/services/plugins/install-cancellation.js";
import { parsePluginSource } from "../../../src/services/plugins/install-sources.js";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { testLogger } from "../../helpers/test-app.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";
import { WorkQuiesceService } from "../../../src/services/system/work-quiesce.js";

vi.setConfig({ hookTimeout: 30_000, testTimeout: 120_000 });

const logger = testLogger as unknown as Logger;

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run("git", args, { cwd })).stdout.trim();
}

async function commitPlugin(
  repo: string,
  version: string,
  packageName = "bb-plugin-updater",
): Promise<string> {
  await mkdir(repo, { recursive: true });
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({
      name: packageName,
      version,
      bb: {
        name: "Updater fixture",
        description: "Plugin update fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(
    join(repo, "server.ts"),
    `export default function plugin(bb: any) { bb.log.info(${JSON.stringify(version)}); }`,
  );
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-qm", version]);
  return git(repo, ["rev-parse", "HEAD"]);
}

describe("plugin update scheduling", () => {
  it.each(["open", "closed", "stopped"] as const)(
    "handles a lost periodic admission with %s scheduling",
    async (mode) => {
      const HOUR = 60 * 60 * 1_000;
      const raceDb = createMigratedConnection();
      const scheduled: Array<{ delayMs: number; onElapsed: () => void }> = [];
      const notifySystem = vi.fn();
      const raceService = createPluginService({
        aiServices: createAiServiceRegistry(),
        telemetry: createNoopTelemetryService(),
        db: raceDb,
        hub: {
          getDaemonSessionIdForHost: () => null,
          notifyPluginChanged: () => {},
          notifyPluginSignal: () => 0,
          notifySystem,
          onWatchedTargets: () => () => {},
        },
        logger,
        dataDir: join(tmpdir(), "bb-plugin-periodic-admission-retry-test"),
        appVersion: "1.0.0",
        stabilizationWindowMs: 0,
        scheduleUpdateCheck: (delayMs, onElapsed) => {
          const entry = { delayMs, onElapsed };
          scheduled.push(entry);
          return () => {
            const index = scheduled.indexOf(entry);
            if (index !== -1) scheduled.splice(index, 1);
          };
        },
      });
      const takeScheduled = () => {
        const entry = scheduled.shift();
        if (entry === undefined) throw new Error("missing scheduled check");
        return entry;
      };

      try {
        expect(acquireWorkQuiesceLease(raceDb, {
          operationId: "periodic-activation-race",
          ownerSecretHash: "owner-hash",
          reason: "periodic admission race fixture",
          now: 1,
          expiresAt: 2,
        })).toMatchObject({ kind: "acquired" });
        expect(isWorkAdmissionOpen(raceDb)).toBe(true);
        raceDb.$client.exec(`
          CREATE TABLE periodic_update_activation_loss_hits (id TEXT PRIMARY KEY);
          CREATE TRIGGER lose_periodic_update_admission
          AFTER INSERT ON work_admissions
          WHEN NEW.command_type = 'plugin.update-check'
          BEGIN
            INSERT INTO periodic_update_activation_loss_hits (id) VALUES (NEW.id);
            DELETE FROM work_admissions WHERE id = NEW.id;
            ${mode === "closed" ? "UPDATE work_quiesce SET phase = 'sealed', expires_at = NULL WHERE scope = 'global';" : ""}
          END;
        `);
        raceService.startPeriodicUpdateChecks();
        expect(scheduled.map((entry) => entry.delayMs)).toEqual([6 * HOUR]);
        const elapsed = takeScheduled();
        if (mode === "stopped") await raceService.stopPeriodicUpdateChecks();
        await elapsed.onElapsed();

        expect(raceDb.$client.prepare(
          "SELECT COUNT(*) AS hits FROM periodic_update_activation_loss_hits",
        ).get()).toEqual({ hits: mode === "stopped" ? 0 : 1 });
        expect(isWorkAdmissionOpen(raceDb)).toBe(mode !== "closed");
        expect(listOpenWorkAdmissions(raceDb)).toEqual([]);
        expect(notifySystem).not.toHaveBeenCalled();
        expect(scheduled.map((entry) => entry.delayMs)).toEqual(
          mode === "open" ? [6 * HOUR] : [],
        );

        raceDb.$client.exec("DROP TRIGGER lose_periodic_update_admission");
        if (mode === "open") {
          await takeScheduled().onElapsed();
          expect(notifySystem).toHaveBeenCalledTimes(1);
          expect(notifySystem).toHaveBeenCalledWith(["plugins-changed"]);
          expect(listOpenWorkAdmissions(raceDb)).toEqual([]);
          expect(scheduled.map((entry) => entry.delayMs)).toEqual([6 * HOUR]);
          const afterStop = takeScheduled();
          await raceService.stopPeriodicUpdateChecks();
          await afterStop.onElapsed();
          expect(notifySystem).toHaveBeenCalledTimes(1);
          expect(scheduled).toEqual([]);
        }
      } finally {
        await raceService.stop();
        raceDb.$client.close();
      }
    },
  );

  it("defers periodic checks while sealed and schedules them after release", async () => {
    const HOUR = 60 * 60 * 1_000;
    const emptyDb = createMigratedConnection();
    const scheduled: number[] = [];
    const emptyService = createPluginService({
      aiServices: createAiServiceRegistry(), telemetry: createNoopTelemetryService(), db: emptyDb,
      hub: { getDaemonSessionIdForHost: () => null, notifyPluginChanged: () => {}, notifyPluginSignal: () => 0, notifySystem: () => {}, onWatchedTargets: () => () => {} },
      logger, dataDir: join(tmpdir(), "bb-plugin-update-sealed-test"), appVersion: "1.0.0", stabilizationWindowMs: 0,
      scheduleUpdateCheck: (delayMs) => { scheduled.push(delayMs); return () => {}; },
    });
    const quiesce = new WorkQuiesceService({ db: emptyDb, local: { quiesce: () => emptyService.quiesceBackgroundWork(), release: () => emptyService.resumeBackgroundWork() }, transport: { listConnectedHostIds: () => [], send: async () => { throw new Error("no host barrier expected"); } } });
    try {
      await quiesce.acquire({ operationId: "update-1", ownerSecret: "owner-secret", reason: "VPS update", ttlMs: 60_000 });
      await quiesce.seal({ operationId: "update-1", ownerSecret: "owner-secret", candidateRelease: "candidate", previousRelease: "previous", allowActiveWork: false });
      emptyService.startPeriodicUpdateChecks();
      expect(scheduled).toEqual([]);
      quiesce.transition({ operationId: "update-1", ownerSecret: "owner-secret", expectedPhase: "sealed", phase: "activating" });
      quiesce.transition({ operationId: "update-1", ownerSecret: "owner-secret", expectedPhase: "activating", phase: "verifying" });
      await quiesce.release({ operationId: "update-1", ownerSecret: "owner-secret", resolution: "completed" });
      expect(scheduled).toEqual([6 * HOUR]);
    } finally { await emptyService.stop(); emptyDb.$client.close(); }
  });

  it("rejects an elapsed periodic callback after maintenance closes admission", async () => {
    const emptyDb = createMigratedConnection();
    const scheduled: Array<{ delayMs: number; onElapsed: () => void }> = [];
    const emptyService = createPluginService({
      aiServices: createAiServiceRegistry(), telemetry: createNoopTelemetryService(), db: emptyDb,
      hub: { getDaemonSessionIdForHost: () => null, notifyPluginChanged: () => {}, notifyPluginSignal: () => 0, notifySystem: () => {}, onWatchedTargets: () => () => {} },
      logger, dataDir: join(tmpdir(), "bb-plugin-update-race-test"), appVersion: "1.0.0", stabilizationWindowMs: 0,
      scheduleUpdateCheck: (delayMs, onElapsed) => { scheduled.push({ delayMs, onElapsed }); return () => {}; },
    });
    try {
      emptyService.startPeriodicUpdateChecks();
      const elapsed = scheduled.shift();
      expect(elapsed).toBeDefined();
      const quiesce = new WorkQuiesceService({ db: emptyDb, local: { quiesce: () => emptyService.quiesceBackgroundWork(), release: () => emptyService.resumeBackgroundWork() }, transport: { listConnectedHostIds: () => [], send: async () => { throw new Error("no host barrier expected"); } } });
      await quiesce.acquire({ operationId: "update-race", ownerSecret: "owner-secret", reason: "VPS update", ttlMs: 60_000 });
      elapsed?.onElapsed();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(scheduled).toEqual([]);
    } finally { await emptyService.stop(); emptyDb.$client.close(); }
  });
});
describe("git subdirectory comparer failures", () => {
  const commit = "a".repeat(40);
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-subtree-mirror-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function comparison(url: string) {
    return {
      pluginId: "redaction",
      url,
      subdirectory: "plugins/y",
      fromCommit: commit,
      toCommit: "b".repeat(40),
      otherPluginRoots: [],
    };
  }

  it("reports a failure without the source url or its credentials", async () => {
    const failures: GitSubdirectoryComparisonFailure[] = [];
    const compare = createGitSubdirectoryComparer({
      dataDir,
      withLock: (_key, fn) => fn(),
      onFailure: (failure) => failures.push(failure),
    });
    const url = "https://user:s3cr3t@127.0.0.1:9/org/repo.git";

    await expect(compare(comparison(url))).resolves.toBe(false);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      pluginId: "redaction",
      repository: "127.0.0.1:9/org/repo",
      step: "mirror",
    });
    expect(JSON.stringify(failures)).not.toContain("s3cr3t");
    expect(JSON.stringify(failures)).not.toContain(url);
  });

  it("propagates a cancelled comparison without reporting a failure", async () => {
    const failures: GitSubdirectoryComparisonFailure[] = [];
    const compare = createGitSubdirectoryComparer({
      dataDir,
      withLock: (_key, fn) => fn(),
      onFailure: (failure) => failures.push(failure),
    });

    await expect(
      runCancellableInstall(AbortSignal.abort(), () =>
        compare(comparison("https://127.0.0.1:9/org/repo.git")),
      ),
    ).rejects.toBeInstanceOf(PluginInstallCancelledError);
    expect(failures).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "keeps the mirror when the install is cancelled during the health probe",
    async () => {
      const sourceRepo = join(dataDir, "source-repo");
      await mkdir(sourceRepo, { recursive: true });
      await git(sourceRepo, ["init", "-q", "-b", "main"]);
      await git(sourceRepo, ["config", "user.email", "test@example.com"]);
      await git(sourceRepo, ["config", "user.name", "Test"]);
      const commitFile = async (name: string): Promise<string> => {
        await mkdir(join(sourceRepo, "plugins", "y"), { recursive: true });
        await writeFile(join(sourceRepo, "plugins", "y", name), name);
        await git(sourceRepo, ["add", "-A"]);
        await git(sourceRepo, ["commit", "-qm", name]);
        return git(sourceRepo, ["rev-parse", "HEAD"]);
      };
      const first = await commitFile("a.txt");
      const second = await commitFile("b.txt");
      const failures: GitSubdirectoryComparisonFailure[] = [];
      const compare = createGitSubdirectoryComparer({
        dataDir,
        withLock: (_key, fn) => fn(),
        onFailure: (failure) => failures.push(failure),
      });
      const request = (toCommit: string) => ({
        pluginId: "probe",
        url: sourceRepo,
        subdirectory: "plugins/y",
        fromCommit: first,
        toCommit,
        otherPluginRoots: [],
      });
      await compare(request(second));
      const parsed = parsePluginSource(`git:${sourceRepo}`);
      if (parsed.kind !== "git") throw new Error("expected a git source");
      const mirrorDir = gitMirrorCacheDir(dataDir, parsed.cachePath);
      await stat(join(mirrorDir, "HEAD"));
      const third = await commitFile("c.txt");

      const shimDir = join(dataDir, "shim");
      const marker = join(shimDir, "probe-started");
      const realGit = (await run("which", ["git"])).stdout.trim();
      await mkdir(shimDir, { recursive: true });
      await writeFile(
        join(shimDir, "git"),
        [
          "#!/bin/sh",
          'for arg in "$@"; do',
          '  case "$arg" in',
          "    diff) exit 1;;",
          `    'HEAD^{commit}') : > '${marker}'; sleep 30; exit 1;;`,
          "  esac",
          "done",
          `exec '${realGit}' "$@"`,
          "",
        ].join("\n"),
      );
      await chmod(join(shimDir, "git"), 0o755);
      const originalPath = process.env.PATH;
      process.env.PATH = `${shimDir}:${originalPath}`;
      try {
        const controller = new AbortController();
        const pending = runCancellableInstall(controller.signal, () =>
          compare(request(third)),
        );
        await vi.waitFor(() => stat(marker), { timeout: 15_000 });
        controller.abort();
        await expect(pending).rejects.toBeInstanceOf(
          PluginInstallCancelledError,
        );
      } finally {
        process.env.PATH = originalPath;
      }

      expect(failures).toEqual([]);
      await stat(join(mirrorDir, "HEAD"));
    },
  );
});

describe("plugin update service and routes", () => {
  let seedDir: string;

  let db: DbConnection;

  let workDir: string;

  let repo: string;

  let service: PluginService;

  let materializationCount: number;

  beforeAll(async () => {
    seedDir = await mkdtemp(join(tmpdir(), "bb-plugin-update-seeds-"));
    const seedRepo = join(seedDir, "repo");
    await mkdir(seedRepo, { recursive: true });
    await git(seedRepo, ["init", "-q", "-b", "main"]);
    await git(seedRepo, ["config", "user.email", "test@example.com"]);
    await git(seedRepo, ["config", "user.name", "Test"]);
    await commitPlugin(seedRepo, "1.0.0");

  });

  afterAll(async () => {
    await rm(seedDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    db = createMigratedConnection();
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-update-"));
    repo = join(workDir, "repo");
    cpSync(join(seedDir, "repo"), repo, { recursive: true });
    materializationCount = 0;
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
      appVersion: "1.0.0",
      loadTimeoutMs: 2000,
      stabilizationWindowMs: 0,
      onArtifactMaterialize: () => {
        materializationCount += 1;
      },
    });
    await service.install(`git:${repo}@main`, { kind: "root" });
  }, 30_000);

  afterEach(async () => {
    vi.unstubAllGlobals();
    await service.stop();
    db.$client.close();
    await rm(workDir, { recursive: true, force: true });
  }, 30_000);

  function upsertNpmRow(
    id: string,
    registry: string,
    provenance:
      | { kind: "direct" }
      | { kind: "catalog"; marketplace: string; entryId: string } = {
      kind: "direct",
    },
  ): void {
    const packageName = `bb-plugin-${id}`;
    upsertInstalledPlugin(db, {
      id,
      source: `npm:${packageName}`,
      provenance,
      sourceIntent: {
        kind: "npm",
        packageName,
        registry,
        requestedSpec: "",
        specKind: "default",
      },
      exactResolution: {
        kind: "npm",
        version: "1.0.0",
        integrity: "sha512-current",
      },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: join(workDir, id),
      version: "1.0.0",
      enabled: false,
      enabledFollowsDefault: false,
    });
  }

  async function restartWithScheduler(clock: () => number) {
    const scheduled: Array<{ delayMs: number; onElapsed: () => void }> = [];
    await service.stop();
    service = createPluginService({
      aiServices: createAiServiceRegistry(),
      telemetry: createNoopTelemetryService(),
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginChanged: () => {},
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
        onWatchedTargets: () => () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "1.0.0",
      stabilizationWindowMs: 0,
      now: clock,
      scheduleUpdateCheck: (delayMs, onElapsed) => {
        const entry = { delayMs, onElapsed };
        scheduled.push(entry);
        return () => {
          const index = scheduled.indexOf(entry);
          if (index !== -1) scheduled.splice(index, 1);
        };
      },
    });
    await service.start();
    return scheduled;
  }

  it("waits for an admitted periodic check before maintenance acquisition completes", async () => {
    const scheduled = await restartWithScheduler(Date.now);
    upsertNpmRow("slow-check", "https://slow-check.test");
    let releaseFetch!: (response: Response) => void;
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    vi.stubGlobal("fetch", () => {
      markFetchStarted();
      return new Promise<Response>((resolve) => {
        releaseFetch = resolve;
      });
    });
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

    service.startPeriodicUpdateChecks();
    const elapsed = scheduled.shift();
    expect(elapsed).toBeDefined();
    elapsed?.onElapsed();
    await fetchStarted;

    let acquired = false;
    const acquisition = quiesce
      .acquire({
        operationId: "update-in-flight",
        ownerSecret: "owner-secret",
        reason: "VPS update",
        ttlMs: 60_000,
      })
      .then(() => {
        acquired = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acquired).toBe(false);

    releaseFetch(
      new Response(
        JSON.stringify({
          versions: {
            "1.0.0": {
              version: "1.0.0",
              dist: { integrity: "sha512-current" },
            },
          },
          "dist-tags": { latest: "1.0.0" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await acquisition;

    expect(acquired).toBe(true);
    expect(scheduled).toEqual([]);
  });

  it("sweeps on start when a plugin was never checked, then waits out the interval across restarts", async () => {
    const HOUR = 60 * 60 * 1_000;
    let clock = Date.now();
    let scheduled = await restartWithScheduler(() => clock);
    const nextCommit = await commitPlugin(repo, "1.1.0");

    service.startPeriodicUpdateChecks();
    expect(scheduled.map((entry) => entry.delayMs)).toEqual([0]);
    scheduled.shift()?.onElapsed();
    await vi.waitFor(
      () =>
        expect(getInstalledPlugin(db, "updater")).toMatchObject({
          lastUpdateCheckAt: clock,
          availableCompatibleVersion: nextCommit,
        }),
      { timeout: 30_000 },
    );
    await vi.waitFor(
      () => expect(scheduled.map((entry) => entry.delayMs)).toEqual([6 * HOUR]),
      { timeout: 30_000 },
    );
    await service.stopPeriodicUpdateChecks();
    expect(scheduled).toHaveLength(0);

    clock += 2 * HOUR;
    scheduled = await restartWithScheduler(() => clock);
    service.startPeriodicUpdateChecks();
    expect(scheduled.map((entry) => entry.delayMs)).toEqual([4 * HOUR]);
    await service.stopPeriodicUpdateChecks();

    upsertNpmRow("never-checked", "https://never-checked.test");
    await service.checkForUpdates("updater");
    service.startPeriodicUpdateChecks();
    expect(scheduled.map((entry) => entry.delayMs)).toEqual([0]);
    await service.stopPeriodicUpdateChecks();
  }, 60_000);

  describe("collection repo with unchanged plugin subdirectories", () => {
    function commitSubdirectory(
      name: string,
      version: string,
    ): Promise<string> {
      return commitPlugin(
        join(repo, "plugins", name),
        version,
        `bb-plugin-collection-${name}`,
      );
    }

    async function installCollection(names: string[]): Promise<string> {
      await service.remove("updater");
      let commit = "";
      for (const name of names) {
        commit = await commitSubdirectory(name, "1.0.0");
      }
      for (const name of names) {
        await service.install(`git:${repo}@main`, {
          kind: "subdirectory",
          path: `plugins/${name}`,
        });
      }
      return commit;
    }

    it("reports an untouched subdirectory as current without staging it", async () => {
      const installedCommit = await installCollection(["x", "y"]);
      const nextCommit = await commitSubdirectory("x", "1.1.0");
      const stagedBefore = materializationCount;

      const unchanged = await service.checkForUpdates("collection-y");
      expect(unchanged).toMatchObject([
        { id: "collection-y", outcome: "current" },
      ]);
      expect(materializationCount).toBe(stagedBefore);
      await expect(service.applyUpdate("collection-y")).resolves.toMatchObject({
        ok: true,
        result: { applied: false, outcome: "current" },
      });
      expect(materializationCount).toBe(stagedBefore);
      expect(getInstalledPluginRegistration(db, "collection-y")).toMatchObject({
        gitResolvedCommit: installedCommit,
      });

      await expect(
        service.checkForUpdates("collection-x"),
      ).resolves.toMatchObject([
        {
          id: "collection-x",
          outcome: "update-available",
          candidate: { version: nextCommit },
        },
      ]);
      expect(materializationCount).toBeGreaterThan(stagedBefore);
    });

    it("falls back to an update when the mirror cannot be built", async () => {
      await installCollection(["x", "y"]);
      const nextCommit = await commitSubdirectory("x", "1.1.0");
      const mirrorRoot = join(
        workDir,
        "data",
        "plugins",
        "cache",
        "git-mirror",
      );
      await mkdir(mirrorRoot, { recursive: true });
      await writeFile(join(mirrorRoot, "local"), "not a directory");

      await expect(
        service.checkForUpdates("collection-y"),
      ).resolves.toMatchObject([
        {
          id: "collection-y",
          outcome: "update-available",
          candidate: { version: nextCommit },
        },
      ]);
    });

    async function commitFile(path: string, content: string): Promise<string> {
      const target = join(repo, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
      await git(repo, ["add", "-A"]);
      await git(repo, ["commit", "-qm", `touch ${path}`]);
      return git(repo, ["rev-parse", "HEAD"]);
    }

    function collectionMirrorDir(): string {
      const parsed = parsePluginSource(`git:${repo}`);
      if (parsed.kind !== "git") throw new Error("expected a git source");
      return gitMirrorCacheDir(join(workDir, "data"), parsed.cachePath);
    }

    it.each([
      ["a root file", "tsconfig.json"],
      ["a non-sibling directory", "shared/helper.ts"],
      ["a file beside the plugin directories", "plugins/README.md"],
    ])("treats a change in %s as an update", async (_label, path) => {
      await installCollection(["x", "y"]);
      const nextCommit = await commitFile(path, "{}");

      await expect(
        service.checkForUpdates("collection-y"),
      ).resolves.toMatchObject([
        {
          id: "collection-y",
          outcome: "update-available",
          candidate: { version: nextCommit },
        },
      ]);
    });

    it.skipIf(process.platform === "win32")(
      "treats a subtree that contains a symlink as changed by any commit",
      async () => {
        await service.remove("updater");
        await commitSubdirectory("x", "1.0.0");
        await commitSubdirectory("y", "1.0.0");
        await symlink("server.ts", join(repo, "plugins", "y", "alias.ts"));
        await git(repo, ["add", "-A"]);
        await git(repo, ["commit", "-qm", "alias"]);
        for (const name of ["x", "y"]) {
          await service.install(`git:${repo}@main`, {
            kind: "subdirectory",
            path: `plugins/${name}`,
          });
        }
        const nextCommit = await commitSubdirectory("x", "1.1.0");

        await expect(
          service.checkForUpdates("collection-y"),
        ).resolves.toMatchObject([
          {
            id: "collection-y",
            outcome: "update-available",
            candidate: { version: nextCommit },
          },
        ]);
      },
    );

    it.skipIf(process.platform === "win32")(
      "treats a symlinked plugin directory as changed when its target changes",
      async () => {
        await service.remove("updater");
        await commitSubdirectory("actual", "1.0.0");
        await symlink("actual", join(repo, "plugins", "linked"));
        await mkdir(join(repo, ".bb"), { recursive: true });
        await writeFile(
          join(repo, ".bb", "plugins.json"),
          JSON.stringify({
            schemaVersion: 1,
            name: "collection",
            plugins: [{ name: "linked", source: "./plugins/linked" }],
          }),
        );
        await git(repo, ["add", "-A"]);
        await git(repo, ["commit", "-qm", "link"]);
        await service.install(`git:${repo}@main`, {
          kind: "entry",
          name: "linked",
        });
        expect(
          getInstalledPluginRegistration(db, "collection-actual"),
        ).toMatchObject({ sourceGitSubdirectory: "plugins/linked" });
        const nextCommit = await commitSubdirectory("actual", "1.1.0");

        await expect(
          service.checkForUpdates("collection-actual"),
        ).resolves.toMatchObject([
          {
            id: "collection-actual",
            outcome: "update-available",
            candidate: { version: nextCommit },
          },
        ]);
      },
    );

    it("reuses the mirror and re-applies the origin url on later checks", async () => {
      await installCollection(["x", "y"]);
      await commitSubdirectory("x", "1.1.0");
      await expect(
        service.checkForUpdates("collection-y"),
      ).resolves.toMatchObject([{ outcome: "current" }]);
      const mirrorDir = collectionMirrorDir();
      await writeFile(join(mirrorDir, "reuse-marker"), "kept");
      await git(mirrorDir, ["remote", "set-url", "origin", "/nonexistent"]);
      const nextCommit = await commitFile("plugins/x/notes.md", "more");
      const stagedBefore = materializationCount;

      const results = await service.checkForUpdates("collection-y");

      expect(results).toMatchObject([
        { id: "collection-y", outcome: "current" },
      ]);
      expect(materializationCount).toBe(stagedBefore);
      expect(await readFile(join(mirrorDir, "reuse-marker"), "utf8")).toBe(
        "kept",
      );
      expect(
        await git(mirrorDir, ["rev-parse", `${nextCommit}^{commit}`]),
      ).toBe(nextCommit);
      expect(await git(mirrorDir, ["remote", "get-url", "origin"])).toBe(repo);
    });

    it("treats a change beside the plugin of a top-level plugin as an update", async () => {
      await service.remove("updater");
      await commitPlugin(
        join(repo, "y"),
        "1.0.0",
        "bb-plugin-collection-y",
      );
      await service.install(`git:${repo}@main`, {
        kind: "subdirectory",
        path: "y",
      });
      const nextCommit = await commitFile("shared/helper.ts", "export {};");

      await expect(
        service.checkForUpdates("collection-y"),
      ).resolves.toMatchObject([
        { outcome: "update-available", candidate: { version: nextCommit } },
      ]);
    });

    it("treats a change in a directory that is not an installed plugin as an update", async () => {
      await installCollection(["x", "y"]);
      const nextCommit = await commitFile(
        "plugins/common/util.ts",
        "export {};",
      );

      await expect(
        service.checkForUpdates("collection-y"),
      ).resolves.toMatchObject([
        { outcome: "update-available", candidate: { version: nextCommit } },
      ]);
    });

    it("ignores a non-ASCII file inside another installed plugin", async () => {
      await installCollection(["x", "y"]);
      await commitFile("plugins/x/héllo wörld.md", "notes");
      const stagedBefore = materializationCount;

      await expect(
        service.checkForUpdates("collection-y"),
      ).resolves.toMatchObject([{ outcome: "current" }]);
      expect(materializationCount).toBe(stagedBefore);
    });

    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "logs a failed comparison and keeps a healthy mirror",
      async () => {
        await installCollection(["x", "y"]);
        await commitSubdirectory("x", "1.1.0");
        await expect(
          service.checkForUpdates("collection-y"),
        ).resolves.toMatchObject([{ outcome: "current" }]);
        const mirrorDir = collectionMirrorDir();
        await writeFile(join(mirrorDir, "reuse-marker"), "kept");
        const nextCommit = await commitFile("plugins/x/notes.md", "more");
        const warn = vi.spyOn(logger, "warn");
        const lockedDirs = [
          join(mirrorDir, "objects", "pack"),
          join(mirrorDir, "objects"),
        ];
        for (const dir of lockedDirs) await chmod(dir, 0o555);
        try {
          await expect(
            service.checkForUpdates("collection-y"),
          ).resolves.toMatchObject([
            { outcome: "update-available", candidate: { version: nextCommit } },
          ]);
        } finally {
          for (const dir of [...lockedDirs].reverse()) await chmod(dir, 0o755);
        }

        const warnings = warn.mock.calls;
        warn.mockRestore();
        expect(warnings).toContainEqual([
          expect.objectContaining({
            step: "fetch",
            pluginId: "collection-y",
          }),
          expect.stringContaining("treating the plugin as changed"),
        ]);
        expect(await readFile(join(mirrorDir, "reuse-marker"), "utf8")).toBe(
          "kept",
        );
      },
    );

    it("removes a broken mirror and rebuilds it on the next check", async () => {
      await installCollection(["x", "y"]);
      await commitSubdirectory("x", "1.1.0");
      await expect(
        service.checkForUpdates("collection-y"),
      ).resolves.toMatchObject([{ outcome: "current" }]);
      const mirrorDir = collectionMirrorDir();
      await rm(join(mirrorDir, "objects"), { recursive: true, force: true });
      await rm(join(mirrorDir, "refs"), { recursive: true, force: true });
      await commitFile("plugins/x/notes.md", "more");

      await expect(
        service.checkForUpdates("collection-y"),
      ).resolves.toMatchObject([{ outcome: "update-available" }]);
      await expect(stat(mirrorDir)).rejects.toMatchObject({ code: "ENOENT" });

      await expect(
        service.checkForUpdates("collection-y"),
      ).resolves.toMatchObject([{ outcome: "current" }]);
      await stat(join(mirrorDir, "HEAD"));
    });

    it("does not ignore a change under an ancestor plugin of the checked plugin", async () => {
      await service.remove("updater");
      await commitPlugin(
        join(repo, "plugins"),
        "1.0.0",
        "bb-plugin-collection-all",
      );
      await commitSubdirectory("x", "1.0.0");
      for (const path of ["plugins", "plugins/x"]) {
        await service.install(`git:${repo}@main`, {
          kind: "subdirectory",
          path,
        });
      }
      const nextCommit = await commitFile("plugins/x/notes.md", "more");

      await expect(
        service.checkForUpdates("collection-x"),
      ).resolves.toMatchObject([
        { outcome: "update-available", candidate: { version: nextCommit } },
      ]);
    });

    it("does not ignore a change under a plugin nested inside the checked plugin", async () => {
      await service.remove("updater");
      await commitSubdirectory("x", "1.0.0");
      await commitPlugin(
        join(repo, "plugins", "x", "inner"),
        "1.0.0",
        "bb-plugin-collection-inner",
      );
      for (const path of ["plugins/x", "plugins/x/inner"]) {
        await service.install(`git:${repo}@main`, {
          kind: "subdirectory",
          path,
        });
      }
      const nextCommit = await commitFile("plugins/x/inner/notes.md", "more");

      await expect(
        service.checkForUpdates("collection-x"),
      ).resolves.toMatchObject([
        { outcome: "update-available", candidate: { version: nextCommit } },
      ]);
    });

    it("ignores only plugins installed from the same repository", async () => {
      await installCollection(["y"]);
      const otherRepo = join(workDir, "other-repo");
      await mkdir(otherRepo, { recursive: true });
      await git(otherRepo, ["init", "-q", "-b", "main"]);
      await git(otherRepo, ["config", "user.email", "test@example.com"]);
      await git(otherRepo, ["config", "user.name", "Test"]);
      await commitPlugin(
        join(otherRepo, "plugins", "x"),
        "1.0.0",
        "bb-plugin-other-x",
      );
      await service.install(`git:${otherRepo}@main`, {
        kind: "subdirectory",
        path: "plugins/x",
      });
      const nextCommit = await commitSubdirectory("x", "1.1.0");

      await expect(
        service.checkForUpdates("collection-y"),
      ).resolves.toMatchObject([
        { outcome: "update-available", candidate: { version: nextCommit } },
      ]);
    });

    it("rebuilds a mirror that was left unusable", async () => {
      await installCollection(["x", "y"]);
      await commitSubdirectory("x", "1.1.0");
      const mirrorDir = collectionMirrorDir();
      await mkdir(mirrorDir, { recursive: true });
      await writeFile(join(mirrorDir, "HEAD"), "garbage");

      await expect(
        service.checkForUpdates("collection-y"),
      ).resolves.toMatchObject([{ outcome: "update-available" }]);

      await expect(
        service.checkForUpdates("collection-y"),
      ).resolves.toMatchObject([{ outcome: "current" }]);
    });

    it("shares one mirror between concurrent checks of the same repository", async () => {
      await installCollection(["x", "y", "z"]);
      await commitSubdirectory("x", "1.1.0");
      const stagedBefore = materializationCount;

      const results = await service.checkForUpdates();

      expect(
        Object.fromEntries(results.map((entry) => [entry.id, entry.outcome])),
      ).toEqual({
        "collection-x": "update-available",
        "collection-y": "current",
        "collection-z": "current",
      });
      expect(materializationCount).toBe(stagedBefore + 1);
    });
  });
});
