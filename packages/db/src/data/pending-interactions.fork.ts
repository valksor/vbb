import { and, eq, sql } from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";
import {
  classifyPendingInteractionKind,
  type PendingInteractionKindInputs,
  type ThreadPendingInteractionKind,
} from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import { pendingInteractions } from "../schema.js";
import type { PendingInteractionRow } from "./pending-interactions.js";

type PendingInteractionWriteConnection = DbConnection | DbTransaction;
type PendingInteractionReadConnection = DbConnection | DbTransaction;

const oldestPendingInteractionPayloadKindSql = sql<string | null>`CASE WHEN json_valid(${pendingInteractions.payload}) AND json_type(${pendingInteractions.payload}, '$.kind') = 'text' THEN json_extract(${pendingInteractions.payload}, '$.kind') END`;

const oldestPendingInteractionApprovalSubjectKindSql = sql<string | null>`CASE WHEN json_valid(${pendingInteractions.payload}) AND json_type(${pendingInteractions.payload}, '$.subject.kind') = 'text' THEN json_extract(${pendingInteractions.payload}, '$.subject.kind') END`;

export function oldestPendingInteractionRowFilterAndOrder(
  threadId: SQL | AnyColumn,
): { orderBy: SQL; where: SQL } {
  return {
    orderBy: sql`${pendingInteractions.createdAt} ASC, ${pendingInteractions.id} ASC`,
    where: sql`${pendingInteractions.threadId} = ${threadId} AND ${pendingInteractions.status} = 'pending'`,
  };
}

function oldestPendingInteractionScalarSubquery(
  threadId: AnyColumn,
  kindSql: SQL<string | null>,
): SQL<string | null> {
  const scope = oldestPendingInteractionRowFilterAndOrder(threadId);
  return sql<string | null>`(SELECT ${kindSql} FROM ${pendingInteractions} WHERE ${scope.where} ORDER BY ${scope.orderBy} LIMIT 1)`;
}

export function oldestPendingInteractionKindColumns(threadId: AnyColumn): {
  pendingInteractionPayloadKind: SQL<string | null>;
  pendingInteractionApprovalSubjectKind: SQL<string | null>;
} {
  return {
    pendingInteractionPayloadKind: oldestPendingInteractionScalarSubquery(
      threadId,
      oldestPendingInteractionPayloadKindSql,
    ),
    pendingInteractionApprovalSubjectKind:
      oldestPendingInteractionScalarSubquery(
        threadId,
        oldestPendingInteractionApprovalSubjectKindSql,
      ),
  };
}

export function getOldestPendingInteractionKindInputs(
  db: PendingInteractionReadConnection,
  threadId: string,
): PendingInteractionKindInputs | null {
  const scope = oldestPendingInteractionRowFilterAndOrder(sql`${threadId}`);
  const row = db
    .select({
      pendingInteractionPayloadKind: oldestPendingInteractionPayloadKindSql,
      pendingInteractionApprovalSubjectKind:
        oldestPendingInteractionApprovalSubjectKindSql,
    })
    .from(pendingInteractions)
    .where(scope.where)
    .orderBy(scope.orderBy)
    .limit(1)
    .get();
  if (!row) {
    return null;
  }
  return {
    payloadKind: row.pendingInteractionPayloadKind,
    approvalSubjectKind: row.pendingInteractionApprovalSubjectKind,
  };
}

export function setTimedOutPendingInteractionResolved(
  db: PendingInteractionWriteConnection,
  args: {
    id: string;
    resolution: string;
  },
): PendingInteractionRow | null {
  const now = Date.now();
  return (
    db
      .update(pendingInteractions)
      .set({
        status: "resolved",
        resolution: args.resolution,
        statusReason: null,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(pendingInteractions.id, args.id),
          eq(pendingInteractions.status, "interrupted"),
          eq(pendingInteractions.statusReason, "timeout"),
        ),
      )
      .returning()
      .get() ?? null
  );
}

export function forkThreadPendingKindState(row: {
  hasPendingInteraction: number;
  pendingInteractionPayloadKind: string | null;
  pendingInteractionApprovalSubjectKind: string | null;
}): { pendingInteractionKind: ThreadPendingInteractionKind | null } {
  return {
    pendingInteractionKind:
      row.hasPendingInteraction > 0
        ? classifyPendingInteractionKind({
            payloadKind: row.pendingInteractionPayloadKind,
            approvalSubjectKind: row.pendingInteractionApprovalSubjectKind,
          })
        : null,
  };
}
