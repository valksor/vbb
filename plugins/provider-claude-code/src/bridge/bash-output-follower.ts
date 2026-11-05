import { lstatSync, readdirSync } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

const POLL_INTERVAL_MS = 500;
const MAX_READ_BYTES_PER_POLL = 64 * 1024;
const OUTPUT_FILE_RESOLVE_ATTEMPTS = 10;
const OUTPUT_FILE_RESOLVE_INTERVAL_MS = 500;
const OUTPUT_FILE_LATE_RESOLVE_INTERVAL_MS = 2_000;
const OUTPUT_FILE_RESOLVE_WINDOW_MS = 5 * 60 * 1000;

interface OutputFileResolution {
  timer: ReturnType<typeof setTimeout> | undefined;
  cancelled: boolean;
}

interface FollowedTask {
  taskId: string;
  sessionId: string;
  path: string | undefined;
  offset: number;
  decoder: StringDecoder;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export interface ClaudeBashOutputFollowerOptions {
  tempRoot: string;
  publish: (toolUseId: string, text: string) => void;
  pollIntervalMs?: number;
  resolveIntervalMs?: number;
  lateResolveIntervalMs?: number;
  resolveWindowMs?: number;
}

interface ClaudeTaskOutputFileLocation {
  tempRoot: string;
  sessionId: string;
  taskId: string;
}

export function claudeCodeTempRoot(env: NodeJS.ProcessEnv): string {
  return join(
    env.CLAUDE_CODE_TMPDIR || "/tmp",
    `claude-${process.getuid?.() ?? 0}`,
  );
}

async function findClaudeTaskOutputPath(
  location: ClaudeTaskOutputFileLocation,
): Promise<string | undefined> {
  const fileName = `${location.taskId}.output`;
  for (const projectDir of await readdir(location.tempRoot)) {
    const tasksDir = join(
      location.tempRoot,
      projectDir,
      location.sessionId,
      "tasks",
    );
    const entries = await readdir(tasksDir).catch((): string[] => []);
    if (entries.includes(fileName)) {
      return join(tasksDir, fileName);
    }
  }
  return undefined;
}

export async function locateClaudeTaskOutputFile(
  location: ClaudeTaskOutputFileLocation,
): Promise<string | undefined> {
  const path = await findClaudeTaskOutputPath(location);
  if (path === undefined) {
    return undefined;
  }
  const stats = await lstat(path);
  return stats.isFile() ? path : undefined;
}

export function locateClaudeTaskOutputFileSync(
  location: ClaudeTaskOutputFileLocation,
): string | undefined {
  try {
    const fileName = `${location.taskId}.output`;
    for (const projectDir of readdirSync(location.tempRoot)) {
      const tasksDir = join(
        location.tempRoot,
        projectDir,
        location.sessionId,
        "tasks",
      );
      let entries: string[];
      try {
        entries = readdirSync(tasksDir);
      } catch {
        continue;
      }
      if (entries.includes(fileName)) {
        const path = join(tasksDir, fileName);
        return lstatSync(path).isFile() ? path : undefined;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export class ClaudeBashOutputFollower {
  private readonly followed = new Map<string, FollowedTask>();
  private readonly resolutions = new Map<string, OutputFileResolution>();
  private readonly pollIntervalMs: number;
  private readonly resolveIntervalMs: number;
  private readonly lateResolveIntervalMs: number;
  private readonly resolveWindowMs: number;

  constructor(private readonly options: ClaudeBashOutputFollowerOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.resolveIntervalMs =
      options.resolveIntervalMs ?? OUTPUT_FILE_RESOLVE_INTERVAL_MS;
    this.lateResolveIntervalMs =
      options.lateResolveIntervalMs ?? OUTPUT_FILE_LATE_RESOLVE_INTERVAL_MS;
    this.resolveWindowMs =
      options.resolveWindowMs ?? OUTPUT_FILE_RESOLVE_WINDOW_MS;
  }

  follow(args: { toolUseId: string; taskId: string; sessionId: string }): void {
    if (this.followed.has(args.toolUseId)) {
      return;
    }
    const task: FollowedTask = {
      taskId: args.taskId,
      sessionId: args.sessionId,
      path: undefined,
      offset: 0,
      decoder: new StringDecoder("utf8"),
      timer: undefined,
    };
    this.followed.set(args.toolUseId, task);
    this.schedule(args.toolUseId, task);
  }

  stop(toolUseId: string): void {
    const task = this.followed.get(toolUseId);
    if (task === undefined) {
      return;
    }
    clearTimeout(task.timer);
    this.followed.delete(toolUseId);
  }

  stopTask(taskId: string): void {
    for (const [toolUseId, task] of this.followed) {
      if (task.taskId === taskId) {
        this.stop(toolUseId);
      }
    }
  }

  stopAll(): void {
    for (const toolUseId of [...this.followed.keys()]) {
      this.stop(toolUseId);
    }
    for (const taskId of this.resolutions.keys()) {
      this.cancelResolve(taskId);
    }
  }

  locateOutputFileSync(args: {
    taskId: string;
    sessionId: string;
  }): string | undefined {
    return locateClaudeTaskOutputFileSync({
      tempRoot: this.options.tempRoot,
      ...args,
    });
  }

  cancelResolve(taskId: string): void {
    const resolution = this.resolutions.get(taskId);
    if (resolution === undefined) {
      return;
    }
    resolution.cancelled = true;
    clearTimeout(resolution.timer);
    this.resolutions.delete(taskId);
  }

  resolveOutputFile(
    args: { taskId: string; sessionId: string },
    onResolved: (path: string) => void,
  ): void {
    this.cancelResolve(args.taskId);
    const resolution: OutputFileResolution = {
      timer: undefined,
      cancelled: false,
    };
    this.resolutions.set(args.taskId, resolution);
    const startedAt = Date.now();
    const finish = (): void => {
      if (this.resolutions.get(args.taskId) === resolution) {
        this.resolutions.delete(args.taskId);
      }
    };
    const attempt = async (attemptNumber: number): Promise<void> => {
      const path = await locateClaudeTaskOutputFile({
        tempRoot: this.options.tempRoot,
        ...args,
      }).catch((): undefined => undefined);
      if (resolution.cancelled) {
        return;
      }
      if (path !== undefined) {
        finish();
        onResolved(path);
        return;
      }
      const initialWindow = attemptNumber < OUTPUT_FILE_RESOLVE_ATTEMPTS;
      if (!initialWindow && Date.now() - startedAt >= this.resolveWindowMs) {
        finish();
        return;
      }
      resolution.timer = setTimeout(
        () => {
          void attempt(attemptNumber + 1);
        },
        initialWindow ? this.resolveIntervalMs : this.lateResolveIntervalMs,
      );
      resolution.timer.unref();
    };
    void attempt(1);
  }

  private schedule(toolUseId: string, task: FollowedTask): void {
    task.timer = setTimeout(() => {
      void this.poll(toolUseId, task);
    }, this.pollIntervalMs);
    task.timer.unref();
  }

  private isFollowing(toolUseId: string, task: FollowedTask): boolean {
    return this.followed.get(toolUseId) === task;
  }

  private async poll(toolUseId: string, task: FollowedTask): Promise<void> {
    try {
      task.path ??= await this.locate(task);
      const text =
        task.path === undefined ? "" : await this.readNew(task, task.path);
      if (text.length > 0 && this.isFollowing(toolUseId, task)) {
        this.options.publish(toolUseId, text);
      }
    } catch {
      task.path = undefined;
    }
    if (this.isFollowing(toolUseId, task)) {
      this.schedule(toolUseId, task);
    }
  }

  private locate(task: FollowedTask): Promise<string | undefined> {
    return findClaudeTaskOutputPath({
      tempRoot: this.options.tempRoot,
      sessionId: task.sessionId,
      taskId: task.taskId,
    });
  }

  private async readNew(task: FollowedTask, path: string): Promise<string> {
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(MAX_READ_BYTES_PER_POLL);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        MAX_READ_BYTES_PER_POLL,
        task.offset,
      );
      task.offset += bytesRead;
      return task.decoder.write(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }
}
