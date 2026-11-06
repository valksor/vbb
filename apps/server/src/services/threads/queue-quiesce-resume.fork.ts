import { listIdleThreadsWithQueuedMessages } from "@bb/db";
import type {
  LoggedPendingInteractionWorkSessionDeps,
  ServerLogger,
} from "../../types.js";
import { resumeEnvironmentProvisioningForHost } from "../environments/environment-engine.js";
import {
  clearObservedQuiesceHold,
  registerQuiesceEndedHandler,
} from "./queue-quiesce.fork.js";
import { requestQueuedMessageDispatch } from "./queued-message-dispatch.js";

export function resumeHostEnvironmentProvisioning(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: { hostId: string; sessionId: string | null },
): void {
  void resumeEnvironmentProvisioningForHost(deps, {
    hostId: args.hostId,
  }).catch((error) => {
    deps.logger.warn(
      {
        err: error,
        hostId: args.hostId,
        sessionId: args.sessionId,
      },
      "Environment provisioning reconnect resume failed",
    );
  });
}

export function resumeQueuedWorkAfterQuiesce(
  deps: LoggedPendingInteractionWorkSessionDeps,
): void {
  clearObservedQuiesceHold(deps.db);
  for (const hostId of deps.hub.listConnectedHostIds()) {
    requestQueuedMessageDispatch(deps, { hostId, kind: "host-connected" });
    resumeHostEnvironmentProvisioning(deps, { hostId, sessionId: null });
  }
  for (const { threadId } of listIdleThreadsWithQueuedMessages(deps.db)) {
    requestQueuedMessageDispatch(deps, { kind: "thread-ready", threadId });
  }
  requestQueuedMessageDispatch(deps, { kind: "plugin-recheck" });
}

registerQuiesceEndedHandler(resumeQueuedWorkAfterQuiesce);

export function runQuiesceReleaseHooks(
  logger: Pick<ServerLogger, "warn">,
  hooks: ReadonlyArray<() => void>,
): void {
  for (const hook of hooks) {
    try {
      hook();
    } catch (error) {
      logger.warn({ err: error }, "Work quiesce release hook failed");
    }
  }
}
