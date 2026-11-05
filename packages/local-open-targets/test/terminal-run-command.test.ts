import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  listWorkspaceOpenTargetsWithRuntime,
  normalizeTerminalRunCommandText,
  openPathInTargetWithRuntime,
  TERMINAL_RUN_COMMAND_TEMP_DIR_PREFIX,
  WorkspaceOpenTargetError,
  type OpenPathInTargetArgs,
  type WorkspaceOpenTargetRuntime,
} from "../src/index.js";
import { LAUNCH_ADAPTERS } from "../src/macos-launch-adapters.js";
import {
  buildMacGhosttyRunCommandOpenArgs,
  buildMacTerminalRunCommandOpenArgs,
  buildTerminalRunCommandWrapper,
  resolveTerminalRunCommandInterpreter,
} from "../src/terminal-run-command.fork.js";
import type { ExecFileHandler } from "../src/types.js";

const COMMAND_TEXT = [
  "echo 'single quotes' and \"double quotes\"",
  "echo `backticks` and $VARIABLES and \\backslashes",
  "exit",
].join("\n");
const SHELL_TAIL = 'exec "${SHELL:-/bin/sh}"';
const CD_FAILURE_NOTICE = "bb: cd failed; command not run";
const INTERPRETER_FALLBACK_NOTICE =
  "bb: preferred interpreter unavailable, using fallback";
const WORKSPACE_PREFIX = "bb-command-cwd-";

interface ExecFileCall {
  args: string[];
  env?: NodeJS.ProcessEnv;
  file: string;
}

const MAC_BUNDLE_APP_PATHS: ReadonlyArray<readonly [string, string]> = [
  ["com.mitchellh.ghostty", "/Applications/Ghostty.app"],
];

function createExecFile(args: {
  availableExecutables?: string[];
  calls?: ExecFileCall[];
  failFiles?: string[];
}): ExecFileHandler {
  const availableExecutables = args.availableExecutables ?? [];
  return async (file, commandArgs, options) => {
    args.calls?.push({
      args: commandArgs,
      ...(options?.env !== undefined ? { env: options.env } : {}),
      file,
    });
    if (file === "which" || file === "where.exe") {
      if (availableExecutables.includes(commandArgs[0] ?? "")) {
        return { stdout: `/usr/bin/${commandArgs[0]}\n` };
      }
      throw new Error("Executable not found");
    }
    if (file === "mdfind") {
      const query = commandArgs.join(" ");
      const appPath = MAC_BUNDLE_APP_PATHS.find(([bundleId]) =>
        query.includes(bundleId),
      )?.[1];
      return { stdout: appPath === undefined ? "" : `${appPath}\n` };
    }
    if (args.failFiles?.includes(file)) {
      throw new Error(`Launch failed: ${file}`);
    }
    return { stdout: "" };
  };
}

