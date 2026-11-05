import {
  chmodSync,
  mkdirSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JsonValue } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { GLM_PROBE_MODELS } from "../../__fixtures__/glm-model-list.js";

const { forkSessionMock, queryMock, contextQueryMock, execFileMock, cliState } =
  vi.hoisted(() => ({
    forkSessionMock: vi.fn(),
    queryMock: vi.fn(),
    contextQueryMock: vi.fn(),
    execFileMock: vi.fn(),
    cliState: { installed: true },
  }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (args: {
    options?: { persistSession?: boolean; forkSession?: boolean };
  }) =>
    args.options?.persistSession === false && args.options.forkSession === true
      ? contextQueryMock(args)
      : queryMock(args),
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn((_name, _desc, _schema, handler) => handler),
}));

vi.mock("../session-fork.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../session-fork.js")>()),
  forkClaudeSession: forkSessionMock,
}));

vi.mock("@get-bb/plugin-sdk/provider-bridge", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@get-bb/plugin-sdk/provider-bridge")
  >()),
  experimental_resolveExecutablePath: () =>
    Promise.resolve(cliState.installed ? "/test/claude" : null),
  experimental_readCliVersion: () => Promise.resolve("2.1.0"),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: execFileMock,
}));

const GLM_ENV = {
  ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3[1m]",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.3-flashx[1m]",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.3-flash[1m]",
  API_TIMEOUT_MS: "3000000",
};
const TOKEN = "glm-token-value-0123456789";
const PROVIDER_ID = "claude-code-glm";
const USAGE_OK_BODY = {
  code: 200,
  success: true,
  data: {
    level: "max",
    limits: [
      { type: "CREDIT_LIMIT", unit: 3, number: 5, percentage: 0 },
      {
        type: "CREDIT_LIMIT",
        unit: 6,
        number: 1,
        percentage: 29,
        nextResetTime: 1793089363976,
      },
    ],
  },
};
const AMBIENT_KEYS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
] as const;

let savedEnv: NodeJS.ProcessEnv;
let tempDir: string;
let userHome: string;
let tokenFile: string;
let received: unknown[];
let preexistingSettingsDirs: Set<string>;

interface SettingsSnapshot {
  path: string;
  mode: number;
  dirMode: number;
  content: Record<string, unknown>;
}
let settingsSnapshots: SettingsSnapshot[];

function snapshotSettingsFile(options: unknown): void {
  if (typeof options !== "object" || options === null) return;
  const settings = (options as { settings?: unknown }).settings;
  if (typeof settings !== "string") return;
  settingsSnapshots.push({
    path: settings,
    mode: statSync(settings).mode & 0o777,
    dirMode: statSync(dirname(settings)).mode & 0o777,
    content: JSON.parse(readFileSync(settings, "utf8")),
  });
}

function lastSettingsSnapshot(): SettingsSnapshot {
  const snapshot = settingsSnapshots.at(-1);
  if (snapshot === undefined) throw new Error("Expected a settings file");
  return snapshot;
}

interface IdleQuery {
  initializationResult: ReturnType<typeof vi.fn>;
  applyFlagSettings: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  getContextUsage: ReturnType<typeof vi.fn>;
  interrupt: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  setPermissionMode: ReturnType<typeof vi.fn>;
  emit: (message: unknown) => void;
  [Symbol.asyncIterator]: () => AsyncIterator<unknown>;
}
let createdQueries: IdleQuery[];

function createIdleQuery(): IdleQuery {
  const queue: unknown[] = [];
  let waiting: ((result: IteratorResult<unknown>) => void) | null = null;
  let ended = false;
  const endStream = () => {
    ended = true;
    waiting?.({ value: undefined, done: true });
    waiting = null;
  };
  const query: IdleQuery = {
    initializationResult: vi.fn().mockResolvedValue({
      account: {},
      models: GLM_PROBE_MODELS,
    }),
    applyFlagSettings: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(() => endStream()),
    getContextUsage: vi.fn().mockResolvedValue(null),
    interrupt: vi.fn(async () => endStream()),
    setModel: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    emit: (message) => {
      if (waiting === null) {
        queue.push(message);
        return;
      }
      waiting({ value: message, done: false });
      waiting = null;
    },
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (ended) return Promise.resolve({ value: undefined, done: true });
          return new Promise<IteratorResult<unknown>>((resolve) => {
            waiting = resolve;
          });
        },
        return: async () => ({ value: undefined, done: true as const }),
      };
    },
  };
  createdQueries.push(query);
  return query;
}

