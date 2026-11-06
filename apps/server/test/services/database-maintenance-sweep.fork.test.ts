import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createConnection,
  createProject,
  createThread,
  type DbConnection,
  getDatabaseFreelistStats,
  migrate,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { ServerLogger } from "../../src/types.js";
import { runDatabaseMaintenanceSweep } from "../../src/services/system/periodic-sweeps.js";
import { testLogger } from "../helpers/test-app.js";

const FREELIST_ROW_COUNT = 1_200;

interface TempDatabasePath {
  dbPath: string;
  cleanup(): void;
}

function createTempDatabasePath(): TempDatabasePath {
  const dir = mkdtempSync(join(tmpdir(), "bb-server-db-maintenance-"));
  return {
    cleanup(): void {
      rmSync(dir, { force: true, recursive: true });
    },
    dbPath: join(dir, "bb.db"),
  };
}

function markDatabaseBusy(db: DbConnection): void {
  const host = upsertHost(db, noopNotifier, {
    name: "maintenance-host",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "maintenance-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/project" },
  });
  createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status: "active",
  });
}

function buildFreelist(db: DbConnection): void {
  db.$client.exec(
    "CREATE TABLE scratch_blobs (id INTEGER PRIMARY KEY, blob TEXT)",
  );
  const insert = db.$client.prepare(
    "INSERT INTO scratch_blobs (blob) VALUES (?)",
  );
  const blob = "x".repeat(8 * 1024);
  const insertMany = db.$client.transaction((count: number) => {
    for (let index = 0; index < count; index += 1) {
      insert.run(blob);
    }
  });
  insertMany(FREELIST_ROW_COUNT);
  db.$client.exec("DELETE FROM scratch_blobs");
}

function setupBusyDatabaseWithFreelist() {
  const db = createMigratedConnection();
  markDatabaseBusy(db);
  buildFreelist(db);

  return { db };
}

function setupBusyFileDatabaseWithFreelist(tempDatabase: TempDatabasePath) {
  const db = createConnection(tempDatabase.dbPath);
  migrate(db);
  markDatabaseBusy(db);
  buildFreelist(db);

  return { db };
}

describe("runDatabaseMaintenanceSweep", () => {
  it("reports the reclaimed pages when a writer blocks a later chunk", async () => {
    const tempDatabase = createTempDatabasePath();
    try {
      const { db } = setupBusyFileDatabaseWithFreelist(tempDatabase);
      const writerDb = new Database(tempDatabase.dbPath);
      let writerTransactionOpen = false;
      try {
        const before = getDatabaseFreelistStats(db);
        const warnings: Array<{ fields: unknown; message: string }> = [];
        const infoMessages: string[] = [];
        const logger: ServerLogger = {
          debug(): void {},
          error(): void {},
          info(_fields: unknown, message?: string): void {
            infoMessages.push(message ?? "");
          },
          warn(fields: unknown, message?: string): void {
            warnings.push({ fields, message: message ?? "" });
          },
        };

        const sweep = runDatabaseMaintenanceSweep({ db, logger });
        writerDb.exec("BEGIN IMMEDIATE");
        writerTransactionOpen = true;
        await sweep;

        const after = getDatabaseFreelistStats(db);
        expect(after.freelistCount).toBeLessThan(before.freelistCount);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]?.message).toBe(
          "Incremental database vacuum stopped early",
        );
        expect(warnings[0]?.fields).toMatchObject({
          result: {
            before: { freelistCount: before.freelistCount },
            after: { freelistCount: after.freelistCount },
          },
        });
        expect(infoMessages).toEqual([]);
      } finally {
        if (writerTransactionOpen) {
          writerDb.exec("ROLLBACK");
        }
        writerDb.close();
        db.$client.close();
      }
    } finally {
      tempDatabase.cleanup();
    }
  });

  it("logs a non-busy failure on a later chunk as failed, not stopped early", async () => {
    const { db } = setupBusyDatabaseWithFreelist();
    const warnings: Array<{ fields: unknown; message: string }> = [];
    const infoMessages: string[] = [];
    const logger: ServerLogger = {
      debug(): void {},
      error(): void {},
      info(_fields: unknown, message?: string): void {
        infoMessages.push(message ?? "");
      },
      warn(fields: unknown, message?: string): void {
        warnings.push({ fields, message: message ?? "" });
      },
    };
    try {
      setImmediate(() => {
        db.$client.close();
      });

      await runDatabaseMaintenanceSweep({ db, logger });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toBe("Incremental database vacuum failed");
      expect(warnings[0]?.fields).toMatchObject({
        err: expect.objectContaining({
          message: "The database connection is not open",
        }),
      });
      expect(warnings[0]?.fields).not.toMatchObject({
        err: { code: expect.stringMatching(/^SQLITE_BUSY/u) },
      });
      expect(infoMessages).toEqual([]);
    } finally {
      if (db.$client.open) {
        db.$client.close();
      }
    }
  });

  it("vacuums in chunks and yields to the event loop between them", async () => {
    const { db } = setupBusyDatabaseWithFreelist();
    const before = getDatabaseFreelistStats(db);
    expect(before.freelistCount).toBeGreaterThan(768);
    let ticks = 0;
    let settled = false;
    const tick = (): void => {
      ticks += 1;
      if (!settled) {
        setImmediate(tick);
      }
    };
    setImmediate(tick);

    await runDatabaseMaintenanceSweep({ db, logger: testLogger });
    settled = true;

    expect(ticks).toBeGreaterThanOrEqual(2);
    expect(getDatabaseFreelistStats(db).freelistCount).toBeLessThan(
      before.freelistCount - 512,
    );
  });


});
