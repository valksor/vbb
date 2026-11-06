import {
  claimPluginScheduledRunWithAdmission,
  markWorkAdmissionActive,
  recordPluginScheduleResult,
  settleWorkAdmission,
  type DbConnection,
} from "@bb/db";

export async function runAdmittedSchedule(
  db: DbConnection,
  args: {
    row: { pluginId: string; name: string; nextRunAt: number };
    newNextRunAt: number;
    now: number;
  },
  invoke: () => Promise<{ ok: true } | { ok: false; error: string }>,
): Promise<"quiesced" | "skipped" | "ran"> {
  const { row } = args;
  const claim = claimPluginScheduledRunWithAdmission(db, {
    pluginId: row.pluginId,
    name: row.name,
    expectedNextRunAt: row.nextRunAt,
    newNextRunAt: args.newNextRunAt,
    now: args.now,
  });
  if (claim.kind === "quiesced") return "quiesced";
  if (claim.kind === "not-claimed") return "skipped";
  if (!markWorkAdmissionActive(db, claim.token)) {
    settleWorkAdmission(db, claim.token);
    return "skipped";
  }
  try {
    const outcome = await invoke();
    recordPluginScheduleResult(db, {
      pluginId: row.pluginId,
      name: row.name,
      status: outcome.ok ? "ok" : "error",
      error: outcome.ok ? null : outcome.error,
      now: Date.now(),
    });
  } finally {
    settleWorkAdmission(db, claim.token);
  }
  return "ran";
}
