import { describe, expect, it } from "vitest";
import { createConnection } from "../src/connection.js";
import { migrate } from "../src/migrate.js";
import {
  applyPublicHistory,
  createForkHistory,
  publicMigrationIdentity,
} from "./fixtures/fork-history.fork.js";

type MigrationTable = "__bb_fork_migrations" | "__drizzle_migrations";
type MasterTable = "sqlite_master" | "sqlite_temp_master";

interface SchemaObject {
  name: string;
  sql: string | null;
  tblName: string;
  type: string;
}

interface MigrationRow {
  createdAt: number | null;
  hash: string;
}

function hasTable(
  db: ReturnType<typeof createConnection>,
  master: MasterTable,
  table: string,
): boolean {
  return (
    db.$client
      .prepare<[string], { found: number }>(
        `SELECT 1 AS found FROM ${master} WHERE type = 'table' AND name = ?`,
      )
      .get(table) !== undefined
  );
}

function migrationRows(
  db: ReturnType<typeof createConnection>,
  table: MigrationTable,
): MigrationRow[] {
  if (!hasTable(db, "sqlite_master", table)) return [];
  return db.$client
    .prepare<[], MigrationRow>(
      `SELECT hash, created_at AS createdAt FROM ${table} ORDER BY created_at, id`,
    )
    .all();
}

function schemaObjects(
  db: ReturnType<typeof createConnection>,
  master: MasterTable,
): SchemaObject[] {
  return db.$client
    .prepare<[], SchemaObject>(
      `SELECT type, name, tbl_name AS tblName, sql FROM ${master} ORDER BY type, name`,
    )
    .all();
}

function temporaryData(db: ReturnType<typeof createConnection>): unknown[] {
  return [
    "bb_migration_existing_installation",
    "bb_migration_local_host",
    "bb_migration_queued_message_groups",
  ].map((table) => {
    if (!hasTable(db, "sqlite_temp_master", table)) return { table, rows: [] };
    return {
      table,
      rows: db.$client.prepare(`SELECT * FROM ${table}`).all(),
    };
  });
}

function sourceData(db: ReturnType<typeof createConnection>): unknown[] {
  return [
    "fork_spend_prices",
    "fork_thread_execution_reports",
    "fork_thread_spend_cursor",
    "fork_thread_spend_daily",
  ].map((table) => ({
    rows: hasTable(db, "sqlite_master", table)
      ? db.$client.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
      : [],
    table,
  }));
}

function snapshot(db: ReturnType<typeof createConnection>): unknown {
  return {
    foreignKeys: db.$client.pragma("foreign_keys", { simple: true }),
    forkLedger: migrationRows(db, "__bb_fork_migrations"),
    permanentSchema: schemaObjects(db, "sqlite_master"),
    publicLedger: migrationRows(db, "__drizzle_migrations"),
    sourceData: sourceData(db),
    temporaryData: temporaryData(db),
    temporarySchema: schemaObjects(db, "sqlite_temp_master"),
    threads: db.$client.prepare("SELECT * FROM threads ORDER BY id").all(),
  };
}

function expectPreflightFailure(
  db: ReturnType<typeof createConnection>,
  message: string,
): void {
  db.$client.pragma("foreign_keys = OFF");
  const before = snapshot(db);

  expect(() => migrate(db)).toThrow(message);
  expect(snapshot(db)).toEqual(before);
}

function hasSchemaObject(
  db: ReturnType<typeof createConnection>,
  type: "index" | "table",
  name: string,
): boolean {
  return (
    db.$client
      .prepare<[string, string]>(
        "SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?",
      )
      .get(type, name) !== undefined
  );
}

function insertThread(db: ReturnType<typeof createConnection>): void {
  db.$client.exec(`
    INSERT INTO projects (id, name, created_at, updated_at)
      VALUES ('project-1', 'Project 1', 1, 1);
    INSERT INTO threads (
      id, project_id, provider_id, latest_attention_at, created_at, updated_at
    ) VALUES ('thread-1', 'project-1', 'codex', 1, 1, 1);
  `);
}

