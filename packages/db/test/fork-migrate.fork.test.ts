import { describe, expect, it } from "vitest";
import { createConnection } from "../src/connection.js";
import { migrate } from "../src/migrate.js";
import { createForkHistory } from "./fixtures/fork-history.fork.js";

const quiesceHash =
  "f162a056f845a9e712b63f50351f0651858c5659c6c2fc05cd063f49c15ca87f";
const borrowedFeaturesHash =
  "3a412357541b0f5c0b06802bb966d8d39dd40cd650a7457e191ebef3853b263b";
const legacyQuiesceWhen = 1_789_631_822_477;

function rows(db: ReturnType<typeof createConnection>, table: string) {
  return db.$client
    .prepare<[], { createdAt: number; hash: string }>(
      `SELECT created_at AS createdAt, hash FROM ${table} ORDER BY created_at`,
    )
    .all();
}

describe("fork migration convergence", () => {
  it("keeps a fresh canonical database on the public migration path", () => {
    const db = createConnection(":memory:");
    try {
      migrate(db);
      expect(
        rows(db, "__drizzle_migrations").some(
          (row) => row.hash === quiesceHash,
        ),
      ).toBe(true);
      expect(
        db.$client
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__bb_fork_migrations'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      db.$client.close();
    }
  });

  it("converts a complete private history without rewriting its public suffix", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 5);
      db.$client.exec(`
        INSERT INTO projects (id, name, created_at, updated_at)
          VALUES ('project-1', 'Project 1', 1, 1);
        INSERT INTO threads (id, project_id, provider_id, latest_attention_at, created_at, updated_at)
          VALUES ('thread-1', 'project-1', 'codex', 1, 1, 1);
        INSERT INTO fork_spend_prices VALUES ('codex', 'gpt-5', 1, 2, 3);
        INSERT INTO fork_thread_execution_reports VALUES ('thread-1', 'gpt-5', 'high', 'default', 'priority', 4);
        INSERT INTO fork_thread_spend_cursor VALUES ('thread-1', 'provider-thread-1', 5, 6, 7, 1, 'turn-1', 'gpt-5');
        INSERT INTO fork_thread_spend_daily VALUES ('2026-11-06', 'thread-1', 'codex', 'gpt-5', 8, 9, 10, 11, 12, 13.5, 14, 15, 16);
      `);
      const privateHistory = rows(db, "__bb_fork_migrations");

      migrate(db);
      const publicHistory = rows(db, "__drizzle_migrations");

      expect(
        db.$client
          .prepare(
            "SELECT input_usd_per_mtok, cached_input_usd_per_mtok, output_usd_per_mtok FROM spend_prices WHERE provider_id = 'codex' AND model = 'gpt-5'",
          )
          .get(),
      ).toEqual({
        input_usd_per_mtok: 1,
        cached_input_usd_per_mtok: 2,
        output_usd_per_mtok: 3,
      });
      expect(
        db.$client
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fork_spend_prices'",
          )
          .get(),
      ).toBeUndefined();
      expect(
        rows(db, "__drizzle_migrations").filter(
          (row) => row.hash === quiesceHash,
        ),
      ).toHaveLength(1);
      migrate(db);
      expect(rows(db, "__bb_fork_migrations")).toEqual(privateHistory);
      expect(rows(db, "__drizzle_migrations")).toEqual(publicHistory);
      expect(
        db.$client
          .prepare(
            "SELECT model, reasoning_level, permission_mode, service_tier, reported_at FROM thread_execution_reports WHERE thread_id = 'thread-1'",
          )
          .get(),
      ).toEqual({
        model: "gpt-5",
        reasoning_level: "high",
        permission_mode: "default",
        service_tier: "priority",
        reported_at: 4,
      });
      expect(
        db.$client
          .prepare(
            "SELECT last_sequence, last_total_tokens, first_sequence, history_complete, last_turn_id, last_model FROM thread_spend_cursor WHERE thread_id = 'thread-1' AND provider_thread_id = 'provider-thread-1'",
          )
          .get(),
      ).toEqual({
        last_sequence: 5,
        last_total_tokens: 6,
        first_sequence: 7,
        history_complete: 1,
        last_turn_id: "turn-1",
        last_model: "gpt-5",
      });
      expect(
        db.$client
          .prepare(
            "SELECT input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens, weighted_units, turns, first_event_at, last_event_at FROM thread_spend_daily WHERE day = '2026-11-06' AND thread_id = 'thread-1' AND provider_id = 'codex' AND model = 'gpt-5'",
          )
          .get(),
      ).toEqual({
        input_tokens: 8,
        cached_input_tokens: 9,
        output_tokens: 10,
        reasoning_output_tokens: 11,
        total_tokens: 12,
        weighted_units: 13.5,
        turns: 14,
        first_event_at: 15,
        last_event_at: 16,
      });
    } finally {
      db.$client.close();
    }
  });

  it("rejects a claimed complete prefix without private or public spend schema", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 5);
      db.$client.exec(`
        DROP TABLE fork_spend_prices;
        DROP TABLE fork_thread_execution_reports;
        DROP TABLE fork_thread_spend_cursor;
        DROP TABLE fork_thread_spend_daily;
      `);
      expect(() => migrate(db)).toThrow(
        "Public migration identity is invalid for 0152_chubby_sauron",
      );
    } finally {
      db.$client.close();
    }
  });

  it("rejects a converted spend prefix with a wrong public identity", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 5);
      migrate(db);
      db.$client
        .prepare(
          "UPDATE __drizzle_migrations SET hash = ? WHERE created_at = ?",
        )
        .run(borrowedFeaturesHash, 1793912000559);
      expect(() => migrate(db)).toThrow(
        "Public migration identity is invalid for 0153_broken_lockheed",
      );
    } finally {
      db.$client.close();
    }
  });

  it("rejects a converted spend prefix with malformed canonical schema", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 5);
      migrate(db);
      db.$client.exec("DROP INDEX thread_spend_daily_day_idx");
      expect(() => migrate(db)).toThrow(
        "Fork migration schema does not match 0153_broken_lockheed: thread_spend_daily_day_idx",
      );
    } finally {
      db.$client.close();
    }
  });

  it.each([1, 2, 3, 4, 5])(
    "converges private prefix %i in public suffix order",
    (prefixLength) => {
      const db = createConnection(":memory:");
      try {
        createForkHistory(db, prefixLength);
        migrate(db);
        expect(
          rows(db, "__drizzle_migrations")
            .filter((row) => row.createdAt >= 1793906993789)
            .map((row) => row.createdAt),
        ).toEqual([1793906993789, 1793912000559, 1793926996170, 1793933265938]);
      } finally {
        db.$client.close();
      }
    },
  );

  it("rejects a noncontiguous private history before conversion", () => {
    const db = createConnection(":memory:");
    try {
      createForkHistory(db, 1);
      db.$client
        .prepare("UPDATE __bb_fork_migrations SET hash = ?")
        .run(borrowedFeaturesHash);
      expect(() => migrate(db)).toThrow("Fork migration history is invalid");
      expect(
        db.$client
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fork_spend_prices'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      db.$client.close();
    }
  });

  it("moves only the exact legacy quiesce identity and retains public 0155", () => {
    const db = createConnection(":memory:");
    try {
      migrate(db);
      db.$client
        .prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        )
        .run(quiesceHash, legacyQuiesceWhen);
      migrate(db);
      expect(
        rows(db, "__drizzle_migrations").some(
          (row) => row.createdAt === legacyQuiesceWhen,
        ),
      ).toBe(false);
      expect(
        rows(db, "__drizzle_migrations").filter(
          (row) => row.hash === quiesceHash,
        ),
      ).toHaveLength(1);
      expect(rows(db, "__bb_fork_migrations")).toEqual([
        { createdAt: 1790079694518, hash: quiesceHash },
      ]);
    } finally {
      db.$client.close();
    }
  });
});
