import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConnection } from "../src/connection.js";
import { migrate } from "../src/migrate.js";

const visibility = vi.hoisted(() => ({
  hideForkFolder: false,
  forkModulePath: null as string | null,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: actual,
    existsSync: (path: Parameters<typeof actual.existsSync>[0]) =>
      visibility.hideForkFolder && String(path).includes("drizzle-fork")
        ? false
        : actual.existsSync(path),
  };
});

vi.mock("node:url", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:url")>();
  return {
    ...actual,
    default: actual,
    fileURLToPath: (url: Parameters<typeof actual.fileURLToPath>[0]) =>
      visibility.forkModulePath !== null &&
      String(url).endsWith("/migrate.fork.ts")
        ? visibility.forkModulePath
        : actual.fileURLToPath(url),
  };
});

const fixturesDir = dirname(fileURLToPath(import.meta.url));
const sourceForkMigrations = resolve(fixturesDir, "../drizzle-fork");
const temporaryRoots: string[] = [];

function temporaryForkMigrationsFolder(): string {
  const root = mkdtempSync(join(tmpdir(), "bb-fork-migrations-"));
  temporaryRoots.push(root);
  const moduleDir = join(root, "src");
  cpSync(sourceForkMigrations, join(root, "drizzle-fork"), {
    recursive: true,
  });
  visibility.forkModulePath = join(moduleDir, "migrate.fork.ts");
  return join(root, "drizzle-fork");
}

function objectNames(
  db: ReturnType<typeof createConnection>,
  master: "sqlite_master" | "sqlite_temp_master",
): string[] {
  return db.$client
    .prepare<[], { name: string }>(`SELECT name FROM ${master} ORDER BY name`)
    .all()
    .map((row) => row.name);
}

describe("migrate fork migrations folder", () => {
  afterEach(() => {
    visibility.hideForkFolder = false;
    visibility.forkModulePath = null;
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("fails on a missing fork migrations folder before touching the database", () => {
    visibility.hideForkFolder = true;
    const db = createConnection(":memory:");
    const foreignKeysBefore = db.$client.pragma("foreign_keys", {
      simple: true,
    });

    expect(() => migrate(db)).toThrow(
      /^Missing database migrations\. Expected .*_journal\.json under one of: .*drizzle-fork/u,
    );

    expect(objectNames(db, "sqlite_temp_master")).toEqual([]);
    expect(objectNames(db, "sqlite_master")).toEqual([]);
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(
      foreignKeysBefore,
    );
  });

  it("uses the public migration path when the fork folder is present", () => {
    const db = createConnection(":memory:");

    migrate(db);

    expect(objectNames(db, "sqlite_master")).not.toContain(
      "__bb_fork_migrations",
    );
  });

  it.each([
    ["missing journal", (folder: string) => rmSync(join(folder, "meta", "_journal.json"))],
    ["missing SQL", (folder: string) => rmSync(join(folder, "0000_work_quiesce.sql"))],
    [
      "malformed journal",
      (folder: string) =>
        writeFileSync(join(folder, "meta", "_journal.json"), "{", "utf8"),
    ],
  ])("rejects %s before touching the database", (_name, mutate) => {
    mutate(temporaryForkMigrationsFolder());
    const db = createConnection(":memory:");
    const foreignKeysBefore = db.$client.pragma("foreign_keys", {
      simple: true,
    });

    expect(() => migrate(db)).toThrow();

    expect(objectNames(db, "sqlite_temp_master")).toEqual([]);
    expect(objectNames(db, "sqlite_master")).toEqual([]);
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(
      foreignKeysBefore,
    );
  });
});
