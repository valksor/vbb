import { Buffer } from "node:buffer";
import path from "node:path";
import { z } from "zod";
import {
  getEnvironment,
  getHost,
  getThread,
  listLatestBackgroundTaskStateRowsByItemIds,
} from "@bb/db";
import {
  isSettledBackgroundTaskStatus,
  threadEventBackgroundTaskItemSchema,
  type ThreadEventBackgroundTaskItem,
} from "@bb/domain";
import type { HostDaemonOnlineRpcResultByType } from "@bb/host-daemon-contract";
import type { BackgroundTaskOutputResponse } from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { AppDeps, WorkSessionDeps } from "../../types.js";
import {
  callHostRetryableOnlineRpc,
  isHostUnavailableApiError,
} from "../hosts/online-rpc.js";

const LOCAL_BASH_TASK_TYPE = "local_bash";
const FILE_CHANGED_ATTEMPTS = 5;
const FILE_CHANGED_BACKOFF_MIN_MS = 25;
const FILE_CHANGED_BACKOFF_JITTER_MS = 75;
const DAEMON_ERROR_STATUS = 502;
const CLAUDE_TEMP_ROOT_SEGMENT = /^claude-\d+$/;
const TRUNCATED_HEAD_NEWLINE_SCAN_BYTES = 1024;
const NEWLINE_BYTE = 0x0a;

type FileChunk = HostDaemonOnlineRpcResultByType["host.read_file_chunk"];

export interface BackgroundTaskOutputChunkRequest {
  path: string;
  rootPath: string;
  offset: number;
  length: number;
}

export type ReadBackgroundTaskOutputChunk = (
  request: BackgroundTaskOutputChunkRequest,
) => Promise<FileChunk>;

interface ReadBackgroundTaskOutputArgs {
  threadId: string;
  itemId: string;
  tailBytes: number;
  readChunk: ReadBackgroundTaskOutputChunk;
  sleep?: (ms: number) => Promise<void>;
}

interface BackgroundTaskOutputTarget {
  outputFile: string;
  terminal: boolean;
}

const storedBackgroundTaskEventDataSchema = z.object({
  item: threadEventBackgroundTaskItemSchema,
});

const UNAVAILABLE: BackgroundTaskOutputResponse = {
  state: "unavailable",
  text: "",
  truncated: false,
  totalBytes: 0,
};

const PENDING: BackgroundTaskOutputResponse = {
  state: "pending",
  text: "",
  truncated: false,
  totalBytes: 0,
};

const BUSY: BackgroundTaskOutputResponse = {
  state: "busy",
  text: "",
  truncated: false,
  totalBytes: 0,
};

export function createHostBackgroundTaskOutputReader(
  deps: WorkSessionDeps,
  hostId: string,
): ReadBackgroundTaskOutputChunk {
  return (request) =>
    callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.read_file_chunk",
        path: request.path,
        rootPath: request.rootPath,
        offset: request.offset,
        length: request.length,
        revision: null,
      },
    });
}

function parseStoredBackgroundTaskItem(
  data: string,
): ThreadEventBackgroundTaskItem | null {
  try {
    const parsed = storedBackgroundTaskEventDataSchema.safeParse(
      JSON.parse(data),
    );
    return parsed.success ? parsed.data.item : null;
  } catch {
    return null;
  }
}

function outputPathSegments(outputFile: string): string[] | null {
  if (path.posix.isAbsolute(outputFile)) {
    return outputFile.split("/");
  }
  return path.win32.isAbsolute(outputFile) ? outputFile.split(/[\\/]/) : null;
}

function isTaskOutputFilePath(outputFile: string, familyId: string): boolean {
  const segments = outputPathSegments(outputFile);
  if (segments === null || segments.includes("..")) {
    return false;
  }
  if (!segments.some((segment) => CLAUDE_TEMP_ROOT_SEGMENT.test(segment))) {
    return false;
  }
  return (
    segments.at(-1) === `${familyId}.output` && segments.at(-2) === "tasks"
  );
}

function outputRootPath(outputFile: string): string {
  return path.posix.isAbsolute(outputFile)
    ? path.posix.dirname(outputFile)
    : path.win32.dirname(outputFile);
}

