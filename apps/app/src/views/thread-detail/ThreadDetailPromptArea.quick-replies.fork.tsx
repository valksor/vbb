import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import type { ThreadRuntimeDisplayStatus } from "@bb/domain";
import {
  buildAutoFollowUpRequest,
  type FollowUpExecutionSelection,
  type FollowUpSubmitMode,
} from "@bb/client-core";
import { ThreadQuickRepliesCard } from "@/components/promptbox/banner/ThreadQuickRepliesCard";
import { quickRepliesAtom } from "@/components/promptbox/banner/quick-replies-preference";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import type { SendMessageMutationLike } from "./threadDetailMutationTypes";

interface UseQuickRepliesCardArgs {
  compactFirst: boolean;
  environmentId: string | null;
  focusBottomPluginComposer: () => void;
  followUpExecutionSelection: FollowUpExecutionSelection;
  isFollowUpSubmitting: boolean;
  isHandoffSelection: boolean;
  isQueueMutationPending: boolean;
  queuedMessageCount: number;
  queuedMessagesLength: number;
  runtimeDisplayStatus: ThreadRuntimeDisplayStatus;
  sendMessage: SendMessageMutationLike;
  sentMessageEditIsUndefined: boolean;
  setFullHistoryThreadId: (threadId: string | null) => void;
  shouldHideComposer: boolean;
  submitMode: FollowUpSubmitMode;
  threadId: string;
}

export function useQuickRepliesCard({
  compactFirst,
  environmentId,
  focusBottomPluginComposer,
  followUpExecutionSelection,
  isFollowUpSubmitting,
  isHandoffSelection,
  isQueueMutationPending,
  queuedMessageCount,
  queuedMessagesLength,
  runtimeDisplayStatus,
  sendMessage,
  sentMessageEditIsUndefined,
  setFullHistoryThreadId,
  shouldHideComposer,
  submitMode,
  threadId,
}: UseQuickRepliesCardArgs): ReactNode {
  const quickReplies = useAtomValue(quickRepliesAtom);
  const showQuickRepliesCard =
    quickReplies.length > 0 &&
    (runtimeDisplayStatus === "idle" || runtimeDisplayStatus === "error") &&
    environmentId !== null &&
    !shouldHideComposer &&
    !isHandoffSelection &&
    sentMessageEditIsUndefined &&
    submitMode.kind === "ready" &&
    !isFollowUpSubmitting &&
    !isQueueMutationPending &&
    queuedMessageCount === 0 &&
    queuedMessagesLength === 0;
  const quickReplyInFlightRef = useRef(false);
  const handleQuickReply = useCallback(
    async (text: string) => {
      const request = buildAutoFollowUpRequest({
        compactFirst,
        threadId,
        input: [{ type: "text", text, mentions: [] }],
        execution: followUpExecutionSelection,
      });
      if (!request || quickReplyInFlightRef.current) return;
      quickReplyInFlightRef.current = true;
      try {
        focusBottomPluginComposer();
        await sendMessage.mutateAsync(request);
        setFullHistoryThreadId(null);
      } catch (nextError) {
        showMutationErrorToast({
          error: nextError,
          fallbackMessage: "Failed to send message",
          lifecycleOperation: "send_message",
        });
      } finally {
        quickReplyInFlightRef.current = false;
      }
    },
    [
      compactFirst,
      focusBottomPluginComposer,
      followUpExecutionSelection,
      sendMessage,
      setFullHistoryThreadId,
      threadId,
    ],
  );
  return useMemo(
    () =>
      showQuickRepliesCard ? (
        <ThreadQuickRepliesCard
          messages={quickReplies}
          onSend={handleQuickReply}
        />
      ) : null,
    [handleQuickReply, quickReplies, showQuickRepliesCard],
  );
}