function createRuntime(args: {
  execFile: ExecFileHandler;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): WorkspaceOpenTargetRuntime {
  return {
    applicationDirectories: [],
    desktopFileDirectories: [],
    env: args.env,
    execFile: args.execFile,
    hasExecutable: async (command, env) => {
      try {
        await args.execFile(
          args.platform === "win32" ? "where.exe" : "which",
          [command],
          env === undefined ? undefined : { env },
        );
        return true;
      } catch {
        return false;
      }
    },
    platform: args.platform ?? "darwin",
  };
}

function runCommandArgs(
  args: Partial<OpenPathInTargetArgs> & { path: string },
): OpenPathInTargetArgs & { command: string } {
  return {
    columnNumber: null,
    command: COMMAND_TEXT,
    context: { kind: "local" },
    lineNumber: null,
    targetId: "terminal",
    ...args,
  };
}

async function findCreatedRunDir(before: ReadonlySet<string>): Promise<string> {
  const created = (await readdir(tmpdir())).filter(
    (name) =>
      name.startsWith(TERMINAL_RUN_COMMAND_TEMP_DIR_PREFIX) &&
      !before.has(name),
  );
  if (created.length !== 1) {
    throw new Error(
      `Expected one created ${TERMINAL_RUN_COMMAND_TEMP_DIR_PREFIX} directory, found ${created.length}`,
    );
  }
  return path.join(tmpdir(), created[0]);
}

function unescapeAppleScriptString(value: string): string {
  return value.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
}

function unquoteShellArg(value: string): string {
  if (!value.startsWith("'") || !value.endsWith("'")) {
    throw new Error(`Expected a single-quoted shell argument: ${value}`);
  }
  return value.slice(1, -1).replaceAll("'\\''", "'");
}

function extractAppleScriptCommand(
  script: string,
  pattern: RegExp,
): string | null {
  return pattern.exec(script)?.[1] ?? null;
}

describe("terminal run-command wrapper", () => {
  const scriptDir = "/tmp/bb-run-abc";
  const scriptPath = `${scriptDir}/command.sh`;

  it("builds the single-cd wrapper with cleanup and shell tail", () => {
    expect(
      buildTerminalRunCommandWrapper({
        cwd: "/tmp/ws my dir",
        interpreter: { executable: "/bin/sh", fallbackNotice: false },
        scriptDir,
        scriptPath,
      }),
    ).toBe(
      [
        `if cd '/tmp/ws my dir'; then /bin/sh '${scriptPath}'; else printf '%s\\n' '${CD_FAILURE_NOTICE}'; fi`,
        `rm -f '${scriptPath}'`,
        `rmdir '${scriptDir}'`,
        SHELL_TAIL,
      ].join("; "),
    );
  });

  it("embeds only the cwd, script path, and script dir", () => {
    const wrapper = buildTerminalRunCommandWrapper({
      cwd: "/tmp/ws",
      interpreter: { executable: "/bin/bash", fallbackNotice: false },
      scriptDir,
      scriptPath,
    });

    expect(wrapper).toContain("cd '/tmp/ws'");
    expect(wrapper).toContain(`/bin/bash '${scriptPath}'`);
    expect(wrapper).toContain(`rmdir '${scriptDir}'`);
    expect(wrapper).not.toContain(COMMAND_TEXT);
  });

  it("never targets rmdir at the workspace directory", () => {
    const wrapper = buildTerminalRunCommandWrapper({
      cwd: "/tmp/ws",
      interpreter: { executable: "/bin/sh", fallbackNotice: false },
      scriptDir,
      scriptPath,
    });

    expect(wrapper).toContain(`rmdir '${scriptDir}'`);
    expect(wrapper).not.toContain("rmdir '/tmp/ws'");
  });

  it("prepends the fixed fallback notice for a substituted interpreter", () => {
    expect(
      buildTerminalRunCommandWrapper({
        cwd: "/tmp/ws",
        interpreter: { executable: "/bin/sh", fallbackNotice: true },
        scriptDir,
        scriptPath,
      }),
    ).toBe(
      [
        `if cd '/tmp/ws'; then printf '%s\\n' '${INTERPRETER_FALLBACK_NOTICE}'; /bin/sh '${scriptPath}'; else printf '%s\\n' '${CD_FAILURE_NOTICE}'; fi`,
        `rm -f '${scriptPath}'`,
        `rmdir '${scriptDir}'`,
        SHELL_TAIL,
      ].join("; "),
    );
  });
});

describe("terminal run-command interpreter selection", () => {
  const exists = () => true;

  it("selects the interpreter from the language enum", () => {
    expect(resolveTerminalRunCommandInterpreter("bash", exists)).toEqual({
      executable: "/bin/bash",
      fallbackNotice: false,
    });
    expect(resolveTerminalRunCommandInterpreter("sh", exists)).toEqual({
      executable: "/bin/sh",
      fallbackNotice: false,
    });
    expect(resolveTerminalRunCommandInterpreter("shell", exists)).toEqual({
      executable: "/bin/sh",
      fallbackNotice: false,
    });
    expect(resolveTerminalRunCommandInterpreter("zsh", exists)).toEqual({
      executable: "/bin/zsh",
      fallbackNotice: false,
    });
    expect(resolveTerminalRunCommandInterpreter(undefined, exists)).toEqual({
      executable: "/bin/sh",
      fallbackNotice: false,
    });
  });

  it("falls back to /bin/sh with the notice when the interpreter is absent", () => {
    expect(resolveTerminalRunCommandInterpreter("bash", () => false)).toEqual({
      executable: "/bin/sh",
      fallbackNotice: true,
    });
    expect(resolveTerminalRunCommandInterpreter("zsh", () => false)).toEqual({
      executable: "/bin/sh",
      fallbackNotice: true,
    });
    expect(resolveTerminalRunCommandInterpreter("sh", () => false)).toEqual({
      executable: "/bin/sh",
      fallbackNotice: false,
    });
  });
});

describe("terminal run-command typed launch lines", () => {
  const wrapper = buildTerminalRunCommandWrapper({
    cwd: "/tmp/ws",
    interpreter: { executable: "/bin/sh", fallbackNotice: false },
    scriptDir: "/tmp/bb-run-abc",
    scriptPath: "/tmp/bb-run-abc/command.sh",
  });
  const terminalPattern = /^tell application "Terminal" to do script "(.*)"$/u;
  const iTermPattern =
    /^tell application "iTerm" to tell current session of current window to write text "(.*)"$/u;

  it("types /bin/sh -c with the quoted wrapper into Terminal.app", () => {
    const args = buildMacTerminalRunCommandOpenArgs({
      appName: "Terminal",
      wrapper,
    });

    expect(args).toEqual([
      "-e",
      expect.stringMatching(terminalPattern),
      "-e",
      'tell application "Terminal" to activate',
    ]);
    const typed = unescapeAppleScriptString(
      extractAppleScriptCommand(args[1] ?? "", terminalPattern) ?? "",
    );
    expect(typed.startsWith("/bin/sh -c '")).toBe(true);
    expect(unquoteShellArg(typed.slice("/bin/sh -c ".length))).toBe(wrapper);
  });

  it("types /bin/sh -c with the quoted wrapper into iTerm2", () => {
    const args = buildMacTerminalRunCommandOpenArgs({
      appName: "iTerm",
      wrapper,
    });

    expect(args).toEqual([
      "-e",
      'tell application "iTerm" to create window with default profile',
      "-e",
      expect.stringMatching(iTermPattern),
      "-e",
      'tell application "iTerm" to activate',
    ]);
    const typed = unescapeAppleScriptString(
      extractAppleScriptCommand(args[3] ?? "", iTermPattern) ?? "",
    );
    expect(typed.startsWith("/bin/sh -c '")).toBe(true);
    expect(unquoteShellArg(typed.slice("/bin/sh -c ".length))).toBe(wrapper);
  });

  it("pins /bin/sh -lc for Ghostty regardless of the login shell", () => {
    expect(buildMacGhosttyRunCommandOpenArgs({ wrapper })).toEqual([
      "-na",
      "Ghostty.app",
      "--args",
      "-e",
      "/bin/sh",
      "-lc",
      wrapper,
    ]);
  });
});

describe("terminal run-command capability matrix", () => {
  it("advertises runCommand on mac terminal targets and not on warp or editors", () => {
    const capabilitiesById = new Map(
      LAUNCH_ADAPTERS.map((adapter) => [adapter.id, adapter.capabilities]),
    );
    expect(capabilitiesById.get("terminal")?.runCommand).toBe(true);
    expect(capabilitiesById.get("iterm2")?.runCommand).toBe(true);
    expect(capabilitiesById.get("ghostty")?.runCommand).toBe(true);
    expect(capabilitiesById.get("warp")?.runCommand).toBeUndefined();
    expect(capabilitiesById.get("vscode")?.runCommand).toBeUndefined();
    expect(capabilitiesById.get("zed")?.runCommand).toBeUndefined();
  });

  it("advertises runCommand on the Linux platform terminal target", async () => {
    const targets = await listWorkspaceOpenTargetsWithRuntime(
      createRuntime({
        execFile: createExecFile({
          availableExecutables: ["x-terminal-emulator"],
        }),
        platform: "linux",
      }),
    );

    expect(targets.find((target) => target.id === "terminal")).toMatchObject({
      capabilities: expect.objectContaining({ runCommand: true }),
    });
  });

  it("does not advertise runCommand on the Windows terminal target", async () => {
    const targets = await listWorkspaceOpenTargetsWithRuntime(
      createRuntime({
        execFile: createExecFile({ availableExecutables: ["wt"] }),
        platform: "win32",
      }),
    );

    expect(targets.find((target) => target.id === "terminal")).toMatchObject({
      capabilities: expect.not.objectContaining({ runCommand: true }),
    });
  });
});

describe("terminal run-command launches", () => {
  it("writes a 0600 multi-line script into a 0700 dir and types the wrapper into Terminal.app", async () => {
    const calls: ExecFileCall[] = [];
    const before = new Set(await readdir(tmpdir()));
    const workspacePath = mkdtempSync(path.join(tmpdir(), WORKSPACE_PREFIX));
    const runtimeEnv = { BB_RUN_COMMAND_TEST: "1" };

    try {
      await openPathInTargetWithRuntime(
        runCommandArgs({ path: workspacePath }),
        createRuntime({ env: runtimeEnv, execFile: createExecFile({ calls }) }),
      );
      const runDir = await findCreatedRunDir(before);
      const scriptPath = path.join(runDir, "command.sh");

      expect(statSync(runDir).mode & 0o777).toBe(0o700);
      expect(statSync(scriptPath).mode & 0o777).toBe(0o600);
      expect(readFileSync(scriptPath, "utf8")).toBe(COMMAND_TEXT);

      const osascriptCall = calls.find((call) => call.file === "osascript");
      expect(osascriptCall).toBeDefined();
      expect(osascriptCall?.env).toEqual(runtimeEnv);
      const script = osascriptCall?.args.join("\n") ?? "";
      expect(script).toContain('tell application "Terminal" to do script "');
      const doScriptPattern =
        /^tell application "Terminal" to do script "(.*)"$/u;
      const typed = unescapeAppleScriptString(
        extractAppleScriptCommand(
          osascriptCall?.args[1] ?? "",
          doScriptPattern,
        ) ?? "",
      );
      expect(typed.startsWith("/bin/sh -c '")).toBe(true);
      const wrapperOut = unquoteShellArg(typed.slice("/bin/sh -c ".length));
      expect(wrapperOut).toContain(`cd '${workspacePath}'`);
      expect(wrapperOut).toContain(`rm -f '${scriptPath}'`);
      expect(wrapperOut).toContain(`rmdir '${runDir}'`);
      expect(wrapperOut).toContain(SHELL_TAIL);
      expect(wrapperOut).not.toContain("backticks");
      rmSync(runDir, { recursive: true, force: true });
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("normalizes CRLF and lone CR to LF in the script file", async () => {
    const calls: ExecFileCall[] = [];
    const before = new Set(await readdir(tmpdir()));
    const workspacePath = mkdtempSync(path.join(tmpdir(), WORKSPACE_PREFIX));

    try {
      await openPathInTargetWithRuntime(
        runCommandArgs({
          command: "echo one\r\necho two\rlong ago\nexit",
          path: workspacePath,
        }),
        createRuntime({ execFile: createExecFile({ calls }) }),
      );
      const runDir = await findCreatedRunDir(before);

      expect(readFileSync(path.join(runDir, "command.sh"), "utf8")).toBe(
        "echo one\necho two\nlong ago\nexit",
      );
      rmSync(runDir, { recursive: true, force: true });
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("launches Ghostty commands through /bin/sh even with a fish login shell", async () => {
    const calls: ExecFileCall[] = [];
    const workspacePath = mkdtempSync(path.join(tmpdir(), WORKSPACE_PREFIX));

    try {
      await openPathInTargetWithRuntime(
        runCommandArgs({
          language: "bash",
          path: workspacePath,
          targetId: "ghostty",
        }),
        createRuntime({ execFile: createExecFile({ calls }) }),
        { interpreterPathExists: () => true },
      );

      const openCall = calls.find((call) => call.file === "open");
      expect(openCall?.args.slice(0, 6)).toEqual([
        "-na",
        "Ghostty.app",
        "--args",
        "-e",
        "/bin/sh",
        "-lc",
      ]);
      expect(openCall?.args[6]).toContain(`cd '${workspacePath}'`);
      expect(openCall?.args[6]).toContain("/bin/bash '");
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("falls back to /bin/sh with a notice at launch when the interpreter is absent", async () => {
    const calls: ExecFileCall[] = [];
    const workspacePath = mkdtempSync(path.join(tmpdir(), WORKSPACE_PREFIX));

    try {
      await openPathInTargetWithRuntime(
        runCommandArgs({
          language: "bash",
          path: workspacePath,
          targetId: "ghostty",
        }),
        createRuntime({ execFile: createExecFile({ calls }) }),
        { interpreterPathExists: () => false },
      );

      const openCall = calls.find((call) => call.file === "open");
      expect(openCall?.args[6]).toContain(INTERPRETER_FALLBACK_NOTICE);
      expect(openCall?.args[6]).toContain("/bin/sh '");
      expect(openCall?.args[6]).not.toContain("/bin/bash '");
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("keeps quoting a launch cwd that contains a single quote", async () => {
    const calls: ExecFileCall[] = [];
    const workspacePath = mkdtempSync(path.join(tmpdir(), WORKSPACE_PREFIX));
    const cwdPath = path.join(workspacePath, "it's dir");
    mkdirSync(cwdPath);

    try {
      await openPathInTargetWithRuntime(
        runCommandArgs({ path: cwdPath }),
        createRuntime({ execFile: createExecFile({ calls }) }),
      );

      const osascriptCall = calls.find((call) => call.file === "osascript");
      const doScriptPattern =
        /^tell application "Terminal" to do script "(.*)"$/u;
      const typed = unescapeAppleScriptString(
        extractAppleScriptCommand(
          osascriptCall?.args[1] ?? "",
          doScriptPattern,
        ) ?? "",
      );
      expect(typed.startsWith("/bin/sh -c '")).toBe(true);
      const wrapperOut = unquoteShellArg(typed.slice("/bin/sh -c ".length));
      expect(wrapperOut).toContain(`cd '${cwdPath.replaceAll("'", "'\\''")}'`);
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("rejects run commands on win32 runtimes as an unsupported platform", async () => {
    const execFile = vi.fn(createExecFile({}));
    const workspacePath = mkdtempSync(path.join(tmpdir(), WORKSPACE_PREFIX));

    try {
      await expect(
        openPathInTargetWithRuntime(
          runCommandArgs({ path: workspacePath }),
          createRuntime({ execFile, platform: "win32" }),
        ),
      ).rejects.toMatchObject({ code: "unsupported_platform" });
      expect(execFile).not.toHaveBeenCalled();
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("launches Linux terminal commands through /bin/sh -lc", async () => {
    const calls: ExecFileCall[] = [];
    const workspacePath = mkdtempSync(path.join(tmpdir(), WORKSPACE_PREFIX));
    const env = { SHELL: "/usr/bin/fish", TERM: "xterm" };

    try {
      await openPathInTargetWithRuntime(
        runCommandArgs({ path: workspacePath }),
        createRuntime({
          env,
          execFile: createExecFile({
            availableExecutables: ["gnome-terminal"],
            calls,
          }),
          platform: "linux",
        }),
      );

      expect(calls.find((call) => call.file === "gnome-terminal")).toEqual({
        args: [
          "--",
          "/bin/sh",
          "-lc",
          expect.stringContaining(`cd '${workspacePath}'`),
        ],
        env,
        file: "gnome-terminal",
      });
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("removes the script file and dir when the launch fails", async () => {
    const before = new Set(await readdir(tmpdir()));
    const workspacePath = mkdtempSync(path.join(tmpdir(), WORKSPACE_PREFIX));

    try {
      await expect(
        openPathInTargetWithRuntime(
          runCommandArgs({ path: workspacePath }),
          createRuntime({
            execFile: createExecFile({ failFiles: ["osascript"] }),
          }),
        ),
      ).rejects.toThrow("Launch failed: osascript");

      const remaining = (await readdir(tmpdir())).filter(
        (name) =>
          name.startsWith(TERMINAL_RUN_COMMAND_TEMP_DIR_PREFIX) &&
          !before.has(name),
      );
      expect(remaining).toEqual([]);
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("rejects command runs for targets without the runCommand capability", async () => {
    const execFile = vi.fn(createExecFile({}));

    await expect(
      openPathInTargetWithRuntime(
        runCommandArgs({ path: tmpdir(), targetId: "warp" }),
        createRuntime({ execFile }),
      ),
    ).rejects.toMatchObject({
      code: "target_unavailable",
      message: "Warp cannot run commands",
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  it("rejects a command target path that is not a directory", async () => {
    const filePath = path.join(
      mkdtempSync(path.join(tmpdir(), WORKSPACE_PREFIX)),
      "file.txt",
    );
    writeFileSync(filePath, "text", "utf8");

    await expect(
      openPathInTargetWithRuntime(
        runCommandArgs({ path: filePath }),
        createRuntime({ execFile: createExecFile({}) }),
      ),
    ).rejects.toBeInstanceOf(WorkspaceOpenTargetError);
  });

  it("rejects a command target path containing control characters", async () => {
    await expect(
      openPathInTargetWithRuntime(
        runCommandArgs({ path: "/tmp/line\nbreak" }),
        createRuntime({ execFile: createExecFile({}) }),
      ),
    ).rejects.toMatchObject({ code: "path_not_openable" });
  });

  it("rejects command runs over remote SSH", async () => {
    const execFile = vi.fn(createExecFile({}));

    await expect(
      openPathInTargetWithRuntime(
        {
          columnNumber: null,
          command: COMMAND_TEXT,
          context: { kind: "remote-ssh", sshAuthority: "devbox" },
          lineNumber: null,
          path: "/home/me/project",
          targetId: "terminal",
        },
        createRuntime({ execFile }),
      ),
    ).rejects.toMatchObject({ code: "remote_target_unsupported" });
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe("terminal run-command script normalization", () => {
  it("rewrites CRLF and lone CR to LF", () => {
    expect(normalizeTerminalRunCommandText("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});
