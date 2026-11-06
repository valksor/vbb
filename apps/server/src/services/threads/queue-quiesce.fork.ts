import {
  isWorkAdmissionOpen,
  readWorkQuiesceLease,
  type DbQueryConnection,
} from "@bb/db";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";

const WORK_QUIESCED_CODE = "work_quiesced";

interface QuiesceHoldState {
  heldOperationId: string | null;
  loggedOperationId: string | null;
}

const quiesceHoldStates = new WeakMap<DbQueryConnection, QuiesceHoldState>();

function quiesceHoldState(db: DbQueryConnection): QuiesceHoldState {
  const existing = quiesceHoldStates.get(db);
  if (existing) return existing;
  const created: QuiesceHoldState = {
    heldOperationId: null,
    loggedOperationId: null,
  };
  quiesceHoldStates.set(db, created);
  return created;
}

export function isAutomaticQueuedDispatchHeld(
  deps: Pick<LoggedPendingInteractionWorkSessionDeps, "db" | "logger">,
): boolean {
  const state = quiesceHoldState(deps.db);
  const lease = readWorkQuiesceLease(deps.db);
  if (lease === null) {
    state.loggedOperationId = null;
    return false;
  }
  state.heldOperationId = lease.operationId;
  if (state.loggedOperationId !== lease.operationId) {
    state.loggedOperationId = lease.operationId;
    deps.logger.info(
      { operationId: lease.operationId, phase: lease.phase },
      "Holding automatic queued message dispatch while work is quiesced",
    );
  }
  return true;
}

export function observeQuiesceHoldEnded(db: DbQueryConnection): boolean {
  const state = quiesceHoldState(db);
  const lease = readWorkQuiesceLease(db);
  if (lease !== null) {
    state.heldOperationId = lease.operationId;
    return false;
  }
  const ended = state.heldOperationId !== null;
  state.heldOperationId = null;
  return ended;
}

type QuiesceEndedHandler = (
  deps: LoggedPendingInteractionWorkSessionDeps,
) => void;

let quiesceEndedHandler: QuiesceEndedHandler | null = null;

export function registerQuiesceEndedHandler(
  handler: QuiesceEndedHandler,
): void {
  quiesceEndedHandler = handler;
}

export function resumeQueuedWorkIfQuiesceEnded(
  deps: LoggedPendingInteractionWorkSessionDeps,
): void {
  if (observeQuiesceHoldEnded(deps.db)) quiesceEndedHandler?.(deps);
}

export function clearObservedQuiesceHold(db: DbQueryConnection): void {
  quiesceHoldState(db).heldOperationId = null;
}

export function isHeldWorkQuiescedError(
  deps: Pick<LoggedPendingInteractionWorkSessionDeps, "db">,
  error: unknown,
): boolean {
  return (
    error instanceof ApiError &&
    error.body.code === WORK_QUIESCED_CODE &&
    !isWorkAdmissionOpen(deps.db)
  );
}