function seedSourceData(db: ReturnType<typeof createConnection>): void {
  db.$client.exec(`
    INSERT INTO fork_thread_execution_reports (
      thread_id, model, reasoning_level, permission_mode, service_tier, reported_at
    ) VALUES ('thread-1', 'gpt-5', 'high', 'full', 'priority', 1);
    INSERT INTO fork_spend_prices (
      provider_id, model, input_usd_per_mtok, cached_input_usd_per_mtok, output_usd_per_mtok
    ) VALUES ('codex', 'gpt-5', 1, 0.5, 2);
    INSERT INTO fork_thread_spend_cursor (
      thread_id, provider_thread_id, last_sequence, last_total_tokens, first_sequence,
      history_complete, last_turn_id, last_model
    ) VALUES ('thread-1', 'provider-thread-1', 2, 3, 1, 1, 'turn-1', 'gpt-5');
    INSERT INTO fork_thread_spend_daily (
      day, thread_id, provider_id, model, input_tokens, cached_input_tokens,
      output_tokens, reasoning_output_tokens, total_tokens, weighted_units, turns,
      first_event_at, last_event_at
    ) VALUES ('2026-11-06', 'thread-1', 'codex', 'gpt-5', 1, 2, 3, 4, 10, 5, 1, 1, 2);
  `);
}

const repairCases = [
  ["0117_machine_providers", 117, (db: ReturnType<typeof createConnection>) =>
    expect(hasSchemaObject(db, "table", "environment_hook_operations")).toBe(
      true,
    )],
  ["0118_brave_marvel_zombies", 118, (db: ReturnType<typeof createConnection>) =>
    expect(hasSchemaObject(db, "table", "thread_plugin_metadata")).toBe(true)],
  ["0119_provider_model_catalogs", 119, (db: ReturnType<typeof createConnection>) =>
    expect(hasSchemaObject(db, "table", "provider_model_catalogs")).toBe(true)],
  ["0120_perfect_clint_barton", 120, (db: ReturnType<typeof createConnection>) =>
    expect(
      db.$client
        .prepare(
          "SELECT name FROM pragma_table_info('threads') WHERE name = 'storage_deleted_at'",
        )
        .get(),
    ).toEqual({ name: "storage_deleted_at" })],
  ["0121_fluffy_major_mapleleaf", 121, (db: ReturnType<typeof createConnection>) =>
    expect(hasSchemaObject(db, "index", "threads_lifecycle_owner_idx")).toBe(
      true,
    )],
  ["0122_attachment_accounting", 122, (db: ReturnType<typeof createConnection>) =>
    expect(hasSchemaObject(db, "table", "project_attachments")).toBe(true)],
  ["0123_cheerful_tomorrow_man", 123, (db: ReturnType<typeof createConnection>) =>
    expect(hasSchemaObject(db, "table", "environment_variables")).toBe(true)],
  ["0124_thread_pruning", 124, (db: ReturnType<typeof createConnection>) =>
    expect(hasSchemaObject(db, "table", "thread_pruning_cursors")).toBe(true)],
  ["0125_silent_guardian", 125, (db: ReturnType<typeof createConnection>) =>
    expect(hasSchemaObject(db, "index", "events_provider_identity_idx")).toBe(
      true,
    )],
  ["0126_overconfident_vin_gonzales", 126, (db: ReturnType<typeof createConnection>) =>
    expect(
      db.$client
        .prepare(
          "SELECT name FROM pragma_table_info('queued_thread_messages') WHERE name = 'origin'",
        )
        .get(),
    ).toEqual({ name: "origin" })],
] as const;

function adoptLegacyQuiesce(db: ReturnType<typeof createConnection>): void {
  db.$client.exec("DELETE FROM __bb_fork_migrations");
  db.$client
    .prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    )
    .run(
      "f162a056f845a9e712b63f50351f0651858c5659c6c2fc05cd063f49c15ca87f",
      1_789_631_822_477,
    );
}

