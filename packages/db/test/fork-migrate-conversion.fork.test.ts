import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConnection } from "../src/connection.js";
import { migrate } from "../src/migrate.js";
import {
  applyPublicHistory,
  createForkHistory,
} from "./fixtures/fork-history.fork.js";

const publicSuffix = [
  {
    createdAt: 1_793_906_993_789,
    hash: "eebb396f25b009b47f3db65c5a5f9cac9eb48d4230780fc4b88a983ee06fb457",
  },
  {
    createdAt: 1_793_912_000_559,
    hash: "f472fa37032b8c0389a1e55ae8b776fec4a4ca98da5513439907c1ce0938a283",
  },
  {
    createdAt: 1_793_926_996_170,
    hash: "42ccc694713071695eac964d213148c582e6a59934e1465cbb781f4243fb1882",
  },
  {
    createdAt: 1_793_933_265_938,
    hash: "f162a056f845a9e712b63f50351f0651858c5659c6c2fc05cd063f49c15ca87f",
  },
] as const;

const convertedTables = [
  {
    source: "fork_thread_execution_reports",
    target: "thread_execution_reports",
    columns:
      "thread_id, model, reasoning_level, permission_mode, service_tier, reported_at",
    order: "thread_id",
    changedColumn: "reported_at",
  },
  {
    source: "fork_spend_prices",
    target: "spend_prices",
    columns:
      "provider_id, model, input_usd_per_mtok, cached_input_usd_per_mtok, output_usd_per_mtok",
    order: "provider_id, model",
    changedColumn: "input_usd_per_mtok",
  },
  {
    source: "fork_thread_spend_cursor",
    target: "thread_spend_cursor",
    columns:
      "thread_id, provider_thread_id, last_sequence, last_total_tokens, first_sequence, history_complete, last_turn_id, last_model",
    order: "thread_id, provider_thread_id",
    changedColumn: "last_sequence",
  },
  {
    source: "fork_thread_spend_daily",
    target: "thread_spend_daily",
    columns:
      "day, thread_id, provider_id, model, input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens, weighted_units, turns, first_event_at, last_event_at",
    order: "day, thread_id, provider_id, model",
    changedColumn: "input_tokens",
  },
] as const;

type Db = ReturnType<typeof createConnection>;
type ConvertedTable = (typeof convertedTables)[number];

function queryRows(
  db: Db,
  sql: string,
  ...values: unknown[]
): Record<string, unknown>[] {
  return db.$client
    .prepare<unknown[], Record<string, unknown>>(sql)
    .all(...values);
}

function tableRows(
  db: Db,
  table: string,
  order: string,
): Record<string, unknown>[] {
  return queryRows(db, `SELECT * FROM ${table} ORDER BY ${order}`);
}

function migrationRows(
  db: Db,
  table: "__bb_fork_migrations" | "__drizzle_migrations",
): Record<string, unknown>[] {
  return queryRows(
    db,
    `SELECT created_at AS createdAt, hash FROM ${table} ORDER BY created_at`,
  );
}

function suffixRows(db: Db): Record<string, unknown>[] {
  return queryRows(
    db,
    "SELECT created_at AS createdAt, hash FROM __drizzle_migrations WHERE created_at >= ? ORDER BY created_at",
    publicSuffix[0].createdAt,
  );
}

function convertedRows(db: Db, side: "source" | "target") {
  return convertedTables.map((table) => ({
    table: table[side],
    rows: hasSchemaObject(db, "table", table[side])
      ? tableRows(db, table[side], table.order)
      : [],
  }));
}

