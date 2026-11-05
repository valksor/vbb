import type { ComponentProps } from "react";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { ShellCommandRunnerActivation } from "@/components/ui/markdown-shell-command-run.fork";

export function ShellRunMarkdownPreview({
  shellRun,
  ...props
}: ComponentProps<typeof MarkdownPreview> & { shellRun: boolean }) {
  return (
    <ShellCommandRunnerActivation enabled={shellRun}>
      <MarkdownPreview {...props} />
    </ShellCommandRunnerActivation>
  );
}
