import { randomUUID } from "node:crypto";
// oxlint-disable-next-line no-restricted-imports
import { realpathSync } from "node:fs";
import type { DbConnection } from "@bb/db";
import { hostDaemonCommandResultSchemaByType } from "@bb/host-daemon-contract";
import { startAdminServer } from "./admin-server.js";
import { resumeDeferredHostEnvironmentRefreshes } from "./services/hosts/host-environment-sync.fork.js";
import type { PluginService } from "./services/plugins/plugin-service.js";
import { WorkQuiesceService } from "./services/system/work-quiesce.js";
import {
  resumeQueuedWorkAfterQuiesce,
  runQuiesceReleaseHooks,
} from "./services/threads/queue-quiesce-resume.fork.js";
import type { ServerLogger } from "./types.js";
import type { NotificationHub } from "./ws/hub.js";

interface ForkMaintenanceAttachment {
  pluginService: PluginService;
  sweepDeps: Parameters<typeof resumeQueuedWorkAfterQuiesce>[0];
}

export function createForkMaintenance(args: {
  db: DbConnection;
  hub: NotificationHub;
  logger: ServerLogger;
}) {
  const { db, hub, logger } = args;
  let attachment: ForkMaintenanceAttachment | undefined;
  const workQuiesce = new WorkQuiesceService({
    db,
    local: {
      quiesce: async () => attachment?.pluginService.quiesceBackgroundWork(),
      release: () =>
        runQuiesceReleaseHooks(logger, [
          () => attachment?.pluginService.resumeBackgroundWork(),
          () => resumeDeferredHostEnvironmentRefreshes(db),
          () =>
            attachment && resumeQueuedWorkAfterQuiesce(attachment.sweepDeps),
        ]),
    },
    transport: {
      listConnectedHostIds: () => hub.listConnectedHostIds(),
      send: async (hostId, command) => {
        const response = await hub.requestHostOnlineRpc({
          hostId,
          allowUndispatchable: true,
          timeoutMs: 30_000,
          message: {
            type: "host-rpc.request",
            requestId: `maintenance_${randomUUID()}`,
            command,
          },
        });
        if (!response.ok) {
          throw new Error(`${response.errorCode}: ${response.errorMessage}`);
        }
        if (response.commandType !== command.type) {
          throw new Error("host maintenance barrier result type mismatch");
        }
        return hostDaemonCommandResultSchemaByType[command.type].parse(
          response.result,
        );
      },
    },
  });
  return {
    workQuiesce,
    attach(next: ForkMaintenanceAttachment): void {
      attachment = next;
    },
    startAdminServer(config: { BB_DATA_DIR: string }) {
      return startAdminServer({
        connectedHostIds: () => hub.listConnectedHostIds(),
        dataDir: config.BB_DATA_DIR,
        releaseIdentity: realpathSync(process.cwd()),
        service: workQuiesce,
      });
    },
  };
}
