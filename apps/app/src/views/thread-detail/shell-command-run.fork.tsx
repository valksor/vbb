import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ShellCommandRunDrawer,
  type ShellCommandRunPrompt,
} from "@/components/dialogs/ShellCommandRunDrawer";
import {
  isRunnableShellCodeLanguage,
  type MarkdownShellCommandRunner,
} from "@/components/ui/markdown-shell-command-run";
import type { RunCommandTargetResult } from "@/hooks/useRunCommandTarget.fork";

interface UseShellCommandRunArgs extends RunCommandTargetResult {
  workspacePreviewRootPath: string | null;
}

export function useShellCommandRun({
  runCommandInPreferredTerminalTarget,
  runCommandTarget,
  workspacePreviewRootPath,
}: UseShellCommandRunArgs): {
  drawer: ReactNode;
  shellCommandRunner: MarkdownShellCommandRunner | null;
} {
  const [shellCommandPrompt, setShellCommandPrompt] =
    useState<ShellCommandRunPrompt | null>(null);
  const shellCommandRunner = useMemo(
    () =>
      runCommandTarget === null || workspacePreviewRootPath === null
        ? null
        : (code: string, language: string) => {
            setShellCommandPrompt({ command: code, language });
          },
    [runCommandTarget, workspacePreviewRootPath],
  );
  const handleShellCommandConfirm = useCallback(
    (prompt: ShellCommandRunPrompt) => {
      setShellCommandPrompt(null);
      if (
        workspacePreviewRootPath === null ||
        !isRunnableShellCodeLanguage(prompt.language)
      ) {
        return;
      }
      void runCommandInPreferredTerminalTarget({
        command: prompt.command,
        cwd: workspacePreviewRootPath,
        language: prompt.language,
      });
    },
    [runCommandInPreferredTerminalTarget, workspacePreviewRootPath],
  );
  return {
    drawer: (
      <ShellCommandRunDrawer
        cwd={workspacePreviewRootPath}
        prompt={shellCommandPrompt}
        targetLabel={runCommandTarget?.label ?? null}
        onConfirm={handleShellCommandConfirm}
        onDismiss={() => {
          setShellCommandPrompt(null);
        }}
      />
    ),
    shellCommandRunner,
  };
}
