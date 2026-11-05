import { lstatSync, readdirSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT_FILE_RESOLVE_ATTEMPTS = 10;
const OUTPUT_FILE_RESOLVE_INTERVAL_MS = 500;
const OUTPUT_FILE_LATE_RESOLVE_INTERVAL_MS = 2_000;
const OUTPUT_FILE_RESOLVE_WINDOW_MS = 5 * 60 * 1000;

interface OutputFileResolution {
  timer: ReturnType<typeof setTimeout> | undefined;
  cancelled: boolean;
}

export interface ClaudeBashOutputFollowerOptions {
  tempRoot: string;
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
  private readonly resolutions = new Map<string, OutputFileResolution>();
  private readonly resolveIntervalMs: number;
  private readonly lateResolveIntervalMs: number;
  private readonly resolveWindowMs: number;

  constructor(private readonly options: ClaudeBashOutputFollowerOptions) {
    this.resolveIntervalMs =
      options.resolveIntervalMs ?? OUTPUT_FILE_RESOLVE_INTERVAL_MS;
    this.lateResolveIntervalMs =
      options.lateResolveIntervalMs ?? OUTPUT_FILE_LATE_RESOLVE_INTERVAL_MS;
    this.resolveWindowMs =
      options.resolveWindowMs ?? OUTPUT_FILE_RESOLVE_WINDOW_MS;
  }

  stopAll(): void {
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
}
