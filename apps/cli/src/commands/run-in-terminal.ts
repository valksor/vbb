import { open, type FileHandle } from "node:fs/promises";
import {
  createHostDaemonLocalClient,
  DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST,
  DEFAULT_HOST_DAEMON_LOCAL_HEALTH_PATH,
  DEFAULT_HOST_DAEMON_LOCAL_HEALTH_VALUE,
  OPEN_IN_TARGET_COMMAND_MAX_LENGTH,
  OPEN_IN_TARGET_RUN_COMMAND_DISABLED_ERROR_CODE,
  workspaceOpenTargetsResponseSchema,
  type OpenInTargetCommandLanguage,
  type OpenInTargetRequest,
  type WorkspaceOpenTarget,
} from "@bb/host-daemon-contract/local";
import { Option, type Command } from "commander";
import { z } from "zod";
import { action, CliExitError } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { getErrorMessage } from "./helpers.js";

const RUN_IN_TERMINAL_LANGUAGES = ["sh", "bash", "zsh", "shell"] as const;

const OPEN_IN_TARGET_COMMAND_MAX_UTF8_BYTES =
  OPEN_IN_TARGET_COMMAND_MAX_LENGTH * 3;

const DAEMON_UNREACHABLE_HINT =
  "Start bb, or set BB_HOST_DAEMON_PORT to the running daemon's port.";

const RUN_IN_TERMINAL_SAFETY_HELP = [
  "The command executes in your terminal application with that terminal's system",
  "permissions, including its macOS TCC grants. Shell history records the",
  "wrapper command with the working directory and the temporary script path.",
].join("\n");

const openInTargetErrorResponseSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export type RunInTerminalDaemonClient = {
  [DEFAULT_HOST_DAEMON_LOCAL_HEALTH_PATH]: { $get(): Promise<Response> };
  "/workspace-open-targets": { $get(): Promise<Response> };
  "/open-in-target": {
    $post(args: { json: OpenInTargetRequest }): Promise<Response>;
  };
};

export type CreateRunInTerminalDaemonClient = (
  port: number,
) => RunInTerminalDaemonClient;

export interface RunInTerminalInvocation {
  commandSource: string;
  cwd: string;
  language: OpenInTargetCommandLanguage;
  serverUrl: string;
  targetId?: string;
}

export interface RunInTerminalDeps {
  createDaemonClient: CreateRunInTerminalDaemonClient;
  env: NodeJS.ProcessEnv;
  fetchLocalHelperPorts: (serverUrl: string) => Promise<readonly number[]>;
  stdin: NodeJS.ReadableStream;
}

interface RunInTerminalOptions {
  cwd?: string;
  language?: OpenInTargetCommandLanguage;
  target?: string;
}

export function registerRunInTerminalCommand(
  program: Command,
  getUrl: () => string,
): void {
  program
    .command("run-in-terminal <command-file>")
    .description("Run a shell command in a terminal on this machine")
    .option(
      "--cwd <dir>",
      "Working directory for the command (default: current directory)",
    )
    .addOption(
      new Option("--language <language>", "Shell language of the command")
        .choices([...RUN_IN_TERMINAL_LANGUAGES])
        .default("sh"),
    )
    .option(
      "--target <targetId>",
      "Terminal target ID (default: the first target that can run commands)",
    )
    .addHelpText("after", RUN_IN_TERMINAL_SAFETY_HELP)
    .action(
      action(async (commandFile: string, opts: RunInTerminalOptions) => {
        const target = await runCommandInTerminal(
          {
            commandSource: commandFile,
            cwd: opts.cwd ?? process.cwd(),
            language: opts.language ?? "sh",
            serverUrl: getUrl(),
            targetId: opts.target,
          },
          {
            createDaemonClient: createDefaultDaemonClient,
            env: process.env,
            fetchLocalHelperPorts,
            stdin: process.stdin,
          },
        );
        console.log(`Command sent to ${target.label} (${target.id})`);
      }),
    );
}

