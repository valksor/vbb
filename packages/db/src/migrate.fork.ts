import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DbConnection } from "./connection.js";
import {
  applyMigrationStatements,
  columnExists,
  findAppliedMigrationHistoryViolation,
  getTableInfo,
  indexExists,
  markMigrationApplied,
  readAppliedMigrationCreatedAts,
  readExpectedAppliedMigrations,
  requireExpectedAppliedMigration,
  tableExists,
  type AppliedMigrationIdentityRow,
  type ExpectedAppliedMigration,
} from "./migrate.js";

interface SchemaSqlRow {
  sql: string | null;
}

const forkMigrationsTable = "__bb_fork_migrations";
const legacyWorkQuiesceMigrationHash =
  "f162a056f845a9e712b63f50351f0651858c5659c6c2fc05cd063f49c15ca87f";
const legacyWorktreePromotionMigrationHash =
  "dbdda013c3b84e828babc97fcebe1761bea42507c6cf8dabcb6dc8b4b392f07d";
const migrationJournalPath = join("meta", "_journal.json");

export function resolveForkMigrationsFolder(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDir, "..", "drizzle-fork"),
    resolve(moduleDir, "drizzle-fork"),
  ];

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, migrationJournalPath))) {
      return candidate;
    }
  }

  throw new Error(
    `Missing database migrations. Expected ${migrationJournalPath} under one of: ${candidates.join(", ")}`,
  );
}

