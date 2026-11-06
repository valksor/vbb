import { describe, expect, it } from "vitest";
import type { DbConnection } from "../src/connection.js";
import { createProject } from "../src/data/projects.js";
import { getOldestPendingInteractionKindInputs } from "../src/data/pending-interactions.fork.js";
import {
  createThread,
  listThreadsWithPendingInteractionState,
} from "../src/data/threads.js";
import { upsertHost } from "../src/data/hosts.js";
import { noopNotifier } from "../src/notifier.js";
import { createMigratedConnection } from "../src/testing.js";

type SqliteParameter = string | number | bigint | Buffer | null;

interface CapturedStatement {
  params: SqliteParameter[];
  sql: string;
}

interface QueryPlanRow {
  detail: string;
  id: number;
  notused: number;
  parent: number;
}

function setup(): { db: DbConnection; thread: { id: string } } {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "query-plan-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "query-plan-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/query-plan" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { db, thread };
}

function captureStatements(
  db: DbConnection,
  run: () => void,
): CapturedStatement[] {
  const captured: CapturedStatement[] = [];
  const raw = db.$client;
  const originalPrepare = raw.prepare.bind(raw);
  Object.defineProperty(raw, "prepare", {
    configurable: true,
    writable: true,
    value: (source: string) => {
      const statement = originalPrepare(source);
      const originalAll = statement.all.bind(statement);
      const originalGet = statement.get.bind(statement);
      statement.all = (...params: unknown[]) => {
        captured.push({ params: params as SqliteParameter[], sql: source });
        return originalAll(...params);
      };
      statement.get = (...params: unknown[]) => {
        captured.push({ params: params as SqliteParameter[], sql: source });
        return originalGet(...params);
      };
      return statement;
    },
  });
  try {
    run();
  } finally {
    Object.defineProperty(raw, "prepare", {
      configurable: true,
      writable: true,
      value: originalPrepare,
    });
  }
  return captured;
}

function queryPlanDetails(args: {
  db: DbConnection;
  params: readonly SqliteParameter[];
  sql: string;
}): string {
  const planRows = args.db.$client
    .prepare<SqliteParameter[], QueryPlanRow>(`EXPLAIN QUERY PLAN ${args.sql}`)
    .all(...args.params);
  return planRows.map((row) => row.detail).join("\n");
}

describe("fork query-plan assertions", () => {
  it("serves the thread-list pending probe from its covering index without a GROUP BY sort", () => {
    const { db } = setup();

    const captured = captureStatements(db, () => {
      listThreadsWithPendingInteractionState(db, { includeHidden: false });
    });
    const statement = captured.find(
      (entry) =>
        entry.sql.includes('from "threads"') &&
        entry.sql.includes("pending_interactions"),
    );
    if (!statement) {
      throw new Error("Expected the thread-list SQL");
    }

    const details = queryPlanDetails({
      db,
      params: statement.params,
      sql: statement.sql,
    });
    expect(details).toContain(
      "USING COVERING INDEX pending_interactions_thread_status_created_idx",
    );
    expect(details).not.toContain("USE TEMP B-TREE FOR GROUP BY");
    expect(
      details.match(
        /SEARCH pending_interactions USING INDEX pending_interactions_thread_status_created_idx \(thread_id=\? AND status=\?\)/gu,
      ),
    ).toHaveLength(2);
    expect(
      details.match(/USE TEMP B-TREE FOR LAST TERM OF ORDER BY/gu),
    ).toHaveLength(2);
    expect(details.match(/USE TEMP B-TREE FOR ORDER BY/gu)).toHaveLength(1);

    db.$client.close();
  });

  it("serves the oldest pending interaction kind lookup from its non-covering index with only a last-term order-by sort", () => {
    const { db, thread } = setup();

    const captured = captureStatements(db, () => {
      getOldestPendingInteractionKindInputs(db, thread.id);
    });
    const statement = captured.find((entry) =>
      entry.sql.includes("pending_interactions"),
    );
    if (!statement) {
      throw new Error("Expected the oldest-pending-kind SQL");
    }

    const details = queryPlanDetails({
      db,
      params: statement.params,
      sql: statement.sql,
    });
    expect(
      details.match(
        /SEARCH pending_interactions USING INDEX pending_interactions_thread_status_created_idx \(thread_id=\? AND status=\?\)/gu,
      ),
    ).toHaveLength(1);
    expect(
      details.match(/USE TEMP B-TREE FOR LAST TERM OF ORDER BY/gu),
    ).toHaveLength(1);
    expect(details.match(/USE TEMP B-TREE FOR ORDER BY/gu)).toBeNull();

    db.$client.close();
  });
});
