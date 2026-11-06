import { describe, expect, it } from "vitest";
import { createConnection } from "../src/connection.js";
import { migrate } from "../src/migrate.js";
import {
  applyPublicHistory,
  createForkHistory,
} from "./fixtures/fork-history.fork.js";

const quiesceHash =
  "f162a056f845a9e712b63f50351f0651858c5659c6c2fc05cd063f49c15ca87f";
const promotionHash =
  "dbdda013c3b84e828babc97fcebe1761bea42507c6cf8dabcb6dc8b4b392f07d";
const quiesceCreatedAt = 1_790_079_694_518;
const promotionCreatedAt = 1_790_084_440_020;
const legacyQuiesceCreatedAt = 1_789_631_822_477;
const legacyPromotionCreatedAt = 1_789_631_836_275;
const storageDeletedAtCreatedAt = 1_789_421_366_079;
const publicSuffixCreatedAts = [
  1_793_906_993_789, 1_793_912_000_559, 1_793_926_996_170, 1_793_933_265_938,
];

interface MigrationRow {
  createdAt: number;
  hash: string;
}

function rows(
  db: ReturnType<typeof createConnection>,
  table: "__bb_fork_migrations" | "__drizzle_migrations",
): MigrationRow[] {
  return db.$client
    .prepare<[], MigrationRow>(
      `SELECT created_at AS createdAt, hash FROM ${table} ORDER BY created_at`,
    )
    .all();
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

function insertThread(
  db: ReturnType<typeof createConnection>,
  worktreePromotion?: "armed" | "declined",
): void {
  const columns =
    worktreePromotion === undefined
      ? "id, project_id, provider_id, latest_attention_at, created_at, updated_at"
      : "id, project_id, provider_id, latest_attention_at, created_at, updated_at, worktree_promotion";
  const values =
    worktreePromotion === undefined
      ? "'thread-1', 'project-1', 'codex', 1, 1, 1"
      : `'thread-1', 'project-1', 'codex', 1, 1, 1, '${worktreePromotion}'`;
  db.$client.exec(`
    INSERT INTO projects (id, name, created_at, updated_at)
      VALUES ('project-1', 'Project 1', 1, 1);
    INSERT INTO threads (${columns}) VALUES (${values});
  `);
}

function removeForkLedger(db: ReturnType<typeof createConnection>): void {
  db.$client.exec("DELETE FROM __bb_fork_migrations");
}

describe("source fork migration regressions", () => {
  it("converges a real two-entry private prefix without fabricating private completion", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 2);
      insertThread(db, "armed");

      migrate(db);

      expect(
        db.$client
          .prepare(
            "SELECT worktree_promotion, promotion_target FROM threads WHERE id = 'thread-1'",
          )
          .get(),
      ).toEqual({ promotion_target: "worktree", worktree_promotion: "armed" });
      expect(hasSchemaObject(db, "table", "branch_promotions")).toBe(true);
      expect(
        hasSchemaObject(db, "index", "branch_promotions_active_thread_idx"),
      ).toBe(true);
      expect(
        hasSchemaObject(
          db,
          "index",
          "branch_promotions_active_environment_idx",
        ),
      ).toBe(true);
      expect(
        hasSchemaObject(db, "index", "branch_promotions_thread_created_idx"),
      ).toBe(true);
      expect(rows(db, "__bb_fork_migrations")).toEqual([
        { createdAt: quiesceCreatedAt, hash: quiesceHash },
        { createdAt: promotionCreatedAt, hash: promotionHash },
      ]);
      expect(
        rows(db, "__drizzle_migrations")
          .filter((row) => row.createdAt >= publicSuffixCreatedAts[0]!)
          .map((row) => row.createdAt),
      ).toEqual(publicSuffixCreatedAts);
      const publicHistory = rows(db, "__drizzle_migrations");
      migrate(db);
      expect(rows(db, "__bb_fork_migrations")).toEqual([
        { createdAt: quiesceCreatedAt, hash: quiesceHash },
        { createdAt: promotionCreatedAt, hash: promotionHash },
      ]);
      expect(rows(db, "__drizzle_migrations")).toEqual(publicHistory);
    } finally {
      db.$client.close();
    }
  });

  it("rejects a genuinely missing middle private migration before conversion", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 3);
      db.$client
        .prepare("DELETE FROM __bb_fork_migrations WHERE created_at = ?")
        .run(promotionCreatedAt);

      expect(() => migrate(db)).toThrow("Fork migration history is invalid");
      expect(rows(db, "__bb_fork_migrations")).toEqual([
        { createdAt: quiesceCreatedAt, hash: quiesceHash },
        expect.objectContaining({ createdAt: 1_790_097_807_550 }),
      ]);
      expect(hasSchemaObject(db, "table", "branch_promotions")).toBe(true);
    } finally {
      db.$client.close();
    }
  });

  it("adopts legacy quiesce after repairing reflected storage deletion", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 1, 117);
      applyPublicHistory(db, 117, 127, storageDeletedAtCreatedAt);
      removeForkLedger(db);
      insertThread(db);
      db.$client.exec(`
        UPDATE threads SET storage_deleted_at = 4242 WHERE id = 'thread-1';
        INSERT INTO __drizzle_migrations (hash, created_at)
          VALUES ('${quiesceHash}', ${legacyQuiesceCreatedAt});
      `);

      migrate(db);

      expect(
        db.$client
          .prepare(
            "SELECT storage_deleted_at, worktree_promotion, promotion_target FROM threads WHERE id = 'thread-1'",
          )
          .get(),
      ).toEqual({
        storage_deleted_at: 4242,
        worktree_promotion: "declined",
        promotion_target: "worktree",
      });
      expect(
        db.$client
          .prepare(
            "SELECT name, dflt_value AS defaultValue FROM pragma_table_info('threads') WHERE name IN ('worktree_promotion', 'promotion_target') ORDER BY name",
          )
          .all(),
      ).toEqual([
        { defaultValue: "'worktree'", name: "promotion_target" },
        { defaultValue: "'declined'", name: "worktree_promotion" },
      ]);
      db.$client
        .prepare(
          "UPDATE threads SET worktree_promotion = 'armed' WHERE id = 'thread-1'",
        )
        .run();
      expect(
        db.$client
          .prepare(
            "SELECT worktree_promotion FROM threads WHERE id = 'thread-1'",
          )
          .get(),
      ).toEqual({ worktree_promotion: "armed" });
      expect(rows(db, "__drizzle_migrations")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ createdAt: storageDeletedAtCreatedAt }),
        ]),
      );
      expect(
        rows(db, "__drizzle_migrations").some(
          (row) => row.createdAt === legacyQuiesceCreatedAt,
        ),
      ).toBe(false);
      expect(
        rows(db, "__drizzle_migrations").filter(
          (row) => row.hash === quiesceHash,
        ),
      ).toEqual([
        expect.objectContaining({ createdAt: publicSuffixCreatedAts[3] }),
      ]);
      expect(rows(db, "__bb_fork_migrations")).toEqual([
        { createdAt: quiesceCreatedAt, hash: quiesceHash },
      ]);
    } finally {
      db.$client.close();
    }
  });

  it("adopts legacy quiesce and promotion while preserving armed intent", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 2, 117);
      removeForkLedger(db);
      insertThread(db, "armed");
      db.$client.exec(`
        INSERT INTO __drizzle_migrations (hash, created_at)
        VALUES
          ('${quiesceHash}', ${legacyQuiesceCreatedAt}),
          ('${promotionHash}', ${legacyPromotionCreatedAt});
      `);

      migrate(db);

      expect(
        db.$client
          .prepare(
            "SELECT worktree_promotion FROM threads WHERE id = 'thread-1'",
          )
          .get(),
      ).toEqual({ worktree_promotion: "armed" });
      expect(rows(db, "__bb_fork_migrations")).toEqual([
        { createdAt: quiesceCreatedAt, hash: quiesceHash },
        { createdAt: promotionCreatedAt, hash: promotionHash },
      ]);
      expect(
        rows(db, "__drizzle_migrations").filter(
          (row) =>
            row.createdAt === legacyQuiesceCreatedAt ||
            row.createdAt === legacyPromotionCreatedAt,
        ),
      ).toEqual([]);
      expect(
        rows(db, "__drizzle_migrations")
          .filter((row) => row.createdAt >= publicSuffixCreatedAts[0]!)
          .map((row) => row.createdAt),
      ).toEqual(publicSuffixCreatedAts);
    } finally {
      db.$client.close();
    }
  });

  it("rejects promotion-only legacy provenance without deleting it", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 2, 117);
      removeForkLedger(db);
      db.$client
        .prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        )
        .run(promotionHash, legacyPromotionCreatedAt);

      expect(() => migrate(db)).toThrow(
        "Cannot adopt worktree promotion before work quiesce",
      );
      expect(rows(db, "__drizzle_migrations")).toEqual(
        expect.arrayContaining([
          { createdAt: legacyPromotionCreatedAt, hash: promotionHash },
        ]),
      );
    } finally {
      db.$client.close();
    }
  });

  it("rejects altered legacy quiesce objects before adoption", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 1, 117);
      removeForkLedger(db);
      db.$client.exec(`
        DROP INDEX work_admissions_state_idx;
        INSERT INTO __drizzle_migrations (hash, created_at)
          VALUES ('${quiesceHash}', ${legacyQuiesceCreatedAt});
      `);

      expect(() => migrate(db)).toThrow(
        "Legacy fork migration schema does not match 0000_work_quiesce",
      );
      expect(rows(db, "__drizzle_migrations")).toEqual(
        expect.arrayContaining([
          { createdAt: legacyQuiesceCreatedAt, hash: quiesceHash },
        ]),
      );
      expect(rows(db, "__bb_fork_migrations")).toEqual([]);
    } finally {
      db.$client.close();
    }
  });

  it("rejects nullable legacy promotion without partial adoption", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 2, 117);
      removeForkLedger(db);
      db.$client.exec(`
        ALTER TABLE threads DROP COLUMN worktree_promotion;
        ALTER TABLE threads ADD worktree_promotion text DEFAULT 'declined';
        INSERT INTO __drizzle_migrations (hash, created_at)
        VALUES
          ('${quiesceHash}', ${legacyQuiesceCreatedAt}),
          ('${promotionHash}', ${legacyPromotionCreatedAt});
      `);

      expect(() => migrate(db)).toThrow(
        "Legacy fork migration schema does not match 0001_thread_worktree_promotion: worktree_promotion",
      );
      expect(rows(db, "__drizzle_migrations")).toEqual(
        expect.arrayContaining([
          { createdAt: legacyQuiesceCreatedAt, hash: quiesceHash },
          { createdAt: legacyPromotionCreatedAt, hash: promotionHash },
        ]),
      );
      expect(rows(db, "__bb_fork_migrations")).toEqual([]);
      expect(
        rows(db, "__drizzle_migrations").some(
          (row) => row.createdAt === storageDeletedAtCreatedAt,
        ),
      ).toBe(false);
    } finally {
      db.$client.close();
    }
  });
});
