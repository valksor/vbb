import { createContext, useContext, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import {
  isRunnableShellCodeBlock,
  isRunnableShellCodeLanguage,
  type MarkdownShellCommandRunner,
} from "./markdown-shell-command-run";

const ShellCommandRunnerContext =
  createContext<MarkdownShellCommandRunner | null>(null);

const ShellCommandRunnerSourceContext =
  createContext<MarkdownShellCommandRunner | null>(null);

export function ShellCommandRunnerSourceProvider({
  children,
  runner,
}: {
  children: ReactNode;
  runner: MarkdownShellCommandRunner | null;
}) {
  return (
    <ShellCommandRunnerSourceContext.Provider value={runner}>
      {children}
    </ShellCommandRunnerSourceContext.Provider>
  );
}

export function ShellCommandRunnerActivation({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const source = useContext(ShellCommandRunnerSourceContext);
  return (
    <ShellCommandRunnerContext.Provider value={enabled ? source : null}>
      {children}
    </ShellCommandRunnerContext.Provider>
  );
}

export function ShellCommandRunnerScopeReset({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ShellCommandRunnerSourceContext.Provider value={null}>
      <ShellCommandRunnerContext.Provider value={null}>
        {children}
      </ShellCommandRunnerContext.Provider>
    </ShellCommandRunnerSourceContext.Provider>
  );
}

export function usePinShellCommandRunner(): (node: ReactNode) => ReactNode {
  const runner = useContext(ShellCommandRunnerContext);
  return (node) => (
    <ShellCommandRunnerContext.Provider value={runner}>
      {node}
    </ShellCommandRunnerContext.Provider>
  );
}

export function ShellCommandRunButton({
  code,
  language,
}: {
  code: string;
  language: string | null;
}) {
  const shellCommandRunner = useContext(ShellCommandRunnerContext);
  const shellCommandLanguage = isRunnableShellCodeLanguage(language)
    ? language
    : null;
  if (
    shellCommandRunner === null ||
    shellCommandLanguage === null ||
    !isRunnableShellCodeBlock({ code })
  ) {
    return null;
  }
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Run in terminal (${shellCommandLanguage})`}
            onClick={() => {
              shellCommandRunner(code, shellCommandLanguage);
            }}
            className="mr-2 inline-flex size-6 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon name="Play" className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Run in terminal</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
