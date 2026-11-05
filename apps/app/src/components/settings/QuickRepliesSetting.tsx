import { useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  COMPOSER_QUICK_REPLIES_MAX_COUNT,
  UI_PREFERENCE_STRING_MAX_LENGTH,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Textarea } from "@bb/shared-ui/textarea";
import { quickRepliesAtom } from "@/components/promptbox/banner/quick-replies-preference";
import { SettingsWithControl } from "@/components/ui/settings-section";

function committedQuickReplies(rows: readonly string[]): string[] {
  return rows.map((row) => row.trim()).filter((row) => row.length > 0);
}

function sameQuickReplies(a: readonly string[], b: readonly string[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const REMOTE_CHANGE_MESSAGE =
  "Quick replies changed in another window. Reload saved replies before saving your edits.";

export function QuickRepliesSetting() {
  const quickReplies = useAtomValue(quickRepliesAtom);
  const setQuickReplies = useSetAtom(quickRepliesAtom);
  const [draft, setDraft] = useState([...quickReplies]);
  const [hasRemoteChangeConflict, setHasRemoteChangeConflict] = useState(false);
  const focusedRowCountRef = useRef(0);
  const dirtyRef = useRef(false);
  const syncedRef = useRef<readonly string[]>([...quickReplies]);
  useEffect(() => {
    if (hasRemoteChangeConflict) return;
    if (focusedRowCountRef.current > 0) return;
    if (sameQuickReplies(quickReplies, syncedRef.current)) return;
    syncedRef.current = [...quickReplies];
    setDraft([...quickReplies]);
  }, [hasRemoteChangeConflict, quickReplies]);

  const commitDraft = (rows: readonly string[]) => {
    const editBase = [...syncedRef.current];
    const desired = committedQuickReplies(rows);
    if (!sameQuickReplies(quickReplies, editBase)) {
      setHasRemoteChangeConflict(true);
      return false;
    }
    if (!sameQuickReplies(desired, quickReplies)) {
      try {
        setQuickReplies((current) => {
          if (sameQuickReplies(current, desired)) return desired;
          if (sameQuickReplies(current, editBase)) return desired;
          throw new Error(REMOTE_CHANGE_MESSAGE);
        });
      } catch {
        setHasRemoteChangeConflict(true);
        return false;
      }
    }
    syncedRef.current = [...desired];
    setDraft([...desired]);
    setHasRemoteChangeConflict(false);
    return true;
  };
  const reseedIfRemoteChanged = () => {
    if (
      focusedRowCountRef.current === 0 &&
      !sameQuickReplies(quickReplies, syncedRef.current)
    ) {
      syncedRef.current = [...quickReplies];
      setDraft([...quickReplies]);
    }
  };
  const commitDirtyDraft = () => {
    if (sameQuickReplies(committedQuickReplies(draft), syncedRef.current)) {
      dirtyRef.current = false;
      reseedIfRemoteChanged();
      return;
    }
    if (commitDraft(draft)) dirtyRef.current = false;
  };
  const removeRow = (index: number) => {
    const next = draft.filter((_, rowIndex) => rowIndex !== index);
    if (commitDraft(next)) dirtyRef.current = false;
  };
  const reloadSavedReplies = () => {
    focusedRowCountRef.current = 0;
    dirtyRef.current = false;
    syncedRef.current = [...quickReplies];
    setDraft([...quickReplies]);
    setHasRemoteChangeConflict(false);
  };

  return (
    <SettingsWithControl
      label="Quick replies"
      description="Buttons above the composer when a thread is idle or errored. Press one to send it."
      controlPlacement="below"
    >
      <div className="space-y-2">
        {hasRemoteChangeConflict && (
          <div role="alert" className="flex items-center gap-2 text-sm">
            <span>{REMOTE_CHANGE_MESSAGE}</span>
            <Button variant="outline" size="sm" onClick={reloadSavedReplies}>
              Reload saved replies
            </Button>
          </div>
        )}
        {draft.map((row, index) => (
          <div key={index} className="flex items-start gap-2">
            <Textarea
              value={row}
              rows={1}
              maxLength={UI_PREFERENCE_STRING_MAX_LENGTH}
              aria-label={`Quick reply ${index + 1}`}
              className="min-h-8 field-sizing-content"
              onChange={(event) => {
                const next = [...draft];
                next[index] = event.target.value;
                dirtyRef.current = true;
                setDraft(next);
              }}
              onFocus={() => {
                focusedRowCountRef.current += 1;
              }}
              onBlur={() => {
                focusedRowCountRef.current -= 1;
                if (dirtyRef.current) commitDirtyDraft();
                else reseedIfRemoteChanged();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  if (dirtyRef.current) commitDirtyDraft();
                }
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground"
              aria-label="Remove quick reply"
              onClick={() => removeRow(index)}
            >
              <Icon name="X" className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={draft.length >= COMPOSER_QUICK_REPLIES_MAX_COUNT}
          onClick={() => setDraft([...draft, ""])}
        >
          Add
        </Button>
      </div>
    </SettingsWithControl>
  );
}
