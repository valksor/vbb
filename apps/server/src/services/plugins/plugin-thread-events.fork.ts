import type { ProviderTurnWatchdogAction, Thread } from "@bb/domain";
import type {
  PluginThreadEventName,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import { getPluginThreadEventEmitter } from "./plugin-thread-events.js";

export type EmitThreadTurnWatchdog = (
  thread: Thread,
  payload: {
    elapsedMs: number;
    thresholdMs: number;
    action: ProviderTurnWatchdogAction;
  },
) => void;

export function emitPluginThreadTurnWatchdog(
  ...args: Parameters<EmitThreadTurnWatchdog>
): void {
  getPluginThreadEventEmitter()?.emitThreadTurnWatchdog?.(...args);
}

export function forkThreadEventEmitters(args: {
  emitThreadEvent: <E extends PluginThreadEventName>(
    event: E,
    buildPayload: () => PluginThreadEventPayloads[E] | null,
  ) => void;
  buildThreadDto: (
    thread: Thread,
  ) => PluginThreadEventPayloads["experimental_thread.turnWatchdog"]["thread"];
}): { emitThreadTurnWatchdog: EmitThreadTurnWatchdog } {
  return {
    emitThreadTurnWatchdog(thread, payload) {
      args.emitThreadEvent("experimental_thread.turnWatchdog", () => ({
        thread: args.buildThreadDto(thread),
        elapsedMs: payload.elapsedMs,
        thresholdMs: payload.thresholdMs,
        action: payload.action,
      }));
    },
  };
}
