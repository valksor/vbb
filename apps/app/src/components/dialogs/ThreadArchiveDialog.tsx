import { useRef, type RefObject } from "react";
import type { Thread } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@bb/shared-ui/dialog";
import { ArchiveDialogCopy } from "./ThreadArchiveDialog.fork";

export interface ThreadArchiveDialogTarget {
  threads: readonly Thread[];
  childThreadCount: number;
  stopsRunningWork: boolean;
  environmentId?: string;
}

interface ThreadArchiveDialogProps<Target extends ThreadArchiveDialogTarget> {
  target: Target | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onArchive: (target: Target) => void;
}

export function ThreadArchiveDialog<Target extends ThreadArchiveDialogTarget>({
  target,
  pending,
  onOpenChange,
  onArchive,
}: ThreadArchiveDialogProps<Target>) {
  const contentRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (target?.stopsRunningWork) {
            cancelRef.current?.focus();
            return;
          }
          contentRef.current
            ?.querySelector<HTMLButtonElement>('button[type="submit"]')
            ?.focus();
        }}
      >
        {target ? (
          <ThreadArchiveDialogContent
            target={target}
            pending={pending}
            onOpenChange={onOpenChange}
            onArchive={onArchive}
            cancelRef={cancelRef}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface ThreadArchiveDialogContentProps<
  Target extends ThreadArchiveDialogTarget,
> {
  target: Target;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onArchive: (target: Target) => void;
  cancelRef: RefObject<HTMLButtonElement | null>;
}

export function ThreadArchiveDialogContent<
  Target extends ThreadArchiveDialogTarget,
>({
  target,
  pending,
  onOpenChange,
  onArchive,
  cancelRef,
}: ThreadArchiveDialogContentProps<Target>) {
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) {
          onArchive(target);
        }
      }}
    >
      <DialogHeader>
        <ArchiveDialogCopy target={target} />
      </DialogHeader>
      <DialogFooter>
        <Button
          ref={cancelRef}
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          Archive
        </Button>
      </DialogFooter>
    </form>
  );
}
