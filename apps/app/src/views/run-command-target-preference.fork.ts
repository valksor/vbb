import type { WorkspaceOpenTargetCapability } from "@/lib/workspace-open-target-preference";
import { useTerminalRunTargetPreference } from "@/lib/workspace-open-target-preference.fork";

const RUN_COMMAND_TARGET_PREFERENCE = {
  capability: "runCommand",
  emptyDescription: "No local terminal can run commands.",
  label: "Terminal default",
} satisfies {
  capability: WorkspaceOpenTargetCapability;
  emptyDescription: string;
  label: string;
};

export function useRunCommandTargetPreferenceControl() {
  const [runCommandTargetId, setRunCommandTargetId] =
    useTerminalRunTargetPreference();
  return {
    definition: RUN_COMMAND_TARGET_PREFERENCE,
    onTargetChange: setRunCommandTargetId,
    preferredTargetId: runCommandTargetId,
  };
}
