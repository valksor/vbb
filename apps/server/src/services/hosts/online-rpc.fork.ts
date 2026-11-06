import {
  admitExecutionStart,
  markWorkAdmissionActive,
  settleWorkAdmission,
  type WorkAdmissionToken,
} from "@bb/db";
import {
  hostDaemonCommandRegistry,
  hostDaemonQuiescePolicyForCommand,
  type HostDaemonRpcCommand,
} from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import type { WorkSessionDeps } from "../../types.js";

export async function withExecutionStartAdmission<TResult>(
  deps: WorkSessionDeps,
  args: { command: HostDaemonRpcCommand; hostId: string },
  run: () => Promise<TResult>,
): Promise<TResult> {
  let admissionToken: WorkAdmissionToken | null = null;
  if (hostDaemonQuiescePolicyForCommand(args.command) === "execution-start") {
    const admission = admitExecutionStart(deps.db, {
      commandType: args.command.type,
      transport: hostDaemonCommandRegistry[args.command.type].transport,
      hostId: args.hostId,
    });
    if (admission.kind === "quiesced") {
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
    admissionToken = admission.token;
  }
  try {
    if (admissionToken) markWorkAdmissionActive(deps.db, admissionToken);
    return await run();
  } finally {
    if (admissionToken) settleWorkAdmission(deps.db, admissionToken);
  }
}
