import { runProviderTurnWatchdogSweep } from "../threads/provider-turn-watchdog.js";
import { reconcileBranchPromotions } from "../threads/thread-environment-branch.fork.js";
import {
  DATABASE_INCREMENTAL_VACUUM_MAX_PAGES,
  runIncrementalVacuum,
} from "@bb/db";
import type { AppDeps } from "../../types.js";
import type { PeriodicSweepJob } from "./periodic-sweeps.js";

type DatabaseMaintenanceSweepDeps = Pick<AppDeps, "db" | "logger">;

const DATABASE_INCREMENTAL_VACUUM_CHUNK_PAGES = 256;

function isSqliteBusyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_BUSY")
  );
}

export async function runChunkedIncrementalVacuum(
  deps: DatabaseMaintenanceSweepDeps,
): Promise<ReturnType<typeof runIncrementalVacuum> | null> {
  let first: ReturnType<typeof runIncrementalVacuum> | null = null;
  let last: ReturnType<typeof runIncrementalVacuum> | null = null;
  for (
    let vacuumedPages = 0;
    vacuumedPages < DATABASE_INCREMENTAL_VACUUM_MAX_PAGES;
    vacuumedPages += DATABASE_INCREMENTAL_VACUUM_CHUNK_PAGES
  ) {
    if (last !== null) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    let chunk: ReturnType<typeof runIncrementalVacuum>;
    try {
      chunk = runIncrementalVacuum(deps.db, {
        maxPages: Math.min(
          DATABASE_INCREMENTAL_VACUUM_CHUNK_PAGES,
          DATABASE_INCREMENTAL_VACUUM_MAX_PAGES - vacuumedPages,
        ),
      });
    } catch (error) {
      if (first === null || last === null || !isSqliteBusyError(error)) {
        throw error;
      }
      deps.logger.warn(
        { err: error, result: { before: first.before, after: last.after } },
        "Incremental database vacuum stopped early",
      );
      return null;
    }
    last = chunk;
    first ??= chunk;
    if (last.after.freelistCount === 0) {
      break;
    }
  }
  if (first === null || last === null) {
    throw new Error("Incremental vacuum ran no chunks");
  }
  return { before: first.before, after: last.after };
}

export const FORK_PERIODIC_SWEEP_JOBS: PeriodicSweepJob[] = [
  {
    cadenceMs: 15_000,
    category: "durable-intent-retry",
    name: "branch-promotion-reconciliation",
    run: reconcileBranchPromotions,
  },
  {
    cadenceMs: 60_000,
    category: "maintenance",
    name: "provider-turn-idle-watchdog",
    run: (deps, now) => {
      runProviderTurnWatchdogSweep(deps, { now });
    },
  },
];