export async function runCommandInTerminal(
  invocation: RunInTerminalInvocation,
  deps: RunInTerminalDeps,
): Promise<WorkspaceOpenTarget> {
  const command = validateRunCommandText(
    await readRunCommandText(invocation.commandSource, deps.stdin),
  );
  const client = await resolveRunInTerminalDaemonClient(invocation, deps);
  const target = await resolveRunTarget(
    await fetchWorkspaceOpenTargets(client),
    invocation.targetId,
  );
  const res = await client["/open-in-target"].$post({
    json: {
      context: { kind: "local" },
      lineNumber: null,
      columnNumber: null,
      path: invocation.cwd,
      targetId: target.id,
      command,
      language: invocation.language,
    },
  });
  if (!res.ok) {
    throw await openInTargetFailure(res);
  }
  return target;
}

export async function readRunCommandText(
  source: string,
  stdin: NodeJS.ReadableStream = process.stdin,
): Promise<string> {
  if (source === "-") {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let bytesRead = 0;
      stdin.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        bytesRead += chunk.length;
        if (bytesRead > OPEN_IN_TARGET_COMMAND_MAX_UTF8_BYTES) {
          stdin.pause();
          reject(runCommandTextTooLongError());
        }
      });
      stdin.on("error", reject);
      stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  }
  let handle: FileHandle;
  try {
    handle = await open(source, "r");
  } catch (error) {
    throw new CliExitError(
      `Could not read the command file: ${getErrorMessage(error)}`,
      1,
      { code: "command_file_unreadable", hint: null },
    );
  }
  try {
    const buffer = Buffer.alloc(OPEN_IN_TARGET_COMMAND_MAX_UTF8_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > OPEN_IN_TARGET_COMMAND_MAX_UTF8_BYTES) {
      throw runCommandTextTooLongError();
    }
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function resolveRunInTerminalDaemonClient(
  invocation: RunInTerminalInvocation,
  deps: RunInTerminalDeps,
): Promise<RunInTerminalDaemonClient> {
  const ports = await resolveDaemonPorts(invocation, deps);
  if (ports.length === 0) {
    throw new CliExitError(
      `The bb server at ${invocation.serverUrl} reported no local daemon ports`,
      1,
      { code: "daemon_unreachable", hint: DAEMON_UNREACHABLE_HINT },
    );
  }
  const tried: number[] = [];
  for (const port of ports) {
    const client = deps.createDaemonClient(port);
    tried.push(port);
    if (await isDaemonAlive(client)) {
      return client;
    }
  }
  throw new CliExitError(
    `Could not reach the bb host daemon on this machine (tried ports ${tried.join(", ")})`,
    1,
    { code: "daemon_unreachable", hint: DAEMON_UNREACHABLE_HINT },
  );
}

async function resolveDaemonPorts(
  invocation: RunInTerminalInvocation,
  deps: RunInTerminalDeps,
): Promise<readonly number[]> {
  const configuredPort = resolveConfiguredHostDaemonPort(deps.env);
  if (configuredPort !== null) {
    return [configuredPort];
  }
  try {
    return await deps.fetchLocalHelperPorts(invocation.serverUrl);
  } catch (error) {
    throw new CliExitError(
      `Could not discover the local daemon port from the bb server at ${invocation.serverUrl}: ${getErrorMessage(error)}`,
      1,
      { code: "daemon_unreachable", hint: DAEMON_UNREACHABLE_HINT },
    );
  }
}

function resolveConfiguredHostDaemonPort(env: NodeJS.ProcessEnv): number | null {
  const raw = env["BB_HOST_DAEMON_PORT"];
  if (raw === undefined || raw === "") {
    return null;
  }
  const port = Number.parseInt(raw, 10);
  if (
    !Number.isFinite(port) ||
    String(port) !== raw ||
    port < 1 ||
    port > 65_535
  ) {
    throw new CliExitError(`Invalid BB_HOST_DAEMON_PORT value: "${raw}"`, 1, {
      code: "invalid_value",
      hint: null,
    });
  }
  return port;
}

async function isDaemonAlive(
  client: RunInTerminalDaemonClient,
): Promise<boolean> {
  try {
    const res = await client[DEFAULT_HOST_DAEMON_LOCAL_HEALTH_PATH].$get();
    return (
      res.ok && (await res.text()) === DEFAULT_HOST_DAEMON_LOCAL_HEALTH_VALUE
    );
  } catch {
    return false;
  }
}

async function fetchWorkspaceOpenTargets(
  client: RunInTerminalDaemonClient,
): Promise<WorkspaceOpenTarget[]> {
  const res = await client["/workspace-open-targets"].$get();
  if (!res.ok) {
    throw new CliExitError(
      `Workspace open target discovery failed: HTTP ${res.status}`,
      1,
      { code: "target_discovery_failed", hint: null },
    );
  }
  return workspaceOpenTargetsResponseSchema.parse(await res.json()).targets;
}

function resolveRunTarget(
  targets: readonly WorkspaceOpenTarget[],
  targetId: string | undefined,
): WorkspaceOpenTarget {
  if (targetId !== undefined) {
    const target = targets.find((candidate) => candidate.id === targetId);
    if (target === undefined) {
      throw new CliExitError(`Unknown open target: "${targetId}"`, 1, {
        code: "unknown_target",
        hint: runTargetHint(targets),
      });
    }
    if (target.capabilities.runCommand !== true) {
      throw new CliExitError(
        `Open target "${targetId}" cannot run commands`,
        1,
        { code: "no_run_command_target", hint: runTargetHint(targets) },
      );
    }
    return target;
  }
  const target = targets.find(
    (candidate) => candidate.capabilities.runCommand === true,
  );
  if (target === undefined) {
    throw new CliExitError(
      "No open target on this machine can run commands",
      1,
      { code: "no_run_command_target", hint: runTargetHint(targets) },
    );
  }
  return target;
}

function runTargetHint(targets: readonly WorkspaceOpenTarget[]): string {
  const runCapableIds = targets
    .filter((target) => target.capabilities.runCommand === true)
    .map((target) => target.id);
  if (runCapableIds.length === 0) {
    return "Run-capable targets appear when the daemon enables runCommandEnabled (`npx bb-app client run-command on`) and a supported terminal is installed.";
  }
  return `Open targets that can run commands: ${runCapableIds.join(", ")}.`;
}

async function openInTargetFailure(res: Response): Promise<CliExitError> {
  const text = await res.text().catch(() => "");
  const parsed = openInTargetErrorResponseSchema.safeParse(
    parseJsonBody(text),
  );
  if (
    parsed.success &&
    parsed.data.code === OPEN_IN_TARGET_RUN_COMMAND_DISABLED_ERROR_CODE
  ) {
    return new CliExitError(parsed.data.message, 1, {
      code: OPEN_IN_TARGET_RUN_COMMAND_DISABLED_ERROR_CODE,
      hint: "Enable it with `npx bb-app client run-command on`.",
    });
  }
  if (parsed.success) {
    return new CliExitError(parsed.data.message, 1, {
      code: parsed.data.code,
      hint: null,
    });
  }
  const detail = text.trim() === "" ? `HTTP ${res.status}` : text.trim();
  return new CliExitError(`Failed to run command in terminal: ${detail}`, 1, {
    code: `http_${res.status}`,
    hint: null,
  });
}

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function runCommandTextTooLongError(): CliExitError {
  return new CliExitError(
    `The command text exceeds the maximum of ${OPEN_IN_TARGET_COMMAND_MAX_LENGTH} characters`,
    1,
    { code: "invalid_value", hint: null },
  );
}

function validateRunCommandText(command: string): string {
  if (command.trim().length === 0) {
    throw new CliExitError("The command text is empty", 1, {
      code: "invalid_value",
      hint: null,
    });
  }
  if (command.length > OPEN_IN_TARGET_COMMAND_MAX_LENGTH) {
    throw runCommandTextTooLongError();
  }
  return command;
}

function createDefaultDaemonClient(port: number): RunInTerminalDaemonClient {
  const client = createHostDaemonLocalClient(
    `http://${DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST}:${port}`,
  );
  return {
    [DEFAULT_HOST_DAEMON_LOCAL_HEALTH_PATH]: {
      $get: () => client.health.$get(),
    },
    "/workspace-open-targets": {
      $get: () => client["workspace-open-targets"].$get(),
    },
    "/open-in-target": {
      $post: (args) => client["open-in-target"].$post(args),
    },
  };
}

async function fetchLocalHelperPorts(
  serverUrl: string,
): Promise<readonly number[]> {
  const config = await createCliBbSdk(serverUrl).system.config();
  return config.localHelperPorts;
}