function conversionState(db: Db) {
  return {
    foreignKeys: db.$client.pragma("foreign_keys", { simple: true }),
    schema: queryRows(
      db,
      "SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    ),
    sources: convertedRows(db, "source"),
    targets: convertedRows(db, "target"),
    privateLedger: migrationRows(db, "__bb_fork_migrations"),
    publicSuffix: suffixRows(db),
  };
}

function insertThread(db: Db, id: string): void {
  db.$client
    .prepare(
      "INSERT INTO threads (id, project_id, provider_id, latest_attention_at, created_at, updated_at) VALUES (?, 'project-1', 'codex', 1, 1, 1)",
    )
    .run(id);
}

function seedSourceRows(db: Db): void {
  db.$client.exec(`
    INSERT INTO projects (id, name, created_at, updated_at)
      VALUES ('project-1', 'Project 1', 1, 1);
  `);
  insertThread(db, "thread-1");
  insertThread(db, "thread-2");
  db.$client.exec(`
    INSERT INTO fork_thread_execution_reports VALUES
      ('thread-1', 'gpt-5', NULL, 'default', NULL, 44),
      ('thread-2', 'gpt-5-mini', 'high', NULL, 'priority', 45);
    INSERT INTO fork_spend_prices VALUES
      ('codex', 'gpt-5', 0.125, 0.03125, 0.5),
      ('codex', 'gpt-5-mini', 0.25, 0.0625, 1.75);
    INSERT INTO fork_thread_spend_cursor VALUES
      ('thread-1', 'provider-thread-1', 15, 1000, 3, 1, NULL, NULL),
      ('thread-2', 'provider-thread-2', 22, 2000, 4, 0, 'turn-2', 'gpt-5-mini');
    INSERT INTO fork_thread_spend_daily VALUES
      ('2026-11-05', 'thread-1', 'codex', 'gpt-5', 8, 9, 10, 11, 12, 13.5, 14, 15, 16),
      ('2026-11-06', 'thread-2', 'codex', 'gpt-5-mini', 18, 19, 20, 21, 22, 23.75, 24, 25, 26);
  `);
}

function copySourceRowsToCanonical(db: Db, table: ConvertedTable): void {
  db.$client.exec(
    `INSERT INTO ${table.target} (${table.columns}) SELECT ${table.columns} FROM ${table.source}`,
  );
}

function hasSchemaObject(
  db: Db,
  type: "index" | "table",
  name: string,
): boolean {
  return (
    queryRows(
      db,
      "SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?",
      type,
      name,
    ).length !== 0
  );
}

describe("fork table conversion", () => {
  it("converts every source table with exact values, public identities, provenance, and cascade behavior", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 5);
      seedSourceRows(db);
      const expectedRows = convertedTables.map((table) => ({
        table: table.target,
        rows: tableRows(db, table.source, table.order),
      }));
      const privateHistory = migrationRows(db, "__bb_fork_migrations");

      migrate(db);

      expect(convertedRows(db, "target")).toEqual(expectedRows);
      expect(suffixRows(db)).toEqual(publicSuffix);
      expect(migrationRows(db, "__bb_fork_migrations")).toEqual(privateHistory);
      for (const table of convertedTables)
        expect(hasSchemaObject(db, "table", table.source)).toBe(false);
      expect(hasSchemaObject(db, "index", "thread_spend_daily_day_idx")).toBe(
        true,
      );
      expect(
        hasSchemaObject(db, "index", "fork_thread_spend_daily_day_idx"),
      ).toBe(false);
      expect(db.$client.pragma("foreign_key_check")).toEqual([]);

      db.$client.prepare("DELETE FROM threads WHERE id = 'thread-1'").run();

      expect(tableRows(db, "thread_execution_reports", "thread_id")).toEqual([
        {
          model: "gpt-5-mini",
          permission_mode: null,
          reasoning_level: "high",
          reported_at: 45,
          service_tier: "priority",
          thread_id: "thread-2",
        },
      ]);
      expect(
        tableRows(db, "thread_spend_cursor", "thread_id, provider_thread_id"),
      ).toHaveLength(2);
      expect(
        tableRows(
          db,
          "thread_spend_daily",
          "day, thread_id, provider_id, model",
        ),
      ).toHaveLength(2);
    } finally {
      db.$client.close();
    }
  });

  it("accepts equal canonical rows in all four tables without duplicates", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 5);
      applyPublicHistory(db, 152, 154);
      seedSourceRows(db);
      const expectedRows = convertedTables.map((table) => ({
        table: table.target,
        rows: tableRows(db, table.source, table.order),
      }));
      for (const table of convertedTables) copySourceRowsToCanonical(db, table);

      migrate(db);

      expect(convertedRows(db, "target")).toEqual(expectedRows);
      for (const table of convertedTables)
        expect(hasSchemaObject(db, "table", table.source)).toBe(false);
      expect(suffixRows(db)).toEqual(publicSuffix);
    } finally {
      db.$client.close();
    }
  });

  it("merges disjoint canonical rows through a partial public suffix without replaying its SQL", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 5);
      applyPublicHistory(db, 152, 154);
      seedSourceRows(db);
      insertThread(db, "thread-3");
      db.$client.exec(`
        INSERT INTO thread_execution_reports VALUES ('thread-3', 'canonical', NULL, NULL, NULL, 90);
        INSERT INTO spend_prices VALUES ('canonical', 'model', 0.5, 0.25, 1.5);
        INSERT INTO thread_spend_cursor VALUES ('thread-3', 'canonical-thread', 1, 2, 1, 0, NULL, NULL);
        INSERT INTO thread_spend_daily VALUES ('2026-11-07', 'thread-3', 'canonical', 'model', 1, 2, 3, 4, 5, 6.25, 7, 8, 9);
      `);
      const sourceRows = convertedRows(db, "source");
      const canonicalRows = convertedRows(db, "target");

      migrate(db);

      for (const table of convertedTables) {
        const source = sourceRows.find((entry) => entry.table === table.source);
        const canonical = canonicalRows.find(
          (entry) => entry.table === table.target,
        );
        const merged = tableRows(db, table.target, table.order);
        expect(merged).toHaveLength(
          source!.rows.length + canonical!.rows.length,
        );
        expect(merged).toEqual(
          expect.arrayContaining([...source!.rows, ...canonical!.rows]),
        );
      }
      expect(suffixRows(db)).toEqual(publicSuffix);
      expect(hasSchemaObject(db, "index", "thread_spend_daily_day_idx")).toBe(
        true,
      );
      for (const table of convertedTables)
        expect(hasSchemaObject(db, "table", table.source)).toBe(false);
    } finally {
      db.$client.close();
    }
  });

  it.each(convertedTables)(
    "rejects a conflicting equal key in $source without changing conversion state",
    (table) => {
      const db = createConnection(":memory:");
      try {
        createForkHistory(db, 5);
        applyPublicHistory(db, 152, 154);
        seedSourceRows(db);
        copySourceRowsToCanonical(db, table);
        db.$client.exec(
          `UPDATE ${table.target} SET ${table.changedColumn} = 999`,
        );
        const before = conversionState(db);

        expect(() => migrate(db)).toThrow(
          `Conflicting source rows in ${table.source}`,
        );

        expect(conversionState(db)).toEqual(before);
      } finally {
        db.$client.close();
      }
    },
  );

  it("rolls back suffix conversion after report copy while retaining the precommitted canonical base", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 5);
      applyPublicHistory(db, 152, 154);
      seedSourceRows(db);
      db.$client.exec(`
        CREATE TRIGGER injected_spend_price_failure
        BEFORE INSERT ON spend_prices
        BEGIN
          SELECT RAISE(ABORT, 'injected spend price failure');
        END;
      `);
      expect(suffixRows(db)).toEqual(publicSuffix.slice(0, 2));
      const before = conversionState(db);

      expect(() => migrate(db)).toThrow("injected spend price failure");

      expect(conversionState(db)).toEqual(before);
      db.$client.exec("DROP TRIGGER injected_spend_price_failure");
      migrate(db);
      expect(suffixRows(db)).toEqual(publicSuffix);
      for (const table of convertedTables)
        expect(hasSchemaObject(db, "table", table.source)).toBe(false);
    } finally {
      db.$client.close();
    }
  });

  it.each([2, 5])(
    "is idempotent after close and reopen for private prefix %i",
    (prefixLength) => {
      const directory = mkdtempSync(join(tmpdir(), "bb-fork-conversion-"));
      const databasePath = join(directory, "history.db");
      let db = createConnection(databasePath);
      try {
        createForkHistory(db, prefixLength);
        if (prefixLength === 5) seedSourceRows(db);
        migrate(db);
        migrate(db);
        const beforeReopen = conversionState(db);
        db.$client.close();
        db = createConnection(databasePath);

        migrate(db);

        expect(conversionState(db)).toEqual(beforeReopen);
      } finally {
        db.$client.close();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
