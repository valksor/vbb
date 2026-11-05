import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  OpenInTargetCommandLanguage,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { WorkspaceOpenTargetError } from "./errors.js";
import {
  execInvocation,
  getTerminalExecutable,
  isMacTargetAvailable,
  requireLaunchAdapter,
  requireOpenablePath,
} from "./index.js";
import { escapeAppleScriptString, quoteShellArg } from "./terminal.js";
import type {
  ExecFileInvocation,
  OpenPathInTargetArgs,
  WorkspaceOpenTargetRuntime,
} from "./types.js";

export const TERMINAL_RUN_COMMAND_TEMP_DIR_PREFIX = "bb-run-";
const TERMINAL_RUN_COMMAND_SCRIPT_FILE_NAME = "command.sh";
const TERMINAL_RUN_COMMAND_PATH_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f]/u;

export interface OpenPathInTargetWithRuntimeOptions {
  interpreterPathExists?: (executable: string) => boolean;
}

const TERMINAL_RUN_COMMAND_CD_FAILURE_NOTICE = "bb: cd failed; command not run";
const TERMINAL_RUN_COMMAND_INTERPRETER_FALLBACK_NOTICE =
  "bb: preferred interpreter unavailable, using fallback";

const TERMINAL_RUN_COMMAND_LANGUAGE_INTERPRETERS: Record<
  OpenInTargetCommandLanguage,
  string
> = {
  bash: "/bin/bash",
  sh: "/bin/sh",
  shell: "/bin/sh",
  zsh: "/bin/zsh",
};

export interface TerminalRunCommandInterpreter {
  executable: string;
  fallbackNotice: boolean;
}

export function resolveTerminalRunCommandInterpreter(
  language: OpenInTargetCommandLanguage | undefined,
  pathExists: (executable: string) => boolean,
): TerminalRunCommandInterpreter {
  const preferred =
    TERMINAL_RUN_COMMAND_LANGUAGE_INTERPRETERS[language ?? "sh"];
  if (preferred === "/bin/sh" || pathExists(preferred)) {
    return { executable: preferred, fallbackNotice: false };
  }
  return { executable: "/bin/sh", fallbackNotice: true };
}

export interface TerminalRunCommandScriptPaths {
  scriptDir: string;
  scriptPath: string;
}

export interface BuildTerminalRunCommandWrapperArgs extends TerminalRunCommandScriptPaths {
  cwd: string;
  interpreter: TerminalRunCommandInterpreter;
}

export function buildTerminalRunCommandWrapper(
  args: BuildTerminalRunCommandWrapperArgs,
): string {
  const runSegments = [
    ...(args.interpreter.fallbackNotice
      ? [
          `printf '%s\\n' ${quoteShellArg(TERMINAL_RUN_COMMAND_INTERPRETER_FALLBACK_NOTICE)}`,
        ]
      : []),
    `${args.interpreter.executable} ${quoteShellArg(args.scriptPath)}`,
  ];
  return [
    `if cd ${quoteShellArg(args.cwd)}; then ${runSegments.join("; ")}; else printf '%s\\n' ${quoteShellArg(TERMINAL_RUN_COMMAND_CD_FAILURE_NOTICE)}; fi`,
    `rm -f ${quoteShellArg(args.scriptPath)}`,
    `rmdir ${quoteShellArg(args.scriptDir)}`,
    'exec "${SHELL:-/bin/sh}"',
  ].join("; ");
}

export interface BuildMacTerminalRunCommandOpenArgs {
  appName: "Terminal" | "iTerm";
  wrapper: string;
}

function buildTerminalRunCommandShellLine(wrapper: string): string {
  return `/bin/sh -c ${quoteShellArg(wrapper)}`;
}

export function buildMacTerminalRunCommandOpenArgs(
  args: BuildMacTerminalRunCommandOpenArgs,
): string[] {
  const command = escapeAppleScriptString(
    buildTerminalRunCommandShellLine(args.wrapper),
  );

  if (args.appName === "Terminal") {
    return [
      "-e",
      `tell application "Terminal" to do script "${command}"`,
      "-e",
      'tell application "Terminal" to activate',
    ];
  }

  return [
    "-e",
    'tell application "iTerm" to create window with default profile',
    "-e",
    `tell application "iTerm" to tell current session of current window to write text "${command}"`,
    "-e",
    'tell application "iTerm" to activate',
  ];
}

export function buildMacGhosttyRunCommandOpenArgs(args: {
  wrapper: string;
}): string[] {
  return ["-na", "Ghostty.app", "--args", "-e", "/bin/sh", "-lc", args.wrapper];
}

function buildLinuxTerminalRunCommandInvocation(
  executable: string,
  wrapper: string,
): ExecFileInvocation {
  const shellArgs = ["/bin/sh", "-lc", wrapper];
  if (executable === "gnome-terminal") {
    return { file: executable, args: ["--", ...shellArgs] };
  }
  return { file: executable, args: ["-e", ...shellArgs] };
}

interface TerminalRunCommandScript extends TerminalRunCommandScriptPaths {
  cwd: string;
  wrapper: string;
}

