import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { Command } from "commander";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_HOST_DAEMON_LOCAL_HEALTH_VALUE,
  OPEN_IN_TARGET_COMMAND_MAX_LENGTH,
  OPEN_IN_TARGET_RUN_COMMAND_DISABLED_ERROR_CODE,
  type OpenInTargetRequest,
  type WorkspaceOpenTarget,
} from "@bb/host-daemon-contract/local";
import {
  readRunCommandText,
  registerRunInTerminalCommand,
  runCommandInTerminal,
  type CreateRunInTerminalDaemonClient,
  type RunInTerminalDaemonClient,
  type RunInTerminalDeps,
  type RunInTerminalInvocation,
} from "../commands/run-in-terminal.js";
import { getHelpOutput } from "./helpers/command-output-harness.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const SERVER_URL = "http://localhost";

const targets: WorkspaceOpenTarget[] = [
  {
    id: "editor-vscode",
    label: "Visual Studio Code",
    capabilities: { openDirectory: true, openFile: true, openFileAtLine: true },
  },
  {
    id: "terminal-app",
    label: "Terminal",
    kind: "terminal",
    capabilities: {
      openDirectory: true,
      openFile: true,
      openFileAtLine: true,
      runCommand: true,
    },
  },
  {
    id: "iterm2",
    label: "iTerm2",
    kind: "terminal",
    capabilities: {
      openDirectory: true,
      openFile: true,
      openFileAtLine: true,
      runCommand: true,
    },
  },
];

interface FakeDaemonArgs {
  alivePorts: ReadonlySet<number>;
  requests: OpenInTargetRequest[];
  respond?: () => Promise<Response>;
  targets?: WorkspaceOpenTarget[];
}

function createFakeDaemonClient(
  args: FakeDaemonArgs,
): CreateRunInTerminalDaemonClient {
  return (port) => {
    const client: RunInTerminalDaemonClient = {
      "/health": {
        $get: () =>
          args.alivePorts.has(port)
            ? Promise.resolve(
                new Response(DEFAULT_HOST_DAEMON_LOCAL_HEALTH_VALUE),
              )
            : Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1")),
      },
      "/workspace-open-targets": {
        $get: () =>
          Promise.resolve(
            Response.json({ targets: args.targets ?? targets }),
          ),
      },
      "/open-in-target": {
        $post: (post) => {
          args.requests.push(post.json);
          return Promise.resolve(
            args.respond?.() ?? Response.json({}, { status: 200 }),
          );
        },
      },
    };
    return client;
  };
}

interface Harness {
  probedPorts: number[];
  requests: OpenInTargetRequest[];
  configFetches: string[];
  run: (
    overrides?: Partial<RunInTerminalInvocation>,
    depsOverrides?: Partial<RunInTerminalDeps>,
  ) => Promise<WorkspaceOpenTarget>;
}

function harness(args: {
  alivePorts?: ReadonlySet<number>;
  fetchLocalHelperPorts?: (serverUrl: string) => Promise<readonly number[]>;
  respond?: () => Promise<Response>;
  targets?: WorkspaceOpenTarget[];
} = {}): Harness {
  const probedPorts: number[] = [];
  const requests: OpenInTargetRequest[] = [];
  const configFetches: string[] = [];
  const fetchLocalHelperPorts =
    args.fetchLocalHelperPorts ??
    (async (serverUrl: string) => {
      configFetches.push(serverUrl);
      return [41001, 41002];
    });
  return {
    probedPorts,
    requests,
    configFetches,
    run: (invocationOverrides = {}, depsOverrides = {}) =>
      runCommandInTerminal(
        {
          commandSource: "-",
          cwd: "/tmp/workspace",
          language: "sh",
          serverUrl: SERVER_URL,
          ...invocationOverrides,
        },
        {
          createDaemonClient: (port) => {
            probedPorts.push(port);
            return createFakeDaemonClient({
              alivePorts: args.alivePorts ?? new Set([41002]),
              requests,
              respond: args.respond,
              targets: args.targets,
            })(port);
          },
          env: {},
          fetchLocalHelperPorts,
          stdin: streamFrom("echo hi"),
          ...depsOverrides,
        },
      ),
  };
}

function registeredProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerRunInTerminalCommand(program, () => SERVER_URL);
  return program;
}

