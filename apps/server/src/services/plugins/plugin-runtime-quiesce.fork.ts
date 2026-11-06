import {
  admitExecutionStart,
  markWorkAdmissionActive,
  settleWorkAdmission,
  type DbConnection,
  type WorkAdmissionToken,
} from "@bb/db";
import type { ServiceRuntime } from "./plugin-service-internal.js";
import { settledWithin } from "./plugin-time-box.js";

interface BackgroundQuiesceArgs {
  db: DbConnection;
  loaded: ReadonlyMap<string, { services: ServiceRuntime[] }>;
  runService: (id: string, service: ServiceRuntime) => void;
  stopTimeoutMs: number;
}

export function createBackgroundQuiesce(args: BackgroundQuiesceArgs) {
  const { db, loaded, runService, stopTimeoutMs } = args;
  let quiesced = false;
  return {
    admit(id: string, service: ServiceRuntime): WorkAdmissionToken | null {
      const admission = admitExecutionStart(db, {
        commandType: "plugin.service",
        transport: "settled",
        context: { pluginId: id, service: service.record.name },
      });
      if (admission.kind === "quiesced") {
        service.state = "quiesced";
        return null;
      }
      if (!markWorkAdmissionActive(db, admission.token)) {
        settleWorkAdmission(db, admission.token);
        service.state = "quiesced";
        return null;
      }
      return admission.token;
    },

    async run(
      token: WorkAdmissionToken,
      start: () => Promise<void> | void,
    ): Promise<void> {
      try {
        await start();
      } finally {
        settleWorkAdmission(db, token);
      }
    },

    settled(service: ServiceRuntime, restart: () => void): boolean {
      if (service.state !== "quiesced") return false;
      if (!quiesced) restart();
      return true;
    },

    async quiesce(): Promise<void> {
      quiesced = true;
      const running: Promise<void>[] = [];
      for (const plugin of loaded.values()) {
        for (const service of plugin.services) {
          if (service.restartTimer !== null) {
            clearTimeout(service.restartTimer);
            service.restartTimer = null;
            service.state = "quiesced";
          }
          if (service.current !== null) {
            service.state = "quiesced";
            service.controller?.abort();
            running.push(service.current);
          }
        }
      }
      await Promise.all(
        running.map((current) => settledWithin(current, stopTimeoutMs)),
      );
    },

    resume(): void {
      quiesced = false;
      for (const [id, plugin] of loaded) {
        for (const service of plugin.services) {
          if (
            service.state === "quiesced" &&
            service.current === null &&
            !service.disposed
          ) {
            runService(id, service);
          }
        }
      }
    },
  };
}
