import { readMigrationFiles } from "drizzle-orm/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DbConnection } from "../../src/connection.js";

const fixturesDir = dirname(fileURLToPath(import.meta.url));
const publicMigrationsFolder = resolve(fixturesDir, "../../drizzle");
const forkMigrationsFolder = resolve(fixturesDir, "../../drizzle-fork");
const fullPublicPrefixLength = 152;

export function publicMigrationIdentity(index: number): {
  createdAt: number;
  hash: string;
} {
  const migration = readMigrationFiles({
    migrationsFolder: publicMigrationsFolder,
  })[index];
  if (migration === undefined) {
    throw new Error("Invalid public migration index");
  }
  return { createdAt: migration.folderMillis, hash: migration.hash };
}

export function applyPublicHistory(
  db: DbConnection,
  startIndex: number,
  endIndex: number,
  omittedLedgerCreatedAt?: number,
  omittedSqlCreatedAt?: number,
): void {
  const publicMigrations = readMigrationFiles({
    migrationsFolder: publicMigrationsFolder,
  });
  if (
    startIndex < 0 ||
    endIndex < startIndex ||
    endIndex > publicMigrations.length
  ) {
    throw new Error("Invalid public migration history range");
  }
  for (const migration of publicMigrations.slice(startIndex, endIndex)) {
    if (migration.folderMillis !== omittedSqlCreatedAt) {
      for (const statement of migration.sql) db.$client.exec(statement);
    }
    if (migration.folderMillis !== omittedLedgerCreatedAt) {
      db.$client
        .prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        )
        .run(migration.hash, migration.folderMillis);
    }
  }
}

export function createForkHistory(
  db: DbConnection,
  forkPrefixLength: number,
  publicPrefixLength = fullPublicPrefixLength,
): void {
  if (
    forkPrefixLength < 0 ||
    forkPrefixLength > 5 ||
    publicPrefixLength < 0 ||
    publicPrefixLength > fullPublicPrefixLength
  ) {
    throw new Error("Invalid fork migration prefix length");
  }
  const publicMigrations = readMigrationFiles({
    migrationsFolder: publicMigrationsFolder,
  });
  const forkMigrations = readMigrationFiles({
    migrationsFolder: forkMigrationsFolder,
  });
  if (
    publicMigrations.length < fullPublicPrefixLength ||
    forkMigrations.length !== 5
  ) {
    throw new Error("Historical migration fixture files are incomplete");
  }
  db.$client.exec(`
    CREATE TABLE __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
    CREATE TEMP TABLE bb_migration_existing_installation (existing INTEGER NOT NULL);
    INSERT INTO bb_migration_existing_installation (existing) VALUES (1);
    CREATE TEMP TABLE bb_migration_local_host (id TEXT PRIMARY KEY);
    CREATE TEMP TABLE bb_migration_queued_message_groups (
      id TEXT PRIMARY KEY,
      group_with_next INTEGER NOT NULL
    );
  `);
  applyPublicHistory(db, 0, publicPrefixLength);
  if (forkPrefixLength === 0) return;
  db.$client.exec(`
    CREATE TABLE __bb_fork_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
  `);
  for (const migration of forkMigrations.slice(0, forkPrefixLength)) {
    for (const statement of migration.sql) db.$client.exec(statement);
    db.$client
      .prepare(
        "INSERT INTO __bb_fork_migrations (hash, created_at) VALUES (?, ?)",
      )
      .run(migration.hash, migration.folderMillis);
  }
}