describe("run-in-terminal", () => {
  it("composes the open-in-target request with defaults from the first run-capable target", async () => {
    const file = join(
      await mkdtemp(join(tmpdir(), "bb-run-in-terminal-test-")),
      "command.sh",
    );
    directories.push(file);
    await writeFile(file, "echo hi\n");
    const h = harness();
    const target = await h.run({ commandSource: file });
    expect(target.id).toBe("terminal-app");
    expect(h.requests).toEqual([
      {
        context: { kind: "local" },
        lineNumber: null,
        columnNumber: null,
        path: "/tmp/workspace",
        targetId: "terminal-app",
        command: "echo hi\n",
        language: "sh",
      },
    ]);
  });

  it("reads the command text from standard input for `-`", async () => {
    const stdin = new PassThrough();
    const pending = readRunCommandText("-", stdin);
    stdin.end("echo from stdin\n");
    await expect(pending).resolves.toBe("echo from stdin\n");
  });

  it("rejects a command file over the character cap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-run-in-terminal-test-"));
    directories.push(dir);
    const file = join(dir, "command.sh");
    await writeFile(file, "a".repeat(OPEN_IN_TARGET_COMMAND_MAX_LENGTH + 1));
    const h = harness();

    await expect(h.run({ commandSource: file })).rejects.toMatchObject({
      code: "invalid_value",
      message: expect.stringContaining(
        `exceeds the maximum of ${OPEN_IN_TARGET_COMMAND_MAX_LENGTH} characters`,
      ),
    });
    expect(h.requests).toEqual([]);
  });

  it("rejects a command file whose byte length exceeds the read bound", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-run-in-terminal-test-"));
    directories.push(dir);
    const file = join(dir, "command.sh");
    await writeFile(file, "日".repeat(OPEN_IN_TARGET_COMMAND_MAX_LENGTH + 1));

    await expect(readRunCommandText(file)).rejects.toMatchObject({
      code: "invalid_value",
    });
  });

  it("rejects stdin content whose byte length exceeds the read bound", async () => {
    const stdin = new PassThrough();
    const pending = readRunCommandText("-", stdin);
    stdin.end("日".repeat(OPEN_IN_TARGET_COMMAND_MAX_LENGTH + 1));

    await expect(pending).rejects.toMatchObject({
      code: "invalid_value",
      message: expect.stringContaining(
        `exceeds the maximum of ${OPEN_IN_TARGET_COMMAND_MAX_LENGTH} characters`,
      ),
    });
  });

  it("runs a multibyte command at the character cap end to end", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-run-in-terminal-test-"));
    directories.push(dir);
    const file = join(dir, "command.sh");
    await writeFile(
      file,
      `echo ${"日".repeat(OPEN_IN_TARGET_COMMAND_MAX_LENGTH - 5)}`,
    );
    const h = harness();

    const target = await h.run({ commandSource: file });

    expect(target.id).toBe("terminal-app");
    expect(h.requests[0]?.command).toHaveLength(
      OPEN_IN_TARGET_COMMAND_MAX_LENGTH,
    );
  });

  it("reports an unreadable command file as a clean CLI error", async () => {
    await expect(
      readRunCommandText(join(tmpdir(), "bb-run-in-terminal-missing-file")),
    ).rejects.toMatchObject({
      code: "command_file_unreadable",
      message: expect.stringContaining("Could not read the command file"),
    });
  });

  it("runs the composed request for stdin input end to end", async () => {
    const h = harness();
    const stdin = new PassThrough();
    const pending = h.run({}, { stdin });
    stdin.end("uptime");
    await pending;
    expect(h.requests[0]?.command).toBe("uptime");
  });

  it("prefers an explicit --target over the default", async () => {
    const h = harness();
    await h.run({ targetId: "iterm2", language: "bash" });
    expect(h.requests[0]).toMatchObject({
      targetId: "iterm2",
      language: "bash",
    });
  });

  it("probes no port other than BB_HOST_DAEMON_PORT when it is set", async () => {
    const h = harness({
      fetchLocalHelperPorts: async () => {
        throw new Error("must not consult the server");
      },
      alivePorts: new Set([41007]),
    });
    await h.run({}, { env: { BB_HOST_DAEMON_PORT: "41007" } });
    expect(h.probedPorts).toEqual([41007]);
    expect(h.configFetches).toEqual([]);
  });

  it("rejects an invalid BB_HOST_DAEMON_PORT value before probing any port", async () => {
    const h = harness({
      fetchLocalHelperPorts: async () => {
        throw new Error("must not consult the server");
      },
    });
    await expect(
      h.run({}, { env: { BB_HOST_DAEMON_PORT: "not-a-port" } }),
    ).rejects.toMatchObject({
      code: "invalid_value",
      message: expect.stringContaining(
        'Invalid BB_HOST_DAEMON_PORT value: "not-a-port"',
      ),
    });
    await expect(
      h.run({}, { env: { BB_HOST_DAEMON_PORT: "65536" } }),
    ).rejects.toMatchObject({ code: "invalid_value" });
    expect(h.probedPorts).toEqual([]);
    expect(h.configFetches).toEqual([]);
  });

  it("probes the server-reported helper ports in order and picks the first alive one", async () => {
    const h = harness({ alivePorts: new Set([41002]) });
    await h.run();
    expect(h.configFetches).toEqual([SERVER_URL]);
    expect(h.probedPorts).toEqual([41001, 41002]);
    expect(h.requests).toHaveLength(1);
  });

  it("reports an unreachable daemon when every candidate port is dead", async () => {
    const h = harness({ alivePorts: new Set() });
    await expect(h.run()).rejects.toMatchObject({
      code: "daemon_unreachable",
      message: expect.stringContaining("tried ports 41001, 41002"),
    });
  });

  it("reports an unreachable daemon when port discovery fails", async () => {
    const h = harness({
      fetchLocalHelperPorts: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    await expect(h.run()).rejects.toMatchObject({
      code: "daemon_unreachable",
      message: expect.stringContaining(SERVER_URL),
    });
  });

  it("rejects the daemon's run_command_disabled code without string-matching the message", async () => {
    const h = harness({
      respond: () =>
        Promise.resolve(
          Response.json(
            {
              code: OPEN_IN_TARGET_RUN_COMMAND_DISABLED_ERROR_CODE,
              message: "Running commands in the terminal is disabled.",
            },
            { status: 400 },
          ),
        ),
    });
    await expect(h.run()).rejects.toMatchObject({
      code: OPEN_IN_TARGET_RUN_COMMAND_DISABLED_ERROR_CODE,
    });
  });

  it("reports structured non-disabled daemon errors", async () => {
    const h = harness({
      respond: () =>
        Promise.resolve(
          Response.json(
            { code: "target_launch_failed", message: "Terminal did not open." },
            { status: 500 },
          ),
        ),
    });
    await expect(h.run()).rejects.toMatchObject({
      code: "target_launch_failed",
      message: "Terminal did not open.",
      hint: null,
    });
  });

  it("falls back to HTTP response text for unstructured daemon errors", async () => {
    const h = harness({
      respond: () =>
        Promise.resolve(new Response("Terminal did not open.", { status: 500 })),
    });
    await expect(h.run()).rejects.toMatchObject({
      code: "http_500",
      message: "Failed to run command in terminal: Terminal did not open.",
      hint: null,
    });
  });

  it("does not post to legacy daemons that omit runCommand capability", async () => {
    const h = harness({
      targets: targets.map((target) => ({
        ...target,
        capabilities: { ...target.capabilities, runCommand: undefined },
      })),
    });
    await expect(h.run()).rejects.toMatchObject({
      code: "no_run_command_target",
    });
    await expect(h.run({ targetId: "terminal-app" })).rejects.toMatchObject({
      code: "no_run_command_target",
    });
    expect(h.requests).toEqual([]);
  });

  it("reports unknown and non-run-capable explicit targets", async () => {
    const h = harness();
    await expect(h.run({ targetId: "ghostty" })).rejects.toMatchObject({
      code: "unknown_target",
    });
    await expect(h.run({ targetId: "editor-vscode" })).rejects.toMatchObject({
      code: "no_run_command_target",
    });
  });

  it("rejects empty and over-length command text", async () => {
    const h = harness();
    await expect(
      h.run({}, {
        stdin: streamFrom("   \n"),
      }),
    ).rejects.toMatchObject({ code: "invalid_value" });
    await expect(
      h.run({}, { stdin: streamFrom("a".repeat(8_193)) }),
    ).rejects.toMatchObject({ code: "invalid_value" });
    expect(h.requests).toEqual([]);
  });

  it("rejects languages outside the shell allowlist at parse time", async () => {
    const program = registeredProgram();
    await expect(
      program.parseAsync([
        "node",
        "bb",
        "run-in-terminal",
        "-",
        "--language",
        "fish",
      ]),
    ).rejects.toThrow(/Allowed choices are sh, bash, zsh, shell/);
  });

  it("lists flags and the terminal-permissions and shell-history notes in --help", async () => {
    const help = await getHelpOutput(["run-in-terminal"], (program) =>
      registerRunInTerminalCommand(program, () => SERVER_URL),
    );
    expect(help).toContain("--cwd <dir>");
    expect(help).toContain("--language <language>");
    expect(help).toContain("--target <targetId>");
    expect(help).toContain("TCC grants");
    expect(help).toContain("Shell history records");
  });
});

function streamFrom(text: string): PassThrough {
  const stdin = new PassThrough();
  stdin.end(text);
  return stdin;
}