function resolveOutputTarget(
  deps: Pick<AppDeps, "db">,
  args: Pick<ReadBackgroundTaskOutputArgs, "threadId" | "itemId">,
): BackgroundTaskOutputTarget | null {
  const [row] = listLatestBackgroundTaskStateRowsByItemIds(deps.db, {
    threadId: args.threadId,
    itemIds: [args.itemId],
  });
  if (row === undefined) {
    return null;
  }
  const item = parseStoredBackgroundTaskItem(row.data);
  if (
    item === null ||
    item.taskType !== LOCAL_BASH_TASK_TYPE ||
    item.familyId === undefined ||
    item.outputFile === undefined ||
    !isTaskOutputFilePath(item.outputFile, item.familyId)
  ) {
    return null;
  }
  return {
    outputFile: item.outputFile,
    terminal: isSettledBackgroundTaskStatus(item.taskStatus),
  };
}

function decodeTail(chunk: FileChunk, truncated: boolean): { text: string } {
  let bytes = Buffer.from(chunk.content, "base64");
  if (truncated) {
    const startsOnLine = bytes[0] === NEWLINE_BYTE;
    bytes = bytes.subarray(1);
    if (!startsOnLine) {
      const newline = bytes
        .subarray(0, TRUNCATED_HEAD_NEWLINE_SCAN_BYTES)
        .indexOf(NEWLINE_BYTE);
      if (newline >= 0) {
        bytes = bytes.subarray(newline + 1);
      }
    }
  }
  return { text: new TextDecoder("utf-8").decode(bytes, { stream: true }) };
}

function backoffDelayMs(): number {
  return (
    FILE_CHANGED_BACKOFF_MIN_MS +
    Math.floor(Math.random() * FILE_CHANGED_BACKOFF_JITTER_MS)
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readTail(
  args: ReadBackgroundTaskOutputArgs,
  target: BackgroundTaskOutputTarget,
): Promise<BackgroundTaskOutputResponse> {
  const rootPath = outputRootPath(target.outputFile);
  const sleep = args.sleep ?? defaultSleep;
  let sizeBytes: number | null = null;
  for (let attempt = 0; attempt < FILE_CHANGED_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(backoffDelayMs());
    }
    try {
      if (sizeBytes === null) {
        const head = await args.readChunk({
          path: target.outputFile,
          rootPath,
          offset: 0,
          length: 0,
        });
        sizeBytes = head.sizeBytes;
      }
      if (sizeBytes === 0) {
        return {
          state: "available",
          text: "",
          truncated: false,
          totalBytes: 0,
        };
      }
      const start = Math.max(0, sizeBytes - args.tailBytes);
      const truncated = start > 0;
      const readStart = truncated ? start - 1 : 0;
      const tail = await args.readChunk({
        path: target.outputFile,
        rootPath,
        offset: readStart,
        length: sizeBytes - readStart,
      });
      if (tail.sizeBytes < sizeBytes) {
        sizeBytes = null;
        continue;
      }
      return {
        state: "available",
        text: decodeTail(tail, truncated).text,
        truncated,
        totalBytes: tail.sizeBytes,
      };
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      if (error.body.code === "file_changed") {
        continue;
      }
      if (error.body.code === "ENOENT") {
        return target.terminal ? UNAVAILABLE : PENDING;
      }
      if (
        error.status === DAEMON_ERROR_STATUS &&
        !isHostUnavailableApiError(error)
      ) {
        return UNAVAILABLE;
      }
      throw error;
    }
  }
  return BUSY;
}

export async function readBackgroundTaskOutput(
  deps: Pick<AppDeps, "db">,
  args: ReadBackgroundTaskOutputArgs,
): Promise<BackgroundTaskOutputResponse> {
  const target = resolveOutputTarget(deps, args);
  return target === null ? UNAVAILABLE : readTail(args, target);
}

export async function readThreadBackgroundTaskOutput(
  deps: WorkSessionDeps,
  args: Omit<ReadBackgroundTaskOutputArgs, "readChunk">,
): Promise<BackgroundTaskOutputResponse> {
  const target = resolveOutputTarget(deps, args);
  if (target === null) {
    return UNAVAILABLE;
  }
  const hostId = resolveThreadHostId(deps, args.threadId);
  if (hostId === null) {
    return UNAVAILABLE;
  }
  return readTail(
    { ...args, readChunk: createHostBackgroundTaskOutputReader(deps, hostId) },
    target,
  );
}

function resolveThreadHostId(
  deps: Pick<AppDeps, "db">,
  threadId: string,
): string | null {
  const environmentId = getThread(deps.db, threadId)?.environmentId;
  if (!environmentId) {
    return null;
  }
  const environment = getEnvironment(deps.db, environmentId);
  if (environment === null || getHost(deps.db, environment.hostId) === null) {
    return null;
  }
  return environment.hostId;
}
