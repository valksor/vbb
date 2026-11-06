import { handleDaemonSocketOpened } from "../internal/session-owner-side-effects.js";
import { requestQueuedMessageDispatch } from "../services/threads/queued-message-dispatch.js";
import { resumeHostEnvironmentProvisioning } from "../services/threads/queue-quiesce-resume.fork.js";
import {
  isServerMoveFrozen,
  isServerMoveSnapshotFenced,
} from "../services/server-move/freeze-state.js";
import type { WorkQuiesceService } from "../services/system/work-quiesce.js";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../types.js";

type GatedDaemonSocket = Parameters<AppDeps["hub"]["registerDaemon"]>[2] & {
  close(code?: number, reason?: string): void;
};

export function openDaemonSocketBehindMaintenanceGate(
  deps: LoggedPendingInteractionWorkSessionDeps &
    Pick<AppDeps, "hub" | "logger" | "sharedPorts" | "terminalSessions">,
  args: { hostId: string; sessionId: string; socket: GatedDaemonSocket },
  workQuiesce: WorkQuiesceService,
): void {
  deps.hub.registerDaemon(args.sessionId, args.hostId, args.socket, {
    dispatchable: false,
  });
  handleDaemonSocketOpened(deps, { hostId: args.hostId });
  void workQuiesce
    .applyToConnectingDaemon(args.hostId)
    .then((maintenanceActive) => {
      deps.hub.markDaemonDispatchable(args.sessionId);
      deps.sharedPorts.pushCurrentSharedPortsForHost(args.hostId);
      deps.sharedPorts.pushCurrentNextTunnelForHost(args.hostId);
      if (!isServerMoveSnapshotFenced(deps.db)) {
        deps.terminalSessions.reconcileDisconnectedHostTerminals({
          daemonSessionId: args.sessionId,
          hostId: args.hostId,
        });
      }
      if (isServerMoveFrozen(deps.db)) {
        return;
      }
      if (!maintenanceActive) {
        requestQueuedMessageDispatch(deps, {
          hostId: args.hostId,
          kind: "host-connected",
        });
        resumeHostEnvironmentProvisioning(deps, {
          hostId: args.hostId,
          sessionId: args.sessionId,
        });
      }
    })
    .catch((error) => {
      deps.hub.unregisterDaemon(args.sessionId);
      args.socket.close(1011, "maintenance-gate-failed");
      throw error;
    })
    .catch((error) => {
      deps.logger.error(
        { err: error, hostId: args.hostId },
        "Daemon maintenance gate failed during registration",
      );
    });
}
