import { useQuery } from "@tanstack/react-query";
import type { BackgroundTaskOutputResponse } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";

const THREAD_BACKGROUND_TASK_OUTPUT_QUERY_KEY = "threadBackgroundTaskOutput";

type ThreadBackgroundTaskOutputQueryKey = readonly [
  typeof THREAD_BACKGROUND_TASK_OUTPUT_QUERY_KEY,
  string,
  string,
];

export function threadBackgroundTaskOutputQueryKey(
  threadId: string,
  itemId: string,
): ThreadBackgroundTaskOutputQueryKey {
  return [THREAD_BACKGROUND_TASK_OUTPUT_QUERY_KEY, threadId, itemId];
}

export interface ThreadBackgroundTaskOutputIdentity {
  threadId: string;
  itemId: string;
}

export interface ThreadBackgroundTaskOutputOptions {
  enabled: boolean;
  pollIntervalMs: number | false;
  settled: boolean;
}

export function useThreadBackgroundTaskOutput(
  identity: ThreadBackgroundTaskOutputIdentity,
  options: ThreadBackgroundTaskOutputOptions,
) {
  return useQuery<BackgroundTaskOutputResponse>({
    queryKey: threadBackgroundTaskOutputQueryKey(
      identity.threadId,
      identity.itemId,
    ),
    queryFn: ({ signal }) =>
      sdk.threads.experimental_backgroundTaskOutput({
        threadId: identity.threadId,
        itemId: identity.itemId,
        signal,
      }),
    enabled: options.enabled,
    refetchInterval: (query) =>
      query.state.data?.state === "unavailable"
        ? false
        : options.pollIntervalMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: options.settled ? Infinity : 0,
    retry: false,
    meta: {
      errorMessage: "Failed to load background command output.",
      showErrorToast: false,
    },
  });
}
