import { useCallback, useMemo } from "react";
import type {
  OpenInTargetCommandLanguage,
  WorkspaceOpenTarget,
} from "@bb/host-daemon-contract";
import { appToast } from "@/components/ui/app-toast";
import { resolvePreferredWorkspaceOpenTarget } from "@/lib/workspace-open-target-preference";
import type { WorkspaceOpenTargetContextKind } from "@/lib/workspace-open-target-preference";
import { useTerminalRunTargetPreference } from "@/lib/workspace-open-target-preference.fork";
import type { useWorkspaceOpenTargets } from "./useWorkspaceOpenTargets";

const LOCAL_RUN_FAILURE_TITLE = "Failed to run command in terminal";
const LOCAL_DAEMON_UNAVAILABLE_RUN_DESCRIPTION =
  "Local host daemon is unavailable.";
const LOCAL_NO_RUN_COMMAND_TARGETS_DESCRIPTION =
  "No local terminal can run commands.";
const LOCAL_RUN_REQUEST_FAILED_DESCRIPTION =
  "The local daemon could not run the command.";

export interface RunCommandInTerminalArgs {
  command: string;
  cwd: string;
  language?: OpenInTargetCommandLanguage;
}

export interface RunCommandTargetResult {
  runCommandInPreferredTerminalTarget: (
    args: RunCommandInTerminalArgs,
  ) => Promise<boolean>;
  runCommandTarget: WorkspaceOpenTarget | null;
}

interface UseRunCommandTargetArgs {
  contextKind: WorkspaceOpenTargetContextKind;
  openWorkspace: ReturnType<typeof useWorkspaceOpenTargets>["openWorkspace"];
  workspaceOpenTargets: WorkspaceOpenTarget[];
}

function dispatchRunFailureToast(args: { description?: string }): void {
  appToast.error(LOCAL_RUN_FAILURE_TITLE, {
    ...(args.description ? { description: args.description } : {}),
  });
}

export function useRunCommandTarget({
  contextKind,
  openWorkspace,
  workspaceOpenTargets,
}: UseRunCommandTargetArgs): RunCommandTargetResult {
  const [preferredRunCommandTargetId] = useTerminalRunTargetPreference();
  const runCommandTarget = useMemo(
    () =>
      contextKind === "local"
        ? resolvePreferredWorkspaceOpenTarget({
            capability: "runCommand",
            contextKind,
            preferredTargetId: preferredRunCommandTargetId,
            targets: workspaceOpenTargets,
          })
        : null,
    [contextKind, preferredRunCommandTargetId, workspaceOpenTargets],
  );

  const runCommandInPreferredTerminalTarget = useCallback(
    async (request: RunCommandInTerminalArgs): Promise<boolean> => {
      if (!openWorkspace) {
        dispatchRunFailureToast({
          description: LOCAL_DAEMON_UNAVAILABLE_RUN_DESCRIPTION,
        });
        return false;
      }
      if (runCommandTarget === null) {
        dispatchRunFailureToast({
          description: LOCAL_NO_RUN_COMMAND_TARGETS_DESCRIPTION,
        });
        return false;
      }

      try {
        await openWorkspace({
          columnNumber: null,
          command: request.command,
          context: { kind: "local" },
          lineNumber: null,
          path: request.cwd,
          targetId: runCommandTarget.id,
          ...(request.language === undefined
            ? {}
            : { language: request.language }),
        });
      } catch {
        dispatchRunFailureToast({
          description: LOCAL_RUN_REQUEST_FAILED_DESCRIPTION,
        });
        return false;
      }
      appToast.success(`Command sent to ${runCommandTarget.label}`);
      return true;
    },
    [openWorkspace, runCommandTarget],
  );

  return { runCommandInPreferredTerminalTarget, runCommandTarget };
}
