import type { DbConnection } from "../../src/index.js";

const FIRST_FORK_MIGRATION_WHEN = 1793906993789;

export function rewindForkMigrationSuffix(db: DbConnection): void {
  db.$client.pragma("foreign_keys = OFF");
  try {
    db.$client.exec(`
      DROP TABLE IF EXISTS work_quiesce_resolutions;
      DROP TABLE IF EXISTS work_quiesce;
      DROP TABLE IF EXISTS work_admissions;
      DROP TABLE IF EXISTS branch_promotions;
      DROP TABLE IF EXISTS thread_spend_daily;
      DROP TABLE IF EXISTS thread_spend_cursor;
      DROP TABLE IF EXISTS spend_prices;
      DROP TABLE IF EXISTS thread_execution_reports;
    `);
    for (const [table, column] of [
      ["environments", "adopted_from_status"],
      ["threads", "worktree_promotion"],
      ["threads", "promotion_target"],
    ]) {
      const columns = db.$client
        .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
        .all();
      if (columns.some((entry) => entry.name === column)) {
        db.$client.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      }
    }
    db.$client
      .prepare("DELETE FROM __drizzle_migrations WHERE created_at >= ?")
      .run(FIRST_FORK_MIGRATION_WHEN);
  } finally {
    db.$client.pragma("foreign_keys = ON");
  }
}
