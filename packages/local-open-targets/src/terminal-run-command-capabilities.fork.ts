import { TERMINAL_OPEN_CAPABILITIES } from "./capabilities.js";
import type { WorkspaceOpenTargetCapabilities } from "@bb/host-daemon-contract";

export const TERMINAL_RUN_COMMAND_CAPABILITIES: WorkspaceOpenTargetCapabilities =
  {
    ...TERMINAL_OPEN_CAPABILITIES,
    runCommand: true,
  };
