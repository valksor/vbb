import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPEN_IN_TARGET_RUN_COMMAND_DISABLED_ERROR_CODE,
  createHostDaemonLocalClient,
  type WorkspaceOpenTarget,
} from "@bb/host-daemon-contract";
import { removeStaleTerminalRunCommandDirs } from "./local-api.fork.js";
import { startLocalApiServer, type LocalApiServer } from "./local-api.js";
import type { HostDaemonLocalApiConfig } from "./local-api-config.js";

describe("local API server", () => {
  let server: LocalApiServer | null = null;

  function createLocalApiConfig(
    overrides: Partial<HostDaemonLocalApiConfig> = {},
  ): HostDaemonLocalApiConfig {
    return {
      bindHost: "localhost",
      healthPath: "/health",
      healthValue: "ok",
      port: 0,
      ...overrides,
    };
  }

  afterEach(async () => {
    await server?.close();
    server = null;
    vi.useRealTimers();
  });

  it("passes commands through for local opens and rejects remote SSH commands", async () => {
    const openInTarget = vi.fn(async () => undefined);
    server = await startLocalApiServer({
      hostId: "host-1",
      localApiConfig: createLocalApiConfig(),
      serverUrl: "http://server.test",
      serverPort: 3334,
      devAppPort: 5173,
      getConnected: () => true,
      openInTarget,
    });
    const client = createHostDaemonLocalClient(
      `http://localhost:${server.port}`,
    );

    await client["open-in-target"].$post({
      json: {
        context: { kind: "local" },
        columnNumber: null,
        command: "echo one\necho two",
        language: "bash",
        lineNumber: null,
        path: tmpdir(),
        targetId: "terminal",
      },
    });
    expect(openInTarget).toHaveBeenCalledWith({
      columnNumber: null,
      command: "echo one\necho two",
      context: { kind: "local" },
      language: "bash",
      lineNumber: null,
      path: tmpdir(),
      targetId: "terminal",
    });

    const remoteResponse = await client["open-in-target"].$post({
      json: {
        context: {
          kind: "remote-ssh",
          serverOrigin: "https://bb.example.test",
          hostId: "host_1",
        },
        columnNumber: null,
        command: "echo hi",
        lineNumber: null,
        path: "/home/me/project",
        targetId: "terminal",
      },
    });
    expect(remoteResponse.status).toBe(400);
    expect(await remoteResponse.text()).toContain("cannot run commands");
    expect(openInTarget).toHaveBeenCalledTimes(1);
  });

  it("rejects commands and hides the runCommand capability when the gate is off", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-run-command-off-"));
    await writeFile(
      path.join(dataDir, "client.json"),
      JSON.stringify({ runCommandEnabled: false, servers: {} }),
      "utf8",
    );
    const targets: WorkspaceOpenTarget[] = [
      {
        capabilities: {
          openDirectory: true,
          openFile: true,
          openFileAtLine: true,
          runCommand: true,
        },
        id: "terminal",
        label: "Terminal",
      },
    ];
    const listWorkspaceOpenTargets = vi.fn(async () => targets);
    const openInTarget = vi.fn(async () => undefined);

    try {
      server = await startLocalApiServer({
        dataDir,
        hostId: "host-1",
        localApiConfig: createLocalApiConfig(),
        serverUrl: "http://server.test",
        serverPort: 3334,
        devAppPort: 5173,
        getConnected: () => true,
        listWorkspaceOpenTargets,
        openInTarget,
      });
      const client = createHostDaemonLocalClient(
        `http://localhost:${server.port}`,
      );

      const targetsResponse = await client["workspace-open-targets"].$get({
        query: {},
      });
      expect((await targetsResponse.json()).targets[0]?.capabilities).toEqual({
        openDirectory: true,
        openFile: true,
        openFileAtLine: true,
      });

      const commandResponse = await client["open-in-target"].$post({
        json: {
          context: { kind: "local" },
          columnNumber: null,
          command: "echo hi",
          lineNumber: null,
          path: tmpdir(),
          targetId: "terminal",
        },
      });
      expect(commandResponse.status).toBe(400);
      expect(await commandResponse.json()).toEqual({
        code: OPEN_IN_TARGET_RUN_COMMAND_DISABLED_ERROR_CODE,
        message: expect.stringMatching(/runCommandEnabled/u),
      });
      expect(openInTarget).not.toHaveBeenCalled();

      await client["open-in-target"].$post({
        json: {
          context: { kind: "local" },
          columnNumber: null,
          lineNumber: null,
          path: tmpdir(),
          targetId: "terminal",
        },
      });
      expect(openInTarget).toHaveBeenCalledTimes(1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails the run-command gate closed when the client config cannot be parsed", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-run-command-bad-"));
    await writeFile(
      path.join(dataDir, "client.json"),
      JSON.stringify({ runCommandEnabled: "yes", servers: {} }),
      "utf8",
    );
    const targets: WorkspaceOpenTarget[] = [
      {
        capabilities: {
          openDirectory: true,
          openFile: true,
          openFileAtLine: true,
          runCommand: true,
        },
        id: "terminal",
        label: "Terminal",
      },
    ];
    const listWorkspaceOpenTargets = vi.fn(async () => targets);
    const openInTarget = vi.fn(async () => undefined);

    try {
      server = await startLocalApiServer({
        dataDir,
        hostId: "host-1",
        localApiConfig: createLocalApiConfig(),
        serverUrl: "http://server.test",
        serverPort: 3334,
        devAppPort: 5173,
        getConnected: () => true,
        listWorkspaceOpenTargets,
        openInTarget,
      });
      const client = createHostDaemonLocalClient(
        `http://localhost:${server.port}`,
      );

      const targetsResponse = await client["workspace-open-targets"].$get({
        query: {},
      });
      expect(
        (await targetsResponse.json()).targets[0]?.capabilities,
      ).not.toHaveProperty("runCommand");

      const commandResponse = await client["open-in-target"].$post({
        json: {
          context: { kind: "local" },
          columnNumber: null,
          command: "echo hi",
          lineNumber: null,
          path: tmpdir(),
          targetId: "terminal",
        },
      });
      expect(commandResponse.status).toBe(400);
      expect(await commandResponse.json()).toMatchObject({
        code: OPEN_IN_TARGET_RUN_COMMAND_DISABLED_ERROR_CODE,
      });

      await client["open-in-target"].$post({
        json: {
          context: { kind: "local" },
          columnNumber: null,
          lineNumber: null,
          path: tmpdir(),
          targetId: "terminal",
        },
      });
      expect(openInTarget).toHaveBeenCalledTimes(1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("logs command runs before the launch without command text or cwd", async () => {
    const runCommandLogger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    let loggedBeforeLaunch = false;
    const openInTarget = vi.fn(async () => {
      loggedBeforeLaunch = runCommandLogger.info.mock.calls.length > 0;
    });
    server = await startLocalApiServer({
      hostId: "host-1",
      localApiConfig: createLocalApiConfig(),
      logger: runCommandLogger,
      serverUrl: "http://server.test",
      serverPort: 3334,
      devAppPort: 5173,
      getConnected: () => true,
      openInTarget,
    });
    const command = "echo one\necho two";

    const response = await fetch(`http://localhost:${server.port}/open-in-target`, {
      body: JSON.stringify({
        context: { kind: "local" },
        columnNumber: null,
        command,
        lineNumber: null,
        path: tmpdir(),
        targetId: "terminal",
      }),
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3334",
      },
      method: "POST",
    });

    expect(response.ok).toBe(true);
    expect(loggedBeforeLaunch).toBe(true);
    expect(runCommandLogger.info).toHaveBeenCalledTimes(1);
    const [fields, message] = runCommandLogger.info.mock.calls[0] ?? [];
    expect(fields).toEqual({
      origin: "http://localhost:3334",
      scriptSha256: createHash("sha256").update(command, "utf8").digest("hex"),
      targetId: "terminal",
    });
    expect(message).toBe("Open in target command run");
    expect(JSON.stringify(runCommandLogger.info.mock.calls)).not.toContain(
      command,
    );
    expect(JSON.stringify(runCommandLogger.info.mock.calls)).not.toContain(
      tmpdir(),
    );
  });

  it("sweeps only stale bb-run directories older than 24 hours", async () => {
    const tmpDir = await mkdtemp(path.join(tmpdir(), "bb-run-sweep-"));
    const staleDir = path.join(tmpDir, "bb-run-stale");
    const freshDir = path.join(tmpDir, "bb-run-fresh");
    const otherDir = path.join(tmpDir, "other-stale");
    const staleFile = path.join(tmpDir, "bb-run-stale-file");
    await mkdir(staleDir, { recursive: true });
    await mkdir(freshDir, { recursive: true });
    await mkdir(otherDir, { recursive: true });
    await writeFile(staleFile, "x", "utf8");
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(staleDir, staleTime, staleTime);
    await utimes(otherDir, staleTime, staleTime);
    await utimes(staleFile, staleTime, staleTime);

    try {
      await removeStaleTerminalRunCommandDirs({ now: Date.now(), tmpDir });
      await expect(stat(staleDir)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(freshDir)).resolves.toBeDefined();
      await expect(stat(otherDir)).resolves.toBeDefined();
      await expect(stat(staleFile)).resolves.toBeDefined();

      await removeStaleTerminalRunCommandDirs({
        now: Date.now() + 25 * 60 * 60 * 1000,
        tmpDir,
      });
      await expect(stat(freshDir)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("sweeps a stale bb-run directory from the system temp dir on server startup", async () => {
    const staleDir = await mkdtemp(path.join(tmpdir(), "bb-run-stale-"));
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(staleDir, staleTime, staleTime);

    try {
      server = await startLocalApiServer({
        hostId: "host-1",
        localApiConfig: createLocalApiConfig(),
        serverUrl: "http://server.test",
        serverPort: 3334,
        getConnected: () => true,
      });

      await vi.waitFor(
        () =>
          expect(stat(staleDir)).rejects.toMatchObject({ code: "ENOENT" }),
        { timeout: 10_000 },
      );
    } finally {
      await rm(staleDir, { recursive: true, force: true });
    }
  });
});