async function requireRunCommandDirectory(targetPath: string): Promise<string> {
  if (TERMINAL_RUN_COMMAND_PATH_CONTROL_CHARACTER_PATTERN.test(targetPath)) {
    throw new WorkspaceOpenTargetError({
      code: "path_not_openable",
      message: `Open target path must not contain control characters: ${targetPath}`,
    });
  }

  const existingPath = await requireOpenablePath(targetPath);
  if (existingPath.type !== "directory") {
    throw new WorkspaceOpenTargetError({
      code: "path_not_openable",
      message: `Open target path must be a directory to run a command: ${targetPath}`,
    });
  }
  return existingPath.path;
}

async function resolveMacRunCommandOpenInvocation(
  targetId: WorkspaceOpenTargetId,
  script: TerminalRunCommandScript,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation> {
  const definition = requireLaunchAdapter(targetId);
  if (definition.capabilities.runCommand !== true) {
    throw new WorkspaceOpenTargetError({
      code: "target_unavailable",
      message: `${definition.label} cannot run commands`,
    });
  }
  if (!(await isMacTargetAvailable(definition, runtime))) {
    throw new WorkspaceOpenTargetError({
      code: "target_unavailable",
      message: `Workspace open target is unavailable: ${definition.label}`,
    });
  }

  switch (definition.id) {
    case "terminal":
      return {
        env: runtime.env,
        file: "osascript",
        args: buildMacTerminalRunCommandOpenArgs({
          appName: "Terminal",
          wrapper: script.wrapper,
        }),
      };
    case "iterm2":
      return {
        env: runtime.env,
        file: "osascript",
        args: buildMacTerminalRunCommandOpenArgs({
          appName: "iTerm",
          wrapper: script.wrapper,
        }),
      };
    case "ghostty":
      return {
        env: runtime.env,
        file: "open",
        args: buildMacGhosttyRunCommandOpenArgs({ wrapper: script.wrapper }),
      };
    default:
      throw new WorkspaceOpenTargetError({
        code: "target_unavailable",
        message: `${definition.label} cannot run commands`,
      });
  }
}

async function resolveLinuxRunCommandOpenInvocation(
  targetId: WorkspaceOpenTargetId,
  script: TerminalRunCommandScript,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation> {
  if (targetId !== "terminal") {
    throw new WorkspaceOpenTargetError({
      code: "target_unavailable",
      message: `Workspace open target cannot run commands: ${targetId}`,
    });
  }
  const executable = await getTerminalExecutable(runtime);
  if (executable === null) {
    throw new WorkspaceOpenTargetError({
      code: "target_unavailable",
      message: "Terminal opener is unavailable",
    });
  }

  return {
    ...buildLinuxTerminalRunCommandInvocation(executable, script.wrapper),
    env: runtime.env,
  };
}

async function resolveRunCommandOpenInvocation(
  targetId: WorkspaceOpenTargetId,
  script: TerminalRunCommandScript,
  runtime: WorkspaceOpenTargetRuntime,
): Promise<ExecFileInvocation> {
  if (runtime.platform === "darwin") {
    return resolveMacRunCommandOpenInvocation(targetId, script, runtime);
  }
  if (runtime.platform === "linux") {
    return resolveLinuxRunCommandOpenInvocation(targetId, script, runtime);
  }
  throw new WorkspaceOpenTargetError({
    code: "unsupported_platform",
    message:
      "Running commands in open targets is not supported on this platform",
  });
}

async function removeTerminalRunCommandScript(
  script: TerminalRunCommandScriptPaths,
): Promise<void> {
  try {
    await fs.rm(script.scriptPath, { force: true });
    await fs.rmdir(script.scriptDir);
  } catch {}
}

export async function tryRunCommandInTargetWithRuntime(
  openArgs: OpenPathInTargetArgs,
  runtime: WorkspaceOpenTargetRuntime,
  options: OpenPathInTargetWithRuntimeOptions,
): Promise<boolean> {
  const { command } = openArgs;
  if (command === undefined) {
    return false;
  }
  const args = { ...openArgs, command };
  if (args.context.kind === "remote-ssh") {
    throw new WorkspaceOpenTargetError({
      code: "remote_target_unsupported",
      message: `${args.targetId} cannot run commands on remote SSH paths`,
    });
  }

  const cwd = await requireRunCommandDirectory(args.path);
  const interpreter: TerminalRunCommandInterpreter =
    resolveTerminalRunCommandInterpreter(
      args.language,
      options.interpreterPathExists ?? existsSync,
    );
  const scriptDir = await fs.mkdtemp(
    path.join(os.tmpdir(), TERMINAL_RUN_COMMAND_TEMP_DIR_PREFIX),
  );
  const scriptPath = path.join(
    scriptDir,
    TERMINAL_RUN_COMMAND_SCRIPT_FILE_NAME,
  );
  try {
    await fs.writeFile(
      scriptPath,
      args.command,
      { mode: 0o600 },
    );
    await execInvocation(
      await resolveRunCommandOpenInvocation(
        args.targetId,
        {
          cwd,
          scriptDir,
          scriptPath,
          wrapper: buildTerminalRunCommandWrapper({
            cwd,
            interpreter,
            scriptDir,
            scriptPath,
          }),
        },
        runtime,
      ),
      runtime,
    );
  } catch (error) {
    await removeTerminalRunCommandScript({ scriptDir, scriptPath });
    throw error;
  }
  return true;
}