describe("fork migration preflight", () => {
  it.each([
    ["duplicate", 2, (db: ReturnType<typeof createConnection>) => {
      db.$client.exec(`
        INSERT INTO __bb_fork_migrations (hash, created_at)
        SELECT hash, created_at FROM __bb_fork_migrations ORDER BY id LIMIT 1;
      `);
    }],
    ["unknown trailing row", 2, (db: ReturnType<typeof createConnection>) => {
      db.$client
        .prepare(
          "INSERT INTO __bb_fork_migrations (hash, created_at) VALUES ('unknown', 9999999999999)",
        )
        .run();
    }],
    ["NULL timestamp", 2, (db: ReturnType<typeof createConnection>) => {
      db.$client
        .prepare(
          "UPDATE __bb_fork_migrations SET created_at = NULL WHERE rowid = (SELECT rowid FROM __bb_fork_migrations ORDER BY created_at LIMIT 1)",
        )
        .run();
    }],
    ["wrong timestamp", 2, (db: ReturnType<typeof createConnection>) => {
      db.$client
        .prepare(
          "UPDATE __bb_fork_migrations SET created_at = 1 WHERE rowid = (SELECT rowid FROM __bb_fork_migrations ORDER BY created_at LIMIT 1)",
        )
        .run();
    }],
    ["bad hash", 2, (db: ReturnType<typeof createConnection>) => {
      db.$client
        .prepare(
          "UPDATE __bb_fork_migrations SET hash = 'bad' WHERE rowid = (SELECT rowid FROM __bb_fork_migrations ORDER BY created_at LIMIT 1)",
        )
        .run();
    }],
    ["actual missing middle row", 3, (db: ReturnType<typeof createConnection>) => {
      db.$client
        .prepare(
          "DELETE FROM __bb_fork_migrations WHERE rowid = (SELECT rowid FROM __bb_fork_migrations ORDER BY created_at LIMIT 1 OFFSET 1)",
        )
        .run();
    }],
  ])("rejects %s before any migration effect", (_name, prefix, mutate) => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, prefix);
      mutate(db);

      expectPreflightFailure(db, "Fork migration history is invalid");
    } finally {
      db.$client.close();
    }
  });

  it("rejects an unrelated public base hole before any migration effect", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 1, 127);
      db.$client.exec(`
        DELETE FROM __drizzle_migrations
        WHERE rowid = (
          SELECT rowid FROM __drizzle_migrations ORDER BY created_at LIMIT 1 OFFSET 116
        );
      `);

      expectPreflightFailure(db, "Fork public migration history is invalid");
    } finally {
      db.$client.close();
    }
  });

  it.each([
    [
      "an empty",
      (db: ReturnType<typeof createConnection>) =>
        db.$client.exec("DELETE FROM __drizzle_migrations"),
    ],
    [
      "a truncated",
      (db: ReturnType<typeof createConnection>) =>
        db.$client
          .prepare(
            "DELETE FROM __drizzle_migrations WHERE created_at >= ?",
          )
          .run(publicMigrationIdentity(116).createdAt),
    ],
  ])(
    "rejects %s public prerequisite ledger before any migration effect",
    (_name, corrupt) => {
      const db = createConnection(":memory:");
      try {
        createForkHistory(db, 5);
        insertThread(db);
        seedSourceData(db);
        corrupt(db);

        expectPreflightFailure(db, "Fork public migration history is invalid");
      } finally {
        db.$client.close();
      }
    },
  );

  it.each([
    [
      "compatible hash",
      1_781_403_656_069,
      "bc111f5134183c37cf135af70231ec5a79823f9868818fdd8377e1ab3c05a23f",
    ],
    ["published timestamp", 1_778_891_867_195, "published-baseline"],
    ["published timestamp", 1_779_139_400_000, "published-input"],
    ["published timestamp", 1_779_139_400_001, "published-prune"],
  ])(
    "keeps an accepted %s base identity without rewriting it",
    (_name, createdAt, hash) => {
      const db = createConnection(":memory:");
      try {
        createForkHistory(db, 1);
        db.$client
          .prepare("UPDATE __drizzle_migrations SET hash = ? WHERE created_at = ?")
          .run(hash, createdAt);

        migrate(db);

        expect(
          db.$client
            .prepare(
              "SELECT hash FROM __drizzle_migrations WHERE created_at = ?",
            )
            .get(createdAt),
        ).toEqual({ hash });
      } finally {
        db.$client.close();
      }
    },
  );

  it("rejects an unaccepted known base identity before any migration effect", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 1);
      db.$client
        .prepare(
          "UPDATE __drizzle_migrations SET hash = 'bad' WHERE created_at = 1781403656069",
        )
        .run();

      expectPreflightFailure(db, "Fork public migration history is invalid");
    } finally {
      db.$client.close();
    }
  });

  it("does not mistake a wrong legacy timestamp for the old quiesce identity", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 1);
      db.$client
        .prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        )
        .run(
          "f162a056f845a9e712b63f50351f0651858c5659c6c2fc05cd063f49c15ca87f",
          1_789_631_822_478,
        );

      migrate(db);

      expect(
        db.$client
          .prepare(
            "SELECT hash, created_at AS createdAt FROM __drizzle_migrations WHERE created_at = 1789631822478",
          )
          .get(),
      ).toEqual({
        createdAt: 1_789_631_822_478,
        hash: "f162a056f845a9e712b63f50351f0651858c5659c6c2fc05cd063f49c15ca87f",
      });
    } finally {
      db.$client.close();
    }
  });

  it.each([
    [
      "promotion target default",
      3,
      (db: ReturnType<typeof createConnection>) =>
        db.$client.exec(`
          ALTER TABLE threads DROP COLUMN promotion_target;
          ALTER TABLE threads ADD promotion_target text DEFAULT 'branch' NOT NULL;
        `),
      "0002_sparkling_cannonball: promotion_target",
    ],
    [
      "adopted status nullability",
      4,
      (db: ReturnType<typeof createConnection>) =>
        db.$client.exec(`
          ALTER TABLE environments DROP COLUMN adopted_from_status;
          ALTER TABLE environments ADD adopted_from_status text NOT NULL DEFAULT 'adopted';
        `),
      "0003_environment_adopted_from_status: adopted_from_status",
    ],
    [
      "work admission check",
      1,
      (db: ReturnType<typeof createConnection>) =>
        db.$client.exec(`
          DROP TABLE work_admissions;
          CREATE TABLE work_admissions (
            id text PRIMARY KEY NOT NULL,
            command_type text NOT NULL,
            transport text NOT NULL,
            host_id text,
            context_json text DEFAULT '{}' NOT NULL,
            state text NOT NULL,
            created_at integer NOT NULL,
            settled_at integer,
            CONSTRAINT work_admissions_transport_valid CHECK(transport in ('settled')),
            CONSTRAINT work_admissions_state_valid CHECK(state in ('pending', 'active', 'settled'))
          );
        `),
      "0000_work_quiesce",
    ],
  ])(
    "rejects an altered represented %s before any migration effect",
    (_name, prefix, mutate, message) => {
      const db = createConnection(":memory:");
      try {
        createForkHistory(db, prefix);
        mutate(db);

        expectPreflightFailure(db, message);
      } finally {
        db.$client.close();
      }
    },
  );

  it.each(repairCases)(
    "repairs reflected %s with exact legacy quiesce provenance",
    (_tag, index, assertSchema) => {
      const db = createConnection(":memory:");
      try {
        createForkHistory(db, 1, 117);
        insertThread(db);
        applyPublicHistory(db, 117, 127);
        db.$client.exec(`
          DELETE FROM __drizzle_migrations
          WHERE created_at >= ${publicMigrationIdentity(117).createdAt}
            AND created_at <= ${publicMigrationIdentity(126).createdAt};
        `);
        if (index === 120) {
          db.$client
            .prepare(
              "UPDATE threads SET storage_deleted_at = 4242 WHERE id = 'thread-1'",
            )
            .run();
        }
        adoptLegacyQuiesce(db);

        migrate(db);

        const identity = publicMigrationIdentity(index);
        expect(
          db.$client
            .prepare(
              "SELECT hash FROM __drizzle_migrations WHERE created_at = ?",
            )
            .get(identity.createdAt),
        ).toEqual({ hash: identity.hash });
        assertSchema(db);
        expect(
          db.$client
            .prepare("SELECT id FROM threads WHERE id = 'thread-1'")
            .get(),
        ).toEqual({ id: "thread-1" });
        if (index === 120) {
          expect(
            db.$client
              .prepare(
                "SELECT storage_deleted_at FROM threads WHERE id = 'thread-1'",
              )
              .get(),
          ).toEqual({ storage_deleted_at: 4242 });
        }
        const publicHistory = migrationRows(db, "__drizzle_migrations");
        migrate(db);
        expect(migrationRows(db, "__drizzle_migrations")).toEqual(
          publicHistory,
        );
      } finally {
        db.$client.close();
      }
    },
  );

  it.each(repairCases)(
    "repairs genuinely missing %s with exact legacy quiesce provenance",
    (_tag, index, assertSchema) => {
      const db = createConnection(":memory:");
      try {
        const identity = publicMigrationIdentity(index);
        createForkHistory(db, 1, 117);
        insertThread(db);
        applyPublicHistory(db, 117, 127, identity.createdAt, identity.createdAt);
        adoptLegacyQuiesce(db);

        migrate(db);

        expect(
          db.$client
            .prepare(
              "SELECT hash FROM __drizzle_migrations WHERE created_at = ?",
            )
            .get(identity.createdAt),
        ).toEqual({ hash: identity.hash });
        assertSchema(db);
        expect(
          db.$client
            .prepare("SELECT id FROM threads WHERE id = 'thread-1'")
            .get(),
        ).toEqual({ id: "thread-1" });
        const publicHistory = migrationRows(db, "__drizzle_migrations");
        migrate(db);
        expect(migrationRows(db, "__drizzle_migrations")).toEqual(
          publicHistory,
        );
      } finally {
        db.$client.close();
      }
    },
  );
});
