import type { ComponentProps } from "react";
import { ShellCommandRunnerSourceProvider } from "@/components/ui/markdown-shell-command-run.fork";
import { ConversationMessageContent } from "./ConversationMessageContent";

export function DelegationOutputMessageContent(
  props: ComponentProps<typeof ConversationMessageContent>,
) {
  return (
    <ShellCommandRunnerSourceProvider runner={null}>
      <ConversationMessageContent {...props} />
    </ShellCommandRunnerSourceProvider>
  );
}
