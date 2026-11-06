import type {
  HostDaemonRpcCommand,
  HostDaemonRpcResultForCommand,
  HostDaemonWorkActivitySnapshot,
} from "@bb/host-daemon-contract";
import { hostDaemonQuiescePolicyForCommand } from "@bb/host-daemon-contract";
import type { CommandRouterOptions } from "./command-router.js";
import { ExpectedCommandDispatchError } from "./command-dispatch-support.js";
import { WorkAdmissionLane } from "./work-admission-lane.js";
import { WorkQuiesceGate } from "./work-quiesce-gate.js";

type WorkBarrierOptions = Pick<
  CommandRouterOptions,
  "pluginHostManager" | "runtimeManager"
>;

function isWorkBarrierCommand(command: HostDaemonRpcCommand): boolean {
  return (
    command.type === "work.quiesce" ||
    command.type === "work.seal" ||
    command.type === "work.unquiesce"
  );
}

export class WorkBarrier {
  private readonly workAdmissionLane = new WorkAdmissionLane();
  private readonly workQuiesceGate = new WorkQuiesceGate();

  constructor(private readonly getOptions: () => WorkBarrierOptions) {}

  run(
    command: HostDaemonRpcCommand,
    execute: () => Promise<HostDaemonRpcResultForCommand>,
  ): Promise<HostDaemonRpcResultForCommand> {
    if (isWorkBarrierCommand(command)) {
      return this.workAdmissionLane.runExclusive(() =>
        this.runBody(command, execute),
      );
    }
    if (hostDaemonQuiescePolicyForCommand(command) === "execution-start") {
      return this.workAdmissionLane.runShared(() =>
        this.runBody(command, execute),
      );
    }
    return this.runBody(command, execute);
  }

  private runBody(
    command: HostDaemonRpcCommand,
    execute: () => Promise<HostDaemonRpcResultForCommand>,
  ): Promise<HostDaemonRpcResultForCommand> {
    if (command.type === "work.quiesce") {
      const gate = this.workQuiesceGate.quiesce(command);
      return Promise.resolve({
        operationId: gate.operationId,
        gatePhase: "draining",
        activity: this.getWorkActivitySnapshot(),
      });
    }
    if (command.type === "work.seal") {
      const gate = this.workQuiesceGate.seal(command.operationId);
      return Promise.resolve({
        operationId: gate.operationId,
        gatePhase: "sealed",
        activity: this.getWorkActivitySnapshot(),
      });
    }
    if (command.type === "work.unquiesce") {
      this.workQuiesceGate.unquiesce(command.operationId);
      return Promise.resolve({
        operationId: command.operationId,
        released: true,
      });
    }
    if (
      hostDaemonQuiescePolicyForCommand(command) === "execution-start" &&
      !this.workQuiesceGate.allowsExecutionStart()
    ) {
      return Promise.reject(
        new ExpectedCommandDispatchError(
          "work_quiesced",
          "host is not accepting new executable work during maintenance",
        ),
      );
    }
    return execute();
  }

  private getWorkActivitySnapshot(): HostDaemonWorkActivitySnapshot {
    const options = this.getOptions();
    const activeByKind: Record<string, number> = {};
    const activeThreads = options.runtimeManager.listActiveThreads().length;
    if (activeThreads > 0) activeByKind.thread = activeThreads;
    const activePluginCalls =
      options.pluginHostManager?.getActiveCallCount() ?? 0;
    if (activePluginCalls > 0) activeByKind.pluginCall = activePluginCalls;
    return { activeByKind };
  }
}