function lastQueryOptions(): Record<string, unknown> {
  const call: unknown = queryMock.mock.calls.at(-1)?.[0];
  if (
    typeof call !== "object" ||
    call === null ||
    !("options" in call) ||
    typeof call.options !== "object" ||
    call.options === null
  ) {
    throw new Error("Expected Claude SDK query options");
  }
  return { ...call.options };
}

function lastQueryEnv(): Record<string, string | undefined> {
  const env = lastQueryOptions().env;
  if (typeof env !== "object" || env === null) {
    throw new Error("Expected Claude SDK query env");
  }
  return { ...env };
}

function writeToken(content: string, mode = 0o600): void {
  writeFileSync(tokenFile, content);
  chmodSync(tokenFile, mode);
}

function tokenProviderOptions(
  overrides: Record<string, JsonValue> = {},
): Record<string, JsonValue> {
  return {
    claudeAuthTokenFile: tokenFile,
    claudeEnv: GLM_ENV,
    ...overrides,
  };
}

function options(
  providerOptions: Record<string, JsonValue> | undefined,
  extra: Record<string, JsonValue> = {},
): Record<string, JsonValue> {
  return {
    permissionMode: "accept-edits",
    permissionScope: "workspace",
    approvalReviewer: "user",
    permissionEscalation: "ask",
    instructions: "test",
    ...extra,
    providerOptions: { workflowsEnabled: false, ...providerOptions },
  };
}

function startParams(
  threadId: string,
  providerOptions: Record<string, JsonValue> | undefined,
  extra: Record<string, JsonValue> = {},
): Record<string, JsonValue> {
  return {
    cwd: "/tmp/worktree",
    instructionMode: "append",
    options: options(providerOptions, extra),
    threadId,
  };
}

function turnParams(
  threadId: string,
  providerOptions?: Record<string, JsonValue>,
  extra: Record<string, JsonValue> = {},
): Record<string, JsonValue> {
  return {
    threadId,
    providerThreadId: threadId,
    clientRequestId: "creq_abcdefghjk",
    input: [{ type: "text", text: "hi" }],
    options: options(providerOptions, extra),
  };
}

async function loadBridge() {
  vi.resetModules();
  const { handleLine } = await import("../bridge.js");
  return createBridgeJsonRpcTestHarness(handleLine);
}

async function startThread(
  bridge: Awaited<ReturnType<typeof loadBridge>>,
  id: number,
  threadId: string,
  providerOptions:
    | Record<string, JsonValue>
    | undefined = tokenProviderOptions(),
  extra: Record<string, JsonValue> = {},
) {
  bridge.sendRequest(
    id,
    "thread/start",
    startParams(threadId, providerOptions, extra),
  );
  return bridge.waitForResponse(id);
}

async function startTurn(
  bridge: Awaited<ReturnType<typeof loadBridge>>,
  id: number,
  threadId: string,
  providerOptions?: Record<string, JsonValue>,
  extra: Record<string, JsonValue> = {},
) {
  bridge.sendRequest(
    id,
    "turn/start",
    turnParams(threadId, providerOptions, extra),
  );
  return bridge.waitForResponse(id);
}

