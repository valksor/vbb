import { isWorkAdmissionOpen, type DbConnection } from "@bb/db";

const deferredRefreshes = new WeakMap<DbConnection, Map<string, () => void>>();

export function deferRefreshWhileQuiesced(
  db: DbConnection,
  hostId: string,
  retry: () => void,
): boolean {
  if (isWorkAdmissionOpen(db)) return false;
  let retries = deferredRefreshes.get(db);
  if (retries === undefined) {
    retries = new Map();
    deferredRefreshes.set(db, retries);
  }
  retries.set(hostId, retry);
  return true;
}

export function resumeDeferredHostEnvironmentRefreshes(db: DbConnection): void {
  const retries = deferredRefreshes.get(db);
  if (retries === undefined) return;
  const pending = [...retries.values()];
  retries.clear();
  for (const retry of pending) retry();
}
