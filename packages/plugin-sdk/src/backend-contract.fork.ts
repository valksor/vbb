import type { ProviderTurnWatchdogAction } from "@bb/domain";
import type { ThreadResponse } from "@bb/server-contract";

export interface ForkPluginThreadEventPayloads {
  /**
   * Fires when the watchdog flags or interrupts an idle provider turn: `notify`
   * when it first crosses the idle threshold (turn still running), `interrupt`
   * when it crosses the interrupt threshold and the turn is being stopped.
   * The payload includes the standard ThreadResponse DTO, which can contain a
   * user-written title or fallback, plus elapsedMs, thresholdMs, and action.
   * The additional watchdog fields contain no prompt or output snapshots.
   * Consumers must apply their existing privacy policy before forwarding the DTO.
   */
  "experimental_thread.turnWatchdog": {
    thread: ThreadResponse;
    elapsedMs: number;
    thresholdMs: number;
    action: ProviderTurnWatchdogAction;
  };
}