describe("bridge token profiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cliState.installed = true;
    savedEnv = { ...process.env };
    for (const key of AMBIENT_KEYS) process.env[key] = `ambient-${key}`;
    process.env.CLAUDE_CONFIG_DIR = "/ambient/config";
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = "ambient-sonnet";
    process.env.HTTPS_PROXY = "http://proxy.test:3128";
    tempDir = mkdtempSync(join(tmpdir(), "bb-token-profile-"));
    userHome = mkdtempSync(join(tmpdir(), "bb-token-profile-home-"));
    vi.stubEnv("HOME", userHome);
    tokenFile = join(tempDir, "glm.token");
    writeToken(`${TOKEN}\n`);
    received = [];
    settingsSnapshots = [];
    preexistingSettingsDirs = new Set(
      readdirSync(tmpdir()).filter((entry) =>
        entry.startsWith("bb-claude-token-settings-"),
      ),
    );
    createdQueries = [];
    contextQueryMock.mockImplementation(() => ({
      initializationResult: vi.fn().mockResolvedValue({}),
      mcpServerStatus: vi.fn().mockResolvedValue([]),
      getContextUsage: vi.fn().mockResolvedValue(null),
      close: vi.fn(),
    }));
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: readonly string[],
        _options: object,
        callback: (error: Error | null) => void,
      ) => callback(new Error("keychain item not found")),
    );
    queryMock.mockImplementation(
      ({
        prompt,
        options,
      }: {
        prompt?: AsyncIterable<unknown>;
        options?: unknown;
      }) => {
        snapshotSettingsFile(options);
        if (prompt !== undefined) {
          void (async () => {
            for await (const message of prompt) received.push(message);
          })();
        }
        return createIdleQuery();
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(userHome, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    rmSync(tempDir, { recursive: true, force: true });
    for (const entry of readdirSync(tmpdir())) {
      if (
        entry.startsWith("bb-claude-token-settings-") &&
        !preexistingSettingsDirs.has(entry)
      ) {
        rmSync(join(tmpdir(), entry), { recursive: true, force: true });
      }
    }
  });

  describe("adoption", () => {
    it("adopts the profile from a thread/start and builds the session env in order", async () => {
      const bridge = await loadBridge();
      expect((await startThread(bridge, 1, "t1")).error).toBeUndefined();
      await startTurn(bridge, 2, "t1");

      const env = lastQueryEnv();
      expect(env).toMatchObject({ ...GLM_ENV, ANTHROPIC_AUTH_TOKEN: TOKEN });
      expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
      expect(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBeUndefined();
      expect(env.HTTPS_PROXY).toBe("http://proxy.test:3128");
    });

    it("adopts the profile from a first model/list", async () => {
      const bridge = await loadBridge();
      bridge.sendRequest(1, "model/list", {
        providerOptions: tokenProviderOptions(),
      });
      expect((await bridge.waitForResponse(1)).error).toBeUndefined();

      expect(lastQueryEnv()).toMatchObject({
        ...GLM_ENV,
        ANTHROPIC_AUTH_TOKEN: TOKEN,
      });
    });

    it("adopts the profile from a first provider/health", async () => {
      const bridge = await loadBridge();
      bridge.sendRequest(1, "provider/health", {
        providerId: PROVIDER_ID,
        providerOptions: tokenProviderOptions(),
      });
      const response = await bridge.waitForResponse(1);

      expect(response.result).toMatchObject({
        health: { status: "ready", loginCommand: null },
      });
      expect(process.env.CLAUDE_CONFIG_DIR).toBeUndefined();
    });

    it("drops ambient and project ANTHROPIC_ variables and the config dir, keeping the profile's", async () => {
      const bridge = await loadBridge();
      await startThread(bridge, 1, "t1", tokenProviderOptions(), {
        envVars: {
          ANTHROPIC_BASE_URL: "https://project.example",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "project-opus",
          ANTHROPIC_AUTH_TOKEN: "project-token",
          ANTHROPIC_API_KEY: "project-key",
          ANTHROPIC_FUTURE_ROUTING: "x",
          CLAUDE_CONFIG_DIR: "/project/config",
          KEEP_ME: "1",
        },
      });
      await startTurn(bridge, 2, "t1");

      const env = lastQueryEnv();
      expect(env.ANTHROPIC_BASE_URL).toBe(GLM_ENV.ANTHROPIC_BASE_URL);
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe(
        GLM_ENV.ANTHROPIC_DEFAULT_OPUS_MODEL,
      );
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(
        GLM_ENV.ANTHROPIC_DEFAULT_SONNET_MODEL,
      );
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe(TOKEN);
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_FUTURE_ROUTING).toBeUndefined();
      expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
      expect(env.KEEP_ME).toBe("1");
    });

    it("keeps the bridge's own process.env free of the profile env, the token and the config dir", async () => {
      const bridge = await loadBridge();
      await startThread(bridge, 1, "t1");
      await startTurn(bridge, 2, "t1");

      for (const key of [
        ...AMBIENT_KEYS,
        "CLAUDE_CONFIG_DIR",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "API_TIMEOUT_MS",
      ]) {
        expect(process.env[key]).toBeUndefined();
      }
      expect(process.env.HTTPS_PROXY).toBe("http://proxy.test:3128");
    });

    it("rejects a disallowed claudeEnv key on the bridge side without spawning", async () => {
      const bridge = await loadBridge();
      bridge.sendRequest(1, "model/list", {
        providerOptions: tokenProviderOptions({
          claudeEnv: { ...GLM_ENV, ANTHROPIC_API_KEY: "secret" },
        }),
      });
      const response = await bridge.waitForResponse(1);

      expect(response.error?.message).toContain("ANTHROPIC_API_KEY");
      expect(queryMock).not.toHaveBeenCalled();
      expect(process.env.ANTHROPIC_API_KEY).toBe("ambient-ANTHROPIC_API_KEY");
    });

    it("fails a later request with a different profile and accepts a reordered one", async () => {
      const bridge = await loadBridge();
      await startThread(bridge, 1, "t1");
      const reordered = Object.fromEntries(Object.entries(GLM_ENV).reverse());
      bridge.sendRequest(2, "model/list", {
        providerOptions: tokenProviderOptions({ claudeEnv: reordered }),
      });
      expect((await bridge.waitForResponse(2)).error).toBeUndefined();
      bridge.sendRequest(3, "model/list", {
        providerOptions: tokenProviderOptions({
          claudeEnv: { ...GLM_ENV, API_TIMEOUT_MS: "1" },
        }),
      });

      expect((await bridge.waitForResponse(3)).error?.message).toContain(
        "cannot switch",
      );
    });
  });

  describe("permission modes", () => {
    interface PermissionModeCase {
      label: string;
      providerOptions: Record<string, JsonValue>;
      extra: Record<string, JsonValue>;
      expected: string;
    }
    const cases: PermissionModeCase[] = [
      {
        label: "plan",
        providerOptions: { claudeCodePermissionMode: "plan" },
        extra: {},
        expected: "plan",
      },
      {
        label: "acceptEdits",
        providerOptions: {},
        extra: {},
        expected: "acceptEdits",
      },
      {
        label: "bypassPermissions",
        providerOptions: {},
        extra: {
          permissionMode: "full",
          permissionScope: "full",
          approvalReviewer: null,
          permissionEscalation: null,
        },
        expected: "bypassPermissions",
      },
    ];
    it.each(cases)(
      "keeps the requested $label mode",
      async ({ providerOptions, extra, expected }) => {
        const bridge = await loadBridge();
        await startThread(
          bridge,
          1,
          "t1",
          tokenProviderOptions(providerOptions),
          extra,
        );
        await startTurn(bridge, 2, "t1");

        expect(lastQueryOptions().permissionMode).toBe(expected);
      },
    );
  });

  describe("flag settings", () => {
    it("pins the profile env, an empty apiKeyHelper and the transport keys in a private 0600 settings file for the session", async () => {
      const bridge = await loadBridge();
      await startThread(bridge, 1, "t1");
      await startTurn(bridge, 2, "t1");

      const snapshot = lastSettingsSnapshot();
      expect(snapshot.mode).toBe(0o600);
      expect(snapshot.dirMode & 0o077).toBe(0);
      expect(snapshot.content).toMatchObject({
        apiKeyHelper: "",
        env: {
          ...GLM_ENV,
          HTTPS_PROXY: "http://proxy.test:3128",
          HTTP_PROXY: "",
          NODE_EXTRA_CA_CERTS: "",
          ANTHROPIC_AUTH_TOKEN: TOKEN,
        },
      });
      const options = lastQueryOptions();
      expect(options.settings).toBe(snapshot.path);
      expect(
        JSON.stringify({
          ...options,
          env: undefined,
          abortController: undefined,
        }),
      ).not.toContain(TOKEN);
      expect(JSON.stringify(options.extraArgs)).not.toContain(TOKEN);
      expect(options.settingSources).toEqual(["user", "project", "local"]);
    });

    it("pins the same settings for the model probe and removes the file afterwards", async () => {
      const bridge = await loadBridge();
      bridge.sendRequest(1, "model/list", {
        providerOptions: tokenProviderOptions(),
      });
      await bridge.waitForResponse(1);

      const snapshot = lastSettingsSnapshot();
      expect(snapshot.mode).toBe(0o600);
      expect(snapshot.dirMode & 0o077).toBe(0);
      expect(snapshot.content).toMatchObject({
        apiKeyHelper: "",
        env: {
          ...GLM_ENV,
          HTTPS_PROXY: "http://proxy.test:3128",
          ANTHROPIC_AUTH_TOKEN: TOKEN,
        },
      });
      expect(lastQueryOptions().settingSources).toEqual([
        "user",
        "project",
        "local",
      ]);
      expect(existsSync(snapshot.path)).toBe(false);
    });

    it("removes the probe's settings file when the probe fails", async () => {
      queryMock.mockImplementation(({ options }: { options?: unknown }) => {
        snapshotSettingsFile(options);
        return {
          initializationResult: vi.fn().mockRejectedValue(new Error("boom")),
          close: vi.fn(),
        };
      });
      const bridge = await loadBridge();
      bridge.sendRequest(1, "model/list", {
        providerOptions: tokenProviderOptions(),
      });
      const response = await bridge.waitForResponse(1);

      expect(response.error?.message).toContain("boom");
      expect(existsSync(lastSettingsSnapshot().path)).toBe(false);
    });

    it("removes the session's settings file when the thread is discarded", async () => {
      const bridge = await loadBridge();
      await startThread(bridge, 1, "t1");
      await startTurn(bridge, 2, "t1");
      const { path } = lastSettingsSnapshot();
      expect(existsSync(path)).toBe(true);

      bridge.sendRequest(3, "thread/discard", {
        threadId: "t1",
        providerThreadId: "t1",
      });
      await bridge.waitForResponse(3);

      expect(existsSync(path)).toBe(false);
    });

    it("writes a new settings file with the rotated token for a newly started thread", async () => {
      const bridge = await loadBridge();
      await startThread(bridge, 1, "t1");
      await startTurn(bridge, 2, "t1");
      const first = lastSettingsSnapshot();

      writeToken("rotated-token-value\n");
      await startThread(bridge, 3, "t2");
      await startTurn(bridge, 4, "t2");
      const second = lastSettingsSnapshot();

      expect(second.path).not.toBe(first.path);
      expect(second.content).toMatchObject({
        env: { ANTHROPIC_AUTH_TOKEN: "rotated-token-value" },
      });
      expect(first.content).toMatchObject({
        env: { ANTHROPIC_AUTH_TOKEN: TOKEN },
      });
    });

    it("keeps passing the settings object, with no file, for a login profile", async () => {
      const bridge = await loadBridge();
      await startThread(bridge, 1, "t1", {
        claudeConfigDir: join(tempDir, "login"),
      });
      await startTurn(bridge, 2, "t1");

      expect(settingsSnapshots).toEqual([]);
      expect(lastQueryOptions().settings).toEqual({
        autoMemoryEnabled: true,
        enableWorkflows: false,
        ultracode: false,
        fastMode: false,
      });
    });
  });

  describe("model list", () => {
    it("lists only the profile's models from the probe", async () => {
      const bridge = await loadBridge();
      bridge.sendRequest(1, "model/list", {
        providerOptions: tokenProviderOptions(),
      });
      const response = await bridge.waitForResponse(1);

      expect(response.result).toMatchObject({
        models: [
          { model: "glm-5.3[1m]", isDefault: true },
          { model: "glm-5.3-flashx[1m]", isDefault: false },
          { model: "glm-5.3-flash[1m]", isDefault: false },
        ],
        selectedOnlyModels: [
          { model: "opus" },
          { model: "sonnet" },
          { model: "haiku" },
        ],
      });
    });

    it("serves a warm memo only while the token file is still valid", async () => {
      const bridge = await loadBridge();
      bridge.sendRequest(1, "model/list", {
        providerOptions: tokenProviderOptions(),
      });
      expect((await bridge.waitForResponse(1)).error).toBeUndefined();
      expect(queryMock).toHaveBeenCalledTimes(1);

      bridge.sendRequest(2, "model/list", {});
      expect((await bridge.waitForResponse(2)).error).toBeUndefined();
      expect(queryMock).toHaveBeenCalledTimes(1);

      chmodSync(tokenFile, 0o644);
      bridge.sendRequest(3, "model/list", {});
      const refused = await bridge.waitForResponse(3);

      expect(refused.error?.message).toContain("has mode 0644");
      expect(queryMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("fail closed", () => {
    const breakers: [string, () => void, string][] = [
      ["missing", () => rmSync(tokenFile), "does not exist"],
      ["empty", () => writeToken(""), "is empty"],
      ["newline-only", () => writeToken("\n"), "is empty"],
      ["mode 0644", () => chmodSync(tokenFile, 0o644), "has mode 0644"],
      [
        "symlinked",
        () => {
          const real = join(tempDir, "real.token");
          writeFileSync(real, `${TOKEN}\n`, { mode: 0o600 });
          rmSync(tokenFile);
          symlinkSync(real, tokenFile);
        },
        "is a symlink",
      ],
    ];

    it.each(breakers)(
      "refuses a %s token file for thread/start and model/list without spawning",
      async (_label, breakFile, fragment) => {
        breakFile();
        const bridge = await loadBridge();

        const started = await startThread(bridge, 1, "t1");
        bridge.sendRequest(2, "model/list", {});
        const listed = await bridge.waitForResponse(2);

        expect(started.error?.message).toContain(fragment);
        expect(listed.error?.message).toContain(fragment);
        expect(started.error?.message).toContain("Fix:");
        expect(queryMock).not.toHaveBeenCalled();
      },
    );

    it.each(breakers)(
      "refuses a fork over a %s token file before touching the existing session or the transcript",
      async (_label, breakFile, fragment) => {
        const bridge = await loadBridge();
        expect((await startThread(bridge, 1, "t1")).error).toBeUndefined();
        await startTurn(bridge, 2, "t1");
        const queriesBefore = queryMock.mock.results.map(
          (result) => result.value as ReturnType<typeof createIdleQuery>,
        );
        breakFile();

        bridge.sendRequest(3, "thread/fork", {
          ...startParams("t1", tokenProviderOptions()),
          sourceProviderThreadId: "source-session",
        });
        const refused = await bridge.waitForResponse(3);

        expect(refused.error?.message).toContain(fragment);
        expect(forkSessionMock).not.toHaveBeenCalled();
        expect(queryMock).toHaveBeenCalledTimes(queriesBefore.length);
        for (const query of queriesBefore) {
          expect(query.close).not.toHaveBeenCalled();
        }
      },
    );

    it("leaves an existing attachment usable after a refused fork", async () => {
      const bridge = await loadBridge();
      await startThread(bridge, 1, "t1");
      await startTurn(bridge, 2, "t1");
      const delivered = received.length;
      chmodSync(tokenFile, 0o644);

      bridge.sendRequest(3, "thread/fork", {
        ...startParams("t1", tokenProviderOptions()),
        sourceProviderThreadId: "source-session",
      });
      expect((await bridge.waitForResponse(3)).error).toBeDefined();
      const turn = await startTurn(bridge, 4, "t1");

      expect(turn.error).toBeUndefined();
      await vi.waitFor(() =>
        expect(received.length).toBeGreaterThan(delivered),
      );
      expect(forkSessionMock).not.toHaveBeenCalled();
    });

    it("forks normally when the token file is valid", async () => {
      forkSessionMock.mockResolvedValue("forked-session");
      const bridge = await loadBridge();

      bridge.sendRequest(1, "thread/fork", {
        ...startParams("t2", tokenProviderOptions()),
        sourceProviderThreadId: "source-session",
      });

      await expect(bridge.waitForResponse(1)).resolves.toMatchObject({
        result: { providerThreadId: "forked-session" },
      });
    });
  });

  describe("restarting an existing attachment", () => {
    const authFailureMessages = (sessionId: string) => [
      {
        type: "assistant",
        error: "authentication_failed",
        message: {
          id: "authentication-error-message",
          type: "message",
          role: "assistant",
          container: null,
          content: [
            { type: "text", text: "Failed to authenticate", citations: null },
          ],
          context_management: null,
          model: "<synthetic>",
          stop_details: null,
          stop_reason: "stop_sequence",
          stop_sequence: "",
          usage: resultUsage(),
        },
        parent_tool_use_id: null,
        uuid: "00000000-0000-4000-8000-000000000002",
        session_id: sessionId,
      },
      {
        type: "result",
        subtype: "error_during_execution",
        duration_ms: 0,
        duration_api_ms: 0,
        is_error: true,
        num_turns: 0,
        stop_reason: null,
        total_cost_usd: 0,
        usage: resultUsage(),
        modelUsage: {},
        permission_denials: [],
        errors: ["Failed to authenticate"],
        uuid: "00000000-0000-4000-8000-000000000003",
        session_id: sessionId,
      },
    ];

    function resultUsage() {
      return {
        cache_creation: {
          ephemeral_1h_input_tokens: 0,
          ephemeral_5m_input_tokens: 0,
        },
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        inference_geo: "",
        input_tokens: 0,
        iterations: [],
        output_tokens: 0,
        server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
        service_tier: "standard",
        speed: "standard",
      };
    }

    async function startedThread() {
      const bridge = await loadBridge();
      await startThread(bridge, 1, "t1");
      await startTurn(bridge, 2, "t1");
      return bridge;
    }

    it("uses a rotated token when the 1M-context toggle restarts the session", async () => {
      const bridge = await startedThread();
      writeToken("rotated-token-value\n");

      const turn = await startTurn(bridge, 3, "t1", { disable1MContext: true });

      expect(turn.error).toBeUndefined();
      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(createdQueries[0]?.close).toHaveBeenCalled();
      expect(lastQueryEnv().ANTHROPIC_AUTH_TOKEN).toBe("rotated-token-value");
      expect(lastSettingsSnapshot().content).toMatchObject({
        env: { ANTHROPIC_AUTH_TOKEN: "rotated-token-value" },
      });
    });

    it("uses a rotated token when an authentication failure restarts the session", async () => {
      const bridge = await startedThread();
      for (const message of authFailureMessages("t1")) {
        createdQueries[0]?.emit(message);
      }
      await bridge.flushWork();
      writeToken("rotated-token-value\n");

      const turn = await startTurn(bridge, 3, "t1");

      expect(turn.error).toBeUndefined();
      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(lastQueryEnv().ANTHROPIC_AUTH_TOKEN).toBe("rotated-token-value");
      expect(lastSettingsSnapshot().content).toMatchObject({
        env: { ANTHROPIC_AUTH_TOKEN: "rotated-token-value" },
      });
    });

    it.each([
      ["deleted", () => rmSync(tokenFile), "does not exist"],
      ["mode 0644", () => chmodSync(tokenFile, 0o644), "has mode 0644"],
      ["empty", () => writeToken(""), "is empty"],
    ])(
      "refuses a restart over a %s token file, spawns nothing and keeps the session",
      async (_label, breakFile, fragment) => {
        const bridge = await startedThread();
        breakFile();

        const refused = await startTurn(bridge, 3, "t1", {
          disable1MContext: true,
        });

        expect(refused.error?.message).toContain(fragment);
        expect(queryMock).toHaveBeenCalledTimes(1);
        expect(createdQueries[0]?.close).not.toHaveBeenCalled();

        writeToken("repaired-token-value\n");
        const repaired = await startTurn(bridge, 4, "t1", {
          disable1MContext: true,
        });

        expect(repaired.error).toBeUndefined();
        expect(queryMock).toHaveBeenCalledTimes(2);
        expect(lastQueryEnv().ANTHROPIC_AUTH_TOKEN).toBe(
          "repaired-token-value",
        );
      },
    );

    it("rebuilds the transport pins from the user settings when the session restarts", async () => {
      mkdirSync(join(userHome, ".claude"));
      const userSettings = join(userHome, ".claude", "settings.json");
      writeFileSync(
        userSettings,
        JSON.stringify({ env: { HTTPS_PROXY: "http://first-proxy.test:1" } }),
      );
      const bridge = await startedThread();
      expect(lastSettingsSnapshot().content).toMatchObject({
        env: { HTTPS_PROXY: "http://first-proxy.test:1" },
      });

      writeFileSync(
        userSettings,
        JSON.stringify({
          env: {
            HTTPS_PROXY: "http://second-proxy.test:2",
            NODE_EXTRA_CA_CERTS: "/etc/corp-ca.pem",
          },
        }),
      );
      const turn = await startTurn(bridge, 3, "t1", {
        disable1MContext: true,
      });

      expect(turn.error).toBeUndefined();
      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(lastSettingsSnapshot().content).toMatchObject({
        apiKeyHelper: "",
        env: {
          ...GLM_ENV,
          HTTPS_PROXY: "http://second-proxy.test:2",
          NODE_EXTRA_CA_CERTS: "/etc/corp-ca.pem",
          ANTHROPIC_AUTH_TOKEN: TOKEN,
        },
      });
    });

    it("does not record a changed envVars signature while the token file is broken", async () => {
      const bridge = await startedThread();
      chmodSync(tokenFile, 0o644);
      const changed = { envVars: { PROJECT_FLAG: "on" } };

      const refused = await startTurn(bridge, 3, "t1", undefined, changed);

      expect(refused.error?.message).toContain("has mode 0644");
      expect(queryMock).toHaveBeenCalledTimes(1);

      chmodSync(tokenFile, 0o600);
      const retried = await startTurn(bridge, 4, "t1", undefined, changed);

      expect(retried.error).toBeUndefined();
      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(lastQueryEnv().PROJECT_FLAG).toBe("on");
    });
  });

  describe("rotation", () => {
    it("picks up a rotated token on the next session without a bridge restart", async () => {
      const bridge = await loadBridge();
      await startThread(bridge, 1, "t1");
      await startTurn(bridge, 2, "t1");
      expect(lastQueryEnv().ANTHROPIC_AUTH_TOKEN).toBe(TOKEN);

      writeToken("rotated-token-value\n");
      await startThread(bridge, 3, "t2");
      await startTurn(bridge, 4, "t2");

      expect(lastQueryEnv().ANTHROPIC_AUTH_TOKEN).toBe("rotated-token-value");
    });
  });

  describe("health and usage", () => {
    async function health(
      bridge: Awaited<ReturnType<typeof loadBridge>>,
      id: number,
      providerOptions: Record<string, JsonValue> = tokenProviderOptions(),
    ) {
      bridge.sendRequest(id, "provider/health", {
        providerId: PROVIDER_ID,
        providerOptions,
      });
      return bridge.waitForResponse(id);
    }

    it("is ready when the token file is valid and names the file, with no keychain call", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const bridge = await loadBridge();

      const first = await health(bridge, 1);

      expect(first.result).toMatchObject({
        supported: true,
        health: {
          status: "ready",
          accountEmail: null,
          planLabel: null,
          loginCommand: null,
          statusMessage: expect.stringContaining(tokenFile),
        },
      });
      expect(execFileMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reports usage with one quota fetch carrying the raw token", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(USAGE_OK_BODY), { status: 200 }),
        );
      vi.stubGlobal("fetch", fetchMock);
      const bridge = await loadBridge();

      await health(bridge, 1);
      bridge.sendRequest(2, "provider/usage", { providerId: PROVIDER_ID });
      const usage = await bridge.waitForResponse(2);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        URL,
        RequestInit,
      ];
      expect(String(url)).toBe(
        "https://api.z.ai/api/monitor/usage/quota/limit",
      );
      expect(init.headers).toEqual({
        Authorization: TOKEN,
        Accept: "application/json",
      });
      expect(init.redirect).toBe("error");
      expect(usage.result).toMatchObject({
        supported: true,
        usage: {
          status: "ok",
          accountEmail: null,
          planLabel: "GLM Coding Max",
          plan: null,
          accountKey: null,
          windows: [
            {
              kind: "five-hour",
              label: "Five-hour limit",
              usedPercent: 0,
              resetsAt: null,
            },
            {
              kind: "weekly",
              label: "Weekly limit",
              usedPercent: 29,
              resetsAt: new Date(1793089363976).toISOString(),
            },
          ],
        },
      });
      expect(execFileMock).not.toHaveBeenCalled();
    });

    it("reports the CLI as not installed before looking at the token file", async () => {
      cliState.installed = false;
      rmSync(tokenFile);
      const bridge = await loadBridge();

      const response = await health(bridge, 1);

      expect(response.result).toMatchObject({
        health: { status: "not_installed", loginCommand: null },
      });
      expect(execFileMock).not.toHaveBeenCalled();
    });

    it("stays ready when asked twice on one bridge", async () => {
      const bridge = await loadBridge();

      const first = await health(bridge, 1);
      const second = await health(bridge, 2);

      expect(first.result).toMatchObject({ health: { status: "ready" } });
      expect(second.result).toMatchObject({ health: { status: "ready" } });
    });

    it.each([
      ["missing", () => rmSync(tokenFile), /does not exist.*chmod 600/su],
      ["empty", () => writeToken(""), /is empty/u],
      [
        "too permissive",
        () => chmodSync(tokenFile, 0o644),
        /has mode 0644.*run chmod 600 /su,
      ],
      [
        "a symlink",
        () => {
          const real = join(tempDir, "real.token");
          writeFileSync(real, `${TOKEN}\n`, { mode: 0o600 });
          rmSync(tokenFile);
          symlinkSync(real, tokenFile);
        },
        /is a symlink.*point authTokenFile at the real file/su,
      ],
    ])(
      "reports unauthenticated for %s with the failing check and fix",
      async (_label, breakFile, message) => {
        breakFile();
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const bridge = await loadBridge();

        const response = await health(bridge, 1);

        expect(response.result).toMatchObject({
          health: {
            status: "unauthenticated",
            statusMessage: expect.stringMatching(message),
            loginCommand: null,
          },
        });
        expect(execFileMock).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it("reports usage from the first request even before any thread has adopted the profile", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(USAGE_OK_BODY), { status: 200 }),
        );
      vi.stubGlobal("fetch", fetchMock);
      const bridge = await loadBridge();

      bridge.sendRequest(1, "provider/usage", {
        providerId: PROVIDER_ID,
        providerOptions: tokenProviderOptions(),
      });
      const usage = await bridge.waitForResponse(1);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(usage.result).toMatchObject({
        supported: true,
        usage: { status: "ok", planLabel: "GLM Coding Max" },
      });
      expect(execFileMock).not.toHaveBeenCalled();
    });
  });
});