function normalizeSchemaSql(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/\s+/gu, "")
    .replaceAll(/[`"]+/gu, "")
    .replace(/;$/u, "");
}

function requireMigrationObjectSql(
  migration: ExpectedAppliedMigration,
  objectName: string,
): string {
  const normalizedName = objectName.toLowerCase();
  const statement = migration.sql.find((candidate) => {
    const normalized = normalizeSchemaSql(candidate);
    return (
      normalized.startsWith(`createtable${normalizedName}(`) ||
      normalized.startsWith(`createindex${normalizedName}on`) ||
      normalized.startsWith(`createuniqueindex${normalizedName}on`)
    );
  });
  if (statement === undefined) {
    throw new Error(
      `Fork migration ${migration.tag} does not define ${objectName}`,
    );
  }
  return statement;
}

function validateLegacyWorkQuiesceSchema(
  db: DbConnection,
  migration: ExpectedAppliedMigration,
): void {
  const objects = [
    ["table", "work_admissions"],
    ["index", "work_admissions_state_idx"],
    ["index", "work_admissions_host_id_idx"],
    ["table", "work_quiesce"],
    ["index", "work_quiesce_operation_id_unique"],
    ["table", "work_quiesce_resolutions"],
  ] as const;
  const mismatches = objects.filter(([type, name]) => {
    const row = db.$client
      .prepare<[string, string], SchemaSqlRow>(
        "SELECT sql FROM sqlite_master WHERE type = ? AND name = ?",
      )
      .get(type, name);
    return (
      row?.sql === null ||
      row?.sql === undefined ||
      normalizeSchemaSql(row.sql) !==
        normalizeSchemaSql(requireMigrationObjectSql(migration, name))
    );
  });
  if (mismatches.length > 0) {
    throw new Error(
      `Legacy fork migration schema does not match ${migration.tag}: ${mismatches
        .map(([, name]) => name)
        .join(", ")}`,
    );
  }
}

function validateLegacyWorktreePromotionSchema(
  db: DbConnection,
  migration: ExpectedAppliedMigration,
): void {
  const column = getTableInfo(db, "threads").find(
    (candidate) => candidate.name === "worktree_promotion",
  );
  if (
    column === undefined ||
    column.type !== "text" ||
    !column.notNull ||
    column.primaryKey ||
    column.defaultValue !== "'declined'"
  ) {
    throw new Error(
      `Legacy fork migration schema does not match ${migration.tag}: worktree_promotion`,
    );
  }
}

function validateMigrationObjects(
  db: DbConnection,
  migration: ExpectedAppliedMigration,
  objects: readonly ["table" | "index", string][],
): void {
  const mismatches = objects.filter(([type, name]) => {
    const row = db.$client
      .prepare<[string, string], SchemaSqlRow>(
        "SELECT sql FROM sqlite_master WHERE type = ? AND name = ?",
      )
      .get(type, name);
    return (
      row?.sql === null ||
      row?.sql === undefined ||
      normalizeSchemaSql(row.sql) !==
        normalizeSchemaSql(requireMigrationObjectSql(migration, name))
    );
  });
  if (mismatches.length > 0) {
    throw new Error(
      `Fork migration schema does not match ${migration.tag}: ${mismatches
        .map(([, name]) => name)
        .join(", ")}`,
    );
  }
}

function validateConvertedForkSpendSchema(
  db: DbConnection,
  migrationsFolder: string,
): void {
  const migrations = readExpectedAppliedMigrations(migrationsFolder);
  const executionReports = requireExpectedAppliedMigration(
    migrations,
    "0152_chubby_sauron",
  );
  const spend = requireExpectedAppliedMigration(
    migrations,
    "0153_broken_lockheed",
  );
  for (const migration of [executionReports, spend]) {
    if (!hasAppliedMigration(db, migration)) {
      throw new Error(
        `Public migration identity is invalid for ${migration.tag}`,
      );
    }
  }
  validateMigrationObjects(db, executionReports, [
    ["table", "thread_execution_reports"],
  ]);
  validateMigrationObjects(db, spend, [
    ["table", "spend_prices"],
    ["table", "thread_spend_cursor"],
    ["table", "thread_spend_daily"],
    ["index", "thread_spend_daily_day_idx"],
  ]);
}

function validateForkPrefixSchema(
  db: DbConnection,
  migrationsFolder: string,
  migrations: ExpectedAppliedMigration[],
  prefixLength: number,
): void {
  if (prefixLength >= 1) validateLegacyWorkQuiesceSchema(db, migrations[0]!);
  if (prefixLength >= 2)
    validateLegacyWorktreePromotionSchema(db, migrations[1]!);
  if (prefixLength >= 3) {
    validateMigrationObjects(db, migrations[2]!, [
      ["table", "branch_promotions"],
      ["index", "branch_promotions_active_thread_idx"],
      ["index", "branch_promotions_active_environment_idx"],
      ["index", "branch_promotions_thread_created_idx"],
    ]);
    const column = getTableInfo(db, "threads").find(
      (candidate) => candidate.name === "promotion_target",
    );
    if (
      column === undefined ||
      column.type !== "text" ||
      !column.notNull ||
      column.primaryKey ||
      column.defaultValue !== "'worktree'"
    ) {
      throw new Error(
        "Fork migration schema does not match 0002_sparkling_cannonball: promotion_target",
      );
    }
  }
  if (prefixLength >= 4) {
    const column = getTableInfo(db, "environments").find(
      (candidate) => candidate.name === "adopted_from_status",
    );
    if (
      column === undefined ||
      column.type !== "text" ||
      column.notNull ||
      column.primaryKey ||
      column.defaultValue !== null
    ) {
      throw new Error(
        "Fork migration schema does not match 0003_environment_adopted_from_status: adopted_from_status",
      );
    }
  }
  if (prefixLength >= 5) {
    const privateObjects: ["table" | "index", string][] = [
      ["table", "fork_spend_prices"],
      ["table", "fork_thread_execution_reports"],
      ["table", "fork_thread_spend_cursor"],
      ["table", "fork_thread_spend_daily"],
      ["index", "fork_thread_spend_daily_day_idx"],
    ];
    if (
      privateObjects.some(([type, name]) => {
        return (
          db.$client
            .prepare<[string, string], SchemaSqlRow>(
              "SELECT sql FROM sqlite_master WHERE type = ? AND name = ?",
            )
            .get(type, name) !== undefined
        );
      })
    ) {
      validateMigrationObjects(db, migrations[4]!, privateObjects);
    } else {
      validateConvertedForkSpendSchema(db, migrationsFolder);
    }
  }
}

function validatePublicSuffixSchema(
  db: DbConnection,
  migrations: ExpectedAppliedMigration[],
  forkMigrations: ExpectedAppliedMigration[],
): void {
  const executionReports = requireExpectedAppliedMigration(
    migrations,
    "0152_chubby_sauron",
  );
  const spend = requireExpectedAppliedMigration(
    migrations,
    "0153_broken_lockheed",
  );
  const promotion = requireExpectedAppliedMigration(
    migrations,
    "0154_thread_checkout_promotion",
  );
  const quiesce = requireExpectedAppliedMigration(
    migrations,
    "0155_sudden_goliath",
  );
  if (hasAppliedMigration(db, executionReports)) {
    validateMigrationObjects(db, executionReports, [
      ["table", "thread_execution_reports"],
    ]);
  }
  if (hasAppliedMigration(db, spend)) {
    validateMigrationObjects(db, spend, [
      ["table", "spend_prices"],
      ["table", "thread_spend_cursor"],
      ["table", "thread_spend_daily"],
      ["index", "thread_spend_daily_day_idx"],
    ]);
  }
  if (hasAppliedMigration(db, promotion)) {
    validateMigrationObjects(db, promotion, [
      ["table", "branch_promotions"],
      ["index", "branch_promotions_active_thread_idx"],
      ["index", "branch_promotions_active_environment_idx"],
      ["index", "branch_promotions_thread_created_idx"],
    ]);
    validateLegacyWorktreePromotionSchema(db, forkMigrations[1]!);
    const promotionTarget = getTableInfo(db, "threads").find(
      (column) => column.name === "promotion_target",
    );
    if (
      promotionTarget === undefined ||
      promotionTarget.type !== "text" ||
      !promotionTarget.notNull ||
      promotionTarget.primaryKey ||
      promotionTarget.defaultValue !== "'worktree'"
    ) {
      throw new Error(
        "Public migration schema does not match 0154_thread_checkout_promotion: promotion_target",
      );
    }
    const adoptedFromStatus = getTableInfo(db, "environments").find(
      (column) => column.name === "adopted_from_status",
    );
    if (
      adoptedFromStatus === undefined ||
      adoptedFromStatus.type !== "text" ||
      adoptedFromStatus.notNull ||
      adoptedFromStatus.primaryKey ||
      adoptedFromStatus.defaultValue !== null
    ) {
      throw new Error(
        "Public migration schema does not match 0154_thread_checkout_promotion: adopted_from_status",
      );
    }
  }
  if (hasAppliedMigration(db, quiesce)) {
    validateLegacyWorkQuiesceSchema(db, forkMigrations[0]!);
  }
}

function upstreamMigrationIsReflected(db: DbConnection, tag: string): boolean {
  switch (tag) {
    case "0117_machine_providers":
      return (
        tableExists(db, "environment_hook_operations") &&
        columnExists(db, "hosts", "machine_provider_id") &&
        columnExists(db, "hosts", "launch_key") &&
        columnExists(db, "project_sources", "owns_path") &&
        !columnExists(db, "host_daemon_sessions", "host_type")
      );
    case "0118_brave_marvel_zombies":
      return tableExists(db, "thread_plugin_metadata");
    case "0119_provider_model_catalogs":
      return tableExists(db, "provider_model_catalogs");
    case "0120_perfect_clint_barton":
      return columnExists(db, "threads", "storage_deleted_at");
    case "0121_fluffy_major_mapleleaf":
      return (
        columnExists(db, "threads", "lifecycle_owner_thread_id") &&
        indexExists(db, "threads", "threads_lifecycle_owner_idx")
      );
    case "0122_attachment_accounting":
      return (
        tableExists(db, "project_attachment_backfills") &&
        tableExists(db, "project_attachment_threads") &&
        tableExists(db, "project_attachments") &&
        indexExists(db, "threads", "threads_project_id_idx")
      );
    case "0123_cheerful_tomorrow_man":
      return tableExists(db, "environment_variables");
    case "0124_thread_pruning":
      return tableExists(db, "thread_pruning_cursors");
    case "0125_silent_guardian":
      return indexExists(db, "events", "events_provider_identity_idx");
    case "0126_overconfident_vin_gonzales":
      return columnExists(db, "queued_thread_messages", "origin");
    default:
      return false;
  }
}

function repairLegacySkippedUpstreamMigrations(
  db: DbConnection,
  migrationsFolder: string,
): void {
  const expectedMigrations = readExpectedAppliedMigrations(migrationsFolder);
  const appliedCreatedAts = readAppliedMigrationCreatedAts(db);
  for (const tag of [
    "0117_machine_providers",
    "0118_brave_marvel_zombies",
    "0119_provider_model_catalogs",
    "0120_perfect_clint_barton",
    "0121_fluffy_major_mapleleaf",
    "0122_attachment_accounting",
    "0123_cheerful_tomorrow_man",
    "0124_thread_pruning",
    "0125_silent_guardian",
    "0126_overconfident_vin_gonzales",
  ]) {
    const migration = requireExpectedAppliedMigration(expectedMigrations, tag);
    if (appliedCreatedAts.has(migration.createdAt)) {
      continue;
    }
    if (upstreamMigrationIsReflected(db, tag)) {
      markMigrationApplied(db, migration);
    } else {
      applyMigrationStatements(db, migration);
    }
    appliedCreatedAts.add(migration.createdAt);
  }
}

function ensureForkMigrationLedger(db: DbConnection): void {
  db.$client.exec(`
    CREATE TABLE IF NOT EXISTS ${forkMigrationsTable} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);
}

function readForkMigrationRows(
  db: DbConnection,
): AppliedMigrationIdentityRow[] {
  if (!tableExists(db, forkMigrationsTable)) {
    return [];
  }
  return db.$client
    .prepare<[], AppliedMigrationIdentityRow>(
      `SELECT hash, created_at AS createdAt FROM ${forkMigrationsTable} ORDER BY created_at, id`,
    )
    .all();
}

function hasLegacyMigrationRow(
  db: DbConnection,
  hash: string,
  createdAt: number,
): boolean {
  return (
    db.$client
      .prepare<[string, number], { found: number }>(
        "SELECT 1 AS found FROM __drizzle_migrations WHERE hash = ? AND created_at = ? LIMIT 1",
      )
      .get(hash, createdAt) !== undefined
  );
}

function deleteLegacyMigrationRows(
  db: DbConnection,
  hash: string,
  createdAt: number,
): void {
  db.$client
    .prepare<[string, number]>(
      "DELETE FROM __drizzle_migrations WHERE hash = ? AND created_at = ?",
    )
    .run(hash, createdAt);
}

function validateForkMigrationHistory(
  db: DbConnection,
  expectedMigrations: ExpectedAppliedMigration[],
): void {
  const appliedMigrations = readForkMigrationRows(db);
  const invalid =
    appliedMigrations.length > expectedMigrations.length ||
    appliedMigrations.some((migration, index) => {
      const expected = expectedMigrations[index];
      return (
        expected === undefined ||
        migration.createdAt !== expected.createdAt ||
        migration.hash !== expected.hash
      );
    });
  if (invalid) {
    throw new Error(
      "Fork migration history is invalid: expected a contiguous, hash-matching migration prefix",
    );
  }
}

export interface ForkMigrationState {
  migrations: ExpectedAppliedMigration[];
  hasLegacyPromotion: boolean;
  hasLegacyQuiesce: boolean;
}

const legacyWorkQuiesceWhen = 1_789_631_822_477;
const legacyWorktreePromotionWhen = 1_789_631_836_275;

function readPublicMigrationRows(
  db: DbConnection,
): AppliedMigrationIdentityRow[] {
  if (!tableExists(db, "__drizzle_migrations")) return [];
  return db.$client
    .prepare<[], AppliedMigrationIdentityRow>(
      "SELECT hash, created_at AS createdAt FROM __drizzle_migrations",
    )
    .all();
}

function validatePublicBaseHistory(
  db: DbConnection,
  migrations: ExpectedAppliedMigration[],
  hasLegacyQuiesce: boolean,
): void {
  const suffix = requireExpectedAppliedMigration(
    migrations,
    "0152_chubby_sauron",
  );
  const expectedBase = migrations.filter(
    (migration) => migration.createdAt < suffix.createdAt,
  );
  const requiredBase = requireExpectedAppliedMigration(
    migrations,
    "0116_majestic_swordsman",
  );
  const appliedMigrations = readPublicMigrationRows(db);
  const appliedCreatedAts = new Set(
    appliedMigrations
      .map((migration) => migration.createdAt)
      .filter((createdAt): createdAt is number => createdAt !== null),
  );
  const highestAppliedIndex = expectedBase.reduce(
    (highest, migration, index) =>
      appliedCreatedAts.has(migration.createdAt) ? index : highest,
    -1,
  );
  for (const [index, migration] of expectedBase.entries()) {
    if (
      index > highestAppliedIndex &&
      migration.createdAt > requiredBase.createdAt
    ) {
      break;
    }
    const allowedLegacyGap =
      hasLegacyQuiesce &&
      migration.tag >= "0117_machine_providers" &&
      migration.tag <= "0126_overconfident_vin_gonzales" &&
      !appliedCreatedAts.has(migration.createdAt);
    if (allowedLegacyGap) continue;
    const violation = findAppliedMigrationHistoryViolation(
      migration,
      appliedMigrations,
      appliedCreatedAts,
    );
    if (violation !== null) {
      throw new Error(
        `Fork public migration history is invalid: ${migration.tag}`,
      );
    }
  }
}

export function inspectForkMigrations(
  db: DbConnection,
  migrationsFolder: string,
  expectedForkMigrations: ExpectedAppliedMigration[],
): ForkMigrationState | null {
  const forkRows = readForkMigrationRows(db);
  const hasLegacyQuiesce =
    tableExists(db, "__drizzle_migrations") &&
    hasLegacyMigrationRow(
      db,
      legacyWorkQuiesceMigrationHash,
      legacyWorkQuiesceWhen,
    );
  const hasLegacyPromotion =
    tableExists(db, "__drizzle_migrations") &&
    hasLegacyMigrationRow(
      db,
      legacyWorktreePromotionMigrationHash,
      legacyWorktreePromotionWhen,
    );
  if (forkRows.length === 0 && !hasLegacyQuiesce && !hasLegacyPromotion) {
    return null;
  }
  if (!tableExists(db, "__drizzle_migrations")) {
    throw new Error("Fork migration history requires __drizzle_migrations");
  }
  validateForkMigrationHistory(db, expectedForkMigrations);
  validateForkPrefixSchema(
    db,
    migrationsFolder,
    expectedForkMigrations,
    forkRows.length,
  );
  const quiesce = expectedForkMigrations[0];
  const promotion = expectedForkMigrations[1];
  if (quiesce?.hash !== legacyWorkQuiesceMigrationHash) {
    throw new Error(
      "Fork work-quiesce migration identity changed unexpectedly",
    );
  }
  if (promotion?.hash !== legacyWorktreePromotionMigrationHash) {
    throw new Error(
      "Fork worktree-promotion migration identity changed unexpectedly",
    );
  }
  if (hasLegacyPromotion && !hasLegacyQuiesce && forkRows.length < 1) {
    throw new Error("Cannot adopt worktree promotion before work quiesce");
  }
  if (hasLegacyQuiesce) validateLegacyWorkQuiesceSchema(db, quiesce);
  if (hasLegacyPromotion) validateLegacyWorktreePromotionSchema(db, promotion);
  const migrations = readExpectedAppliedMigrations(migrationsFolder);
  validatePublicBaseHistory(db, migrations, hasLegacyQuiesce);
  validatePublicSuffixSchema(db, migrations, expectedForkMigrations);
  return {
    hasLegacyPromotion,
    hasLegacyQuiesce,
    migrations: expectedForkMigrations,
  };
}

export function prepareForkMigrations(
  db: DbConnection,
  migrationsFolder: string,
  state: ForkMigrationState | null,
): ForkMigrationState | null {
  if (state === null) return null;
  if (state.hasLegacyQuiesce || state.hasLegacyPromotion) {
    ensureForkMigrationLedger(db);
    db.$client.transaction(() => {
      repairLegacySkippedUpstreamMigrations(db, migrationsFolder);
      const forkRows = readForkMigrationRows(db);
      if (state.hasLegacyQuiesce && forkRows.length === 0) {
        db.$client
          .prepare<[string, number]>(
            `INSERT INTO ${forkMigrationsTable} (hash, created_at) VALUES (?, ?)`,
          )
          .run(state.migrations[0]!.hash, state.migrations[0]!.createdAt);
      }
      if (
        state.hasLegacyPromotion &&
        (forkRows.length === 1 ||
          (forkRows.length === 0 && state.hasLegacyQuiesce))
      ) {
        db.$client
          .prepare<[string, number]>(
            `INSERT INTO ${forkMigrationsTable} (hash, created_at) VALUES (?, ?)`,
          )
          .run(state.migrations[1]!.hash, state.migrations[1]!.createdAt);
      }
      if (state.hasLegacyQuiesce)
        deleteLegacyMigrationRows(
          db,
          legacyWorkQuiesceMigrationHash,
          legacyWorkQuiesceWhen,
        );
      if (state.hasLegacyPromotion)
        deleteLegacyMigrationRows(
          db,
          legacyWorktreePromotionMigrationHash,
          legacyWorktreePromotionWhen,
        );
    })();
  }
  validateForkMigrationHistory(db, state.migrations);
  return state;
}

function hasAppliedMigration(
  db: DbConnection,
  migration: ExpectedAppliedMigration,
): boolean {
  const rows = db.$client
    .prepare<[number], AppliedMigrationIdentityRow>(
      "SELECT hash, created_at AS createdAt FROM __drizzle_migrations WHERE created_at = ?",
    )
    .all(migration.createdAt);
  if (rows.length === 0) return false;
  if (rows.length !== 1 || rows[0]!.hash !== migration.hash) {
    throw new Error(
      `Public migration identity is invalid for ${migration.tag}`,
    );
  }
  return true;
}

function hasAppliedBaseMigration(
  db: DbConnection,
  migration: ExpectedAppliedMigration,
): boolean {
  const appliedMigrations = readPublicMigrationRows(db);
  const appliedCreatedAts = new Set(
    appliedMigrations
      .map((appliedMigration) => appliedMigration.createdAt)
      .filter((createdAt): createdAt is number => createdAt !== null),
  );
  if (!appliedCreatedAts.has(migration.createdAt)) return false;
  if (
    findAppliedMigrationHistoryViolation(
      migration,
      appliedMigrations,
      appliedCreatedAts,
    ) !== null
  ) {
    throw new Error(`Fork public migration history is invalid: ${migration.tag}`);
  }
  return true;
}

function applyStatements(
  db: DbConnection,
  migration: ExpectedAppliedMigration,
  indexes: readonly number[],
): void {
  if (hasAppliedMigration(db, migration)) return;
  db.$client.transaction(() => {
    for (const index of indexes) {
      const statement = migration.sql[index];
      if (statement === undefined) {
        throw new Error(`Missing expected statement for ${migration.tag}`);
      }
      db.$client.exec(statement);
    }
    markMigrationApplied(db, migration);
  })();
}

const convertedTables = [
  {
    source: "fork_thread_execution_reports",
    target: "thread_execution_reports",
    columns: [
      "thread_id",
      "model",
      "reasoning_level",
      "permission_mode",
      "service_tier",
      "reported_at",
    ],
    keys: ["thread_id"],
  },
  {
    source: "fork_spend_prices",
    target: "spend_prices",
    columns: [
      "provider_id",
      "model",
      "input_usd_per_mtok",
      "cached_input_usd_per_mtok",
      "output_usd_per_mtok",
    ],
    keys: ["provider_id", "model"],
  },
  {
    source: "fork_thread_spend_cursor",
    target: "thread_spend_cursor",
    columns: [
      "thread_id",
      "provider_thread_id",
      "last_sequence",
      "last_total_tokens",
      "first_sequence",
      "history_complete",
      "last_turn_id",
      "last_model",
    ],
    keys: ["thread_id", "provider_thread_id"],
  },
  {
    source: "fork_thread_spend_daily",
    target: "thread_spend_daily",
    columns: [
      "day",
      "thread_id",
      "provider_id",
      "model",
      "input_tokens",
      "cached_input_tokens",
      "output_tokens",
      "reasoning_output_tokens",
      "total_tokens",
      "weighted_units",
      "turns",
      "first_event_at",
      "last_event_at",
    ],
    keys: ["day", "thread_id", "provider_id", "model"],
  },
] as const;

function convertForkTables(db: DbConnection): void {
  for (const table of convertedTables) {
    if (!tableExists(db, table.source)) continue;
    const columns = table.columns.join(", ");
    const where = table.keys.map((key) => `${key} = ?`).join(" AND ");
    const rows = db.$client
      .prepare<[], Record<string, unknown>>(
        `SELECT ${columns} FROM ${table.source}`,
      )
      .all();
    for (const row of rows) {
      const values = table.columns.map((column) => row[column]);
      const existing = db.$client
        .prepare<unknown[], Record<string, unknown>>(
          `SELECT ${columns} FROM ${table.target} WHERE ${where}`,
        )
        .get(...table.keys.map((key) => row[key]));
      if (existing === undefined) {
        db.$client
          .prepare<unknown[]>(
            `INSERT INTO ${table.target} (${columns}) VALUES (${table.columns.map(() => "?").join(", ")})`,
          )
          .run(...values);
        continue;
      }
      if (
        !table.columns.every((column) =>
          Object.is(row[column], existing[column]),
        )
      ) {
        throw new Error(
          `Conflicting source rows in ${table.source} for key ${table.keys.join(",")}`,
        );
      }
    }
    db.$client.exec(`DROP TABLE ${table.source}`);
  }
}

export function runForkCompatibleMigrations(
  db: DbConnection,
  migrationsFolder: string,
  state: ForkMigrationState | null,
  runCanonicalMigrations: () => void,
): void {
  if (state === null) {
    runCanonicalMigrations();
    return;
  }
  const migrations = readExpectedAppliedMigrations(migrationsFolder);
  const suffix = [
    requireExpectedAppliedMigration(migrations, "0152_chubby_sauron"),
    requireExpectedAppliedMigration(migrations, "0153_broken_lockheed"),
    requireExpectedAppliedMigration(
      migrations,
      "0154_thread_checkout_promotion",
    ),
    requireExpectedAppliedMigration(migrations, "0155_sudden_goliath"),
  ];
  const forkLength = readForkMigrationRows(db).length;
  for (const migration of migrations) {
    if (migration.createdAt >= suffix[0].createdAt) break;
    if (!hasAppliedBaseMigration(db, migration))
      applyMigrationStatements(db, migration);
  }
  db.$client.transaction(() => {
    applyStatements(
      db,
      suffix[0],
      suffix[0].sql.map((_, index) => index),
    );
    applyStatements(
      db,
      suffix[1],
      suffix[1].sql.map((_, index) => index),
    );
    const indexes =
      forkLength >= 4
        ? []
        : forkLength === 3
          ? [4]
          : forkLength === 2
            ? [0, 1, 2, 3, 4, 6]
            : [0, 1, 2, 3, 4, 5, 6];
    applyStatements(db, suffix[2], indexes);
    convertForkTables(db);
    if (forkLength >= 1) {
      if (!hasAppliedMigration(db, suffix[3]))
        markMigrationApplied(db, suffix[3]);
    } else {
      applyStatements(
        db,
        suffix[3],
        suffix[3].sql.map((_, index) => index),
      );
    }
  })();
  runCanonicalMigrations();
}
