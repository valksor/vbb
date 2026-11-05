import { useEffect, useId, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { ResponsiveDrawerShell } from "@bb/shared-ui/responsive-overlay";
import { stripBidiControlCharacters } from "@/components/ui/markdown-shell-command-run";

export interface ShellCommandRunPrompt {
  command: string;
  language: string;
}

interface ShellCommandRunDrawerProps {
  cwd: string | null;
  onConfirm: (prompt: ShellCommandRunPrompt) => void;
  onDismiss: () => void;
  prompt: ShellCommandRunPrompt | null;
  targetLabel: string | null;
}

export function ShellCommandRunDrawer({
  cwd,
  onConfirm,
  onDismiss,
  prompt,
  targetLabel,
}: ShellCommandRunDrawerProps) {
  const titleId = useId();
  const [lastPrompt, setLastPrompt] = useState(prompt);
  useEffect(() => {
    if (prompt !== null) {
      setLastPrompt(prompt);
    }
  }, [prompt]);

  return (
    <ResponsiveDrawerShell
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open) {
          onDismiss();
        }
      }}
      labelledBy={titleId}
      contentClassName="mx-auto max-w-xl"
    >
      {lastPrompt === null ? null : (
        <div className="flex min-h-0 flex-col gap-3 px-4 pb-4">
          <h2 id={titleId} className="text-sm font-semibold text-foreground">
            Run in terminal
          </h2>
          <pre
            aria-label="Command to run"
            className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-recessed px-3 py-2 font-mono text-xs text-foreground"
            role="region"
            tabIndex={0}
          >
            {stripBidiControlCharacters(lastPrompt.command)}
          </pre>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {cwd !== null ? (
              <>
                <dt>Directory</dt>
                <dd className="break-words font-mono">{cwd}</dd>
              </>
            ) : null}
            {targetLabel !== null ? (
              <>
                <dt>Terminal</dt>
                <dd className="break-words">{targetLabel}</dd>
              </>
            ) : null}
          </dl>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                onConfirm(lastPrompt);
              }}
            >
              Run in terminal
            </Button>
          </div>
        </div>
      )}
    </ResponsiveDrawerShell>
  );
}
