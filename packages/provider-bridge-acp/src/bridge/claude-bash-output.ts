import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { ThreadDelta } from "@bb/provider-bridge-protocol";
import { z } from "zod";
import { claudeCodeParentToolUseId } from "../delta-translation.parent-ref.fork.js";
import {
  acpToolCallUpdateEventSchema,
  type AcpToolCallUpdateEvent,
} from "../wire.js";

export const CLAUDE_AGENT_ACP_PACKAGE = "@agentclientprotocol/claude-agent-acp";

const POLL_INTERVAL_MS = 500;
const MAX_READ_BYTES_PER_POLL = 64 * 1024;
const BASH_TASK_FILE = /^b[0-9a-z]+\.output$/;
const BACKGROUND_TASK_ID =
  /(?:running in background with ID: |moved to the background \(ID: )(b[0-9a-z]+)/g;

const claudeCodeMetaSchema = z.object({
  _meta: z.object({
    claudeCode: z.object({ toolName: z.string() }).passthrough(),
  }),
});
const backgroundInputSchema = z.object({ run_in_background: z.literal(true) });

interface BashCall {
  parentRef: string | undefined;
  background: boolean;
  ambiguous: boolean;
  baseline: Promise<ReadonlySet<string> | undefined>;
  file: string | undefined;
  offset: number;
  decoder: StringDecoder;
}

export interface ClaudeAgentBashOutputOptions {
  tempRoot: string;
  sessionId: string;
  publish: (
    toolCallId: string,
    text: string,
    parentRef: string | undefined,
  ) => void;
  pollIntervalMs?: number;
}

export function claudeCodeTempRoot(env: NodeJS.ProcessEnv): string {
  return join(
    env.CLAUDE_CODE_TMPDIR || "/tmp",
    `claude-${process.getuid?.() ?? 0}`,
  );
}

function isBashCall(event: AcpToolCallUpdateEvent): boolean {
  if (event.name === "Bash") {
    return true;
  }
  const meta = claudeCodeMetaSchema.safeParse(event);
  return meta.success && meta.data._meta.claudeCode.toolName === "Bash";
}

function backgroundTaskFiles(event: AcpToolCallUpdateEvent): string[] {
  const text = JSON.stringify([event.content ?? null, event.rawOutput ?? null]);
  return [...text.matchAll(BACKGROUND_TASK_ID)].map(
    (match) => `${match[1]}.output`,
  );
}

export class ClaudeAgentBashOutputWatcher {
  private readonly calls = new Map<string, BashCall>();
  private readonly excluded = new Set<string>();
  private readonly claimed = new Set<string>();
  private tasksDir: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private polling = false;
  private disposed = false;
  private readonly pollIntervalMs: number;

  constructor(private readonly options: ClaudeAgentBashOutputOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  }

  observe(event: AcpToolCallUpdateEvent): void {
    if (this.disposed) {
      return;
    }
    let call = this.calls.get(event.toolCallId);
    if (call === undefined) {
      if (event.sessionUpdate !== "tool_call" || !isBashCall(event)) {
        return;
      }
      let othersUnmatched = false;
      for (const other of this.calls.values()) {
        if (other.file === undefined) {
          other.ambiguous = true;
          othersUnmatched = true;
        }
      }
      call = {
        parentRef: claudeCodeParentToolUseId(event),
        background: false,
        ambiguous: othersUnmatched,
        baseline: this.listTaskFiles().catch(() => undefined),
        file: undefined,
        offset: 0,
        decoder: new StringDecoder("utf8"),
      };
      this.calls.set(event.toolCallId, call);
    }
    if (backgroundInputSchema.safeParse(event.rawInput).success) {
      call.background = true;
    }
    if (
      event.status === "completed" ||
      event.status === "failed" ||
      event.status === "cancelled"
    ) {
      for (const file of backgroundTaskFiles(event)) {
        this.excluded.add(file);
      }
      this.calls.delete(event.toolCallId);
      return;
    }
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.calls.clear();
  }

  private schedule(): void {
    if (this.timer !== undefined || this.polling || this.disposed) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.poll();
    }, this.pollIntervalMs);
    this.timer.unref();
  }

  private async poll(): Promise<void> {
    this.polling = true;
    try {
      const current = await this.listTaskFiles();
      for (const [toolCallId, call] of this.calls) {
        if (call.background || call.ambiguous) {
          continue;
        }
        call.file ??= await this.claimNewFile(call, current);
        if (call.file === undefined || this.tasksDir === undefined) {
          continue;
        }
        const text = await this.readNew(call, join(this.tasksDir, call.file));
        if (text.length > 0 && this.calls.get(toolCallId) === call) {
          this.options.publish(toolCallId, text, call.parentRef);
        }
      }
    } catch {
      this.tasksDir = undefined;
    } finally {
      this.polling = false;
    }
    if (this.calls.size > 0) {
      this.schedule();
    }
  }

  private async claimNewFile(
    call: BashCall,
    current: ReadonlySet<string>,
  ): Promise<string | undefined> {
    const baseline = await call.baseline;
    if (baseline === undefined) {
      call.ambiguous = true;
      return undefined;
    }
    const fresh = [...current].filter(
      (file) =>
        !baseline.has(file) &&
        !this.excluded.has(file) &&
        !this.claimed.has(file),
    );
    if (fresh.length > 1) {
      call.ambiguous = true;
      return undefined;
    }
    const file = fresh[0];
    if (file !== undefined) {
      this.claimed.add(file);
    }
    return file;
  }

  private async listTaskFiles(): Promise<ReadonlySet<string>> {
    this.tasksDir ??= await this.locateTasksDir();
    if (this.tasksDir === undefined) {
      return new Set();
    }
    const entries = await readdir(this.tasksDir, { withFileTypes: true });
    return new Set(
      entries
        .filter((entry) => entry.isFile() && BASH_TASK_FILE.test(entry.name))
        .map((entry) => entry.name),
    );
  }

  private async locateTasksDir(): Promise<string | undefined> {
    const { sessionId } = this.options;
    const projectDirs = await readdir(this.options.tempRoot).catch(
      (): string[] => [],
    );
    for (const projectDir of projectDirs) {
      const tasksDir = join(
        this.options.tempRoot,
        projectDir,
        sessionId,
        "tasks",
      );
      const found = await readdir(tasksDir).then(
        () => true,
        () => false,
      );
      if (found) {
        return tasksDir;
      }
    }
    return undefined;
  }

  private async readNew(call: BashCall, path: string): Promise<string> {
    const handle = await open(path, "r").catch(() => undefined);
    if (handle === undefined) {
      return "";
    }
    try {
      const buffer = Buffer.alloc(MAX_READ_BYTES_PER_POLL);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        MAX_READ_BYTES_PER_POLL,
        call.offset,
      );
      call.offset += bytesRead;
      return call.decoder.write(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }
}

export function attachClaudeBashOutput(args: {
  agentName: string | undefined;
  childEnv: NodeJS.ProcessEnv;
  sessionId: string;
  publish: (deltas: ThreadDelta[]) => void;
}): ClaudeAgentBashOutputWatcher | undefined {
  if (args.agentName !== CLAUDE_AGENT_ACP_PACKAGE) {
    return undefined;
  }
  return new ClaudeAgentBashOutputWatcher({
    tempRoot: claudeCodeTempRoot(args.childEnv),
    sessionId: args.sessionId,
    publish: (toolCallId, text, parentRef) =>
      args.publish([
        {
          kind: "item.outputDelta",
          key: {
            providerItemId: toolCallId,
            ...(parentRef === undefined ? {} : { parentRef }),
          },
          channel: "command",
          text,
        },
      ]),
  });
}

export function observeClaudeBashOutput(
  watcher: ClaudeAgentBashOutputWatcher | undefined,
  update: unknown,
): void {
  if (watcher === undefined) {
    return;
  }
  const toolCall = acpToolCallUpdateEventSchema.safeParse(update);
  if (toolCall.success) {
    watcher.observe(toolCall.data);
  }
}
