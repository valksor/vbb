import {
  assertWorkAdmissionOpen,
  createTerminalSession,
  type DbConnection,
  type DbTransaction,
  type TerminalSessionRow,
} from "@bb/db";
import { ApiError } from "../../errors.js";

export function requireWorkAdmissionOpen(tx: DbTransaction): void {
  const admission = assertWorkAdmissionOpen(tx);
  if (admission.kind === "open") return;
  throw new ApiError(
    503,
    admission.code,
    `Work admission is closed for maintenance: ${admission.lease.reason}`,
    {
      retryable: true,
      details: {
        operationId: admission.lease.operationId,
        expiresAt: admission.lease.expiresAt,
      },
    },
  );
}

export function createAdmittedTerminalSession(
  db: DbConnection,
  input: Parameters<typeof createTerminalSession>[1],
): TerminalSessionRow {
  const creation = db.transaction(
    (tx) => {
      const admission = assertWorkAdmissionOpen(tx);
      if (admission.kind === "quiesced") return admission;
      return {
        kind: "created" as const,
        session: createTerminalSession(tx, input),
      };
    },
    { behavior: "immediate" },
  );
  if (creation.kind === "quiesced") {
    throw new ApiError(
      503,
      creation.code,
      `Work admission is closed for maintenance: ${creation.lease.reason}`,
      {
        retryable: true,
        details: {
          operationId: creation.lease.operationId,
          expiresAt: creation.lease.expiresAt,
        },
      },
    );
  }
  return creation.session;
}
