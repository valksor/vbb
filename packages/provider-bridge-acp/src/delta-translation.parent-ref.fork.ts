import {
  THREAD_DELTA_KEY_SEPARATOR,
  type ThreadDelta,
} from "@bb/provider-bridge-protocol";
import { z } from "zod";

const claudeCodeParentMetaSchema = z.object({
  _meta: z.object({
    claudeCode: z
      .object({
        parentToolUseId: z
          .string()
          .min(1)
          .refine((value) => !value.includes(THREAD_DELTA_KEY_SEPARATOR), {
            message:
              "provider keys must not contain the internal key separator (\\u001f)",
          }),
      })
      .passthrough(),
  }),
});

export function claudeCodeParentToolUseId(source: unknown): string | undefined {
  const meta = claudeCodeParentMetaSchema.safeParse(source);
  return meta.success ? meta.data._meta.claudeCode.parentToolUseId : undefined;
}

export function parentRefField(parentRef: string | undefined): {
  parentRef?: string;
} {
  return parentRef === undefined ? {} : { parentRef };
}

export function withParent<Key extends object>(
  key: Key,
  parentRef: string | undefined,
): Key & { parentRef?: string } {
  return { ...key, ...parentRefField(parentRef) };
}

export function resolveParentRef(
  existing: { parentRef?: string } | undefined,
  updateParentRef: string | undefined,
  toolCallId: string,
): string | undefined {
  if (existing !== undefined) {
    return existing.parentRef;
  }
  return updateParentRef === toolCallId ? undefined : updateParentRef;
}

export function createParentedStreams(streamKeys: {
  thought: string;
  assistant: string;
}) {
  const parentedStreamRefs = new Map<string, Set<string>>();

  function closeThought(parentRef: string | undefined): ThreadDelta {
    return {
      kind: "item.textClose",
      key: withParent({ channel: streamKeys.thought }, parentRef),
      channel: "reasoningText",
    };
  }

  function closeAssistant(parentRef: string | undefined): ThreadDelta {
    return {
      kind: "item.textClose",
      key: withParent({ channel: streamKeys.assistant }, parentRef),
      channel: "agentMessage",
    };
  }

  return {
    closeThought,
    flush(parentRef: string | undefined): ThreadDelta[] {
      return [closeThought(parentRef), closeAssistant(parentRef)];
    },
    note(threadId: string, parentRef: string | undefined): void {
      if (parentRef === undefined) {
        return;
      }
      const refs = parentedStreamRefs.get(threadId) ?? new Set<string>();
      refs.add(parentRef);
      parentedStreamRefs.set(threadId, refs);
    },
    closeAll(threadId: string): ThreadDelta[] {
      const refs = parentedStreamRefs.get(threadId) ?? [];
      parentedStreamRefs.delete(threadId);
      return [...refs].flatMap((parentRef) => [
        closeThought(parentRef),
        closeAssistant(parentRef),
      ]);
    },
    closeFor(threadId: string, toolCallId: string): ThreadDelta[] {
      const refs = parentedStreamRefs.get(threadId);
      if (refs === undefined || !refs.delete(toolCallId)) {
        return [];
      }
      return [closeThought(toolCallId), closeAssistant(toolCallId)];
    },
    forget(threadId: string): void {
      parentedStreamRefs.delete(threadId);
    },
  };
}
