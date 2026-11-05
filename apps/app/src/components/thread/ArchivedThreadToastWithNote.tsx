import type { ComponentProps } from "react";
import { ArchivedThreadToastDescription } from "./ArchivedThreadToastDescription";

type ArchivedThreadToastWithNoteProps = ComponentProps<
  typeof ArchivedThreadToastDescription
> & { note?: string };

export function ArchivedThreadToastWithNote({
  note,
  ...props
}: ArchivedThreadToastWithNoteProps) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <ArchivedThreadToastDescription {...props} />
      {note !== undefined ? (
        <span className="text-muted-foreground">{note}</span>
      ) : null}
    </span>
  );
}

export function archivedToastTitle(
  single: boolean,
  stoppedWork: boolean,
): string {
  if (single)
    return stoppedWork ? "Thread stopped and archived" : "Thread archived";
  return stoppedWork ? "Threads stopped and archived" : "Threads archived";
}

export function archivedToastNote(stoppedWork: boolean): string | undefined {
  return stoppedWork ? "Undo restores it with partial output." : undefined;
}

export function archivedToastText(
  summary: string,
  archivedCount: number,
  stoppedWork: boolean,
): string {
  if (!stoppedWork) return summary;
  return `${summary}. Undo restores ${archivedCount === 1 ? "it" : "them"} with partial output.`;
}
