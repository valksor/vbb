import { acquireWorkQuiesceLease, listTerminalSessions } from "@bb/db";
import type { EnvironmentStatus } from "@bb/domain";
import {
  hostDaemonServerWsMessageSchema,
  type HostDaemonServerWsMessage,
} from "@bb/host-daemon-contract";
import { apiErrorSchema } from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";
import { WorkQuiesceService } from "../../src/services/system/work-quiesce.js";

interface FakeDaemonSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
  sentMessages: string[];
}

interface TerminalRouteFixture {
  environment: ReturnType<typeof seedEnvironment>;
  harness: TestAppHarness;
  host: ReturnType<typeof seedHost>;
  session: ReturnType<typeof seedHostSession>["session"];
  socket: FakeDaemonSocket;
  thread: ReturnType<typeof seedThread>;
}

type TestDb = TestAppHarness["db"];

function listTerminalSessionsByThread(db: TestDb, threadId: string) {
  return listTerminalSessions(db, {
    scope: { kind: "thread", threadId },
    visible: false,
  });
}

type TerminalOpenMessage = Extract<
  HostDaemonServerWsMessage,
  { type: "terminal.open" }
>;

interface PendingTerminalOpen {
  openMessage: TerminalOpenMessage;
  responsePromise: Promise<Response>;
}

interface CreateTerminalRouteFixtureArgs {
  environmentStatus?: EnvironmentStatus;
  terminalCloseTimeoutMs?: number;
  terminalOpenTimeoutMs?: number;
}

function createFakeDaemonSocket(): FakeDaemonSocket {
  const sentMessages: string[] = [];
  const closeSocket: FakeDaemonSocket["close"] = () => {};
  const sendSocketMessage: FakeDaemonSocket["send"] = (data) => {
    sentMessages.push(data);
  };
  return {
    close: vi.fn(closeSocket),
    send: vi.fn(sendSocketMessage),
    sentMessages,
  };
}

function readDaemonOperationMessages(
  socket: FakeDaemonSocket,
): HostDaemonServerWsMessage[] {
  return socket.sentMessages
    .map((message) =>
      hostDaemonServerWsMessageSchema.parse(JSON.parse(message)),
    )
    .filter(
      (message) =>
        message.type !== "machine-environment.replace" &&
        message.type !== "provider-session-policy.replace",
    );
}

async function waitForDaemonMessage(
  socket: FakeDaemonSocket,
  messageIndex = 0,
): Promise<HostDaemonServerWsMessage> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const message = readDaemonOperationMessages(socket)[messageIndex];
    if (message !== undefined) {
      return message;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for daemon message");
}

async function createTerminalRouteFixture(
  args: CreateTerminalRouteFixtureArgs = {},
): Promise<TerminalRouteFixture> {
  const harness = await createTestAppHarness({
    ...(args.terminalCloseTimeoutMs === undefined
      ? {}
      : { terminalCloseTimeoutMs: args.terminalCloseTimeoutMs }),
    ...(args.terminalOpenTimeoutMs === undefined
      ? {}
      : { terminalOpenTimeoutMs: args.terminalOpenTimeoutMs }),
  });
  const seeded = seedHostSession(harness.deps, { id: "terminal-host" });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: seeded.host.id,
    path: "/tmp/terminal-project",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: seeded.host.id,
    path: "/tmp/terminal-workspace",
    projectId: project.id,
    status: args.environmentStatus ?? "ready",
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "idle",
  });
  const socket = createFakeDaemonSocket();
  harness.hub.registerDaemon(seeded.session.id, seeded.host.id, socket);
  return {
    environment,
    harness,
    host: seeded.host,
    session: seeded.session,
    socket,
    thread,
  };
}

async function startPendingTerminalOpen(
  fixture: TerminalRouteFixture,
): Promise<PendingTerminalOpen> {
  const responsePromise = Promise.resolve(
    fixture.harness.app.request("/api/v1/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cols: 100,
        rows: 30,
        target: { kind: "thread", threadId: fixture.thread.id },
      }),
    }),
  );
  const openMessage = await waitForDaemonMessage(fixture.socket);
  if (openMessage.type !== "terminal.open") {
    throw new Error(`Expected terminal.open, received ${openMessage.type}`);
  }
  return {
    openMessage,
    responsePromise,
  };
}

function acknowledgeTerminalOpen(
  fixture: TerminalRouteFixture,
  openMessage: TerminalOpenMessage,
  initialCwd = "/tmp/terminal-workspace",
): void {
  fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
    hostId: fixture.host.id,
    sessionId: fixture.session.id,
    message: {
      type: "terminal.opened",
      requestId: openMessage.requestId,
      terminalId: openMessage.terminalId,
      shell: "/bin/zsh",
      title: "zsh",
      initialCwd,
      cols: 100,
      rows: 30,
    },
  });
}

describe("public terminal routes", () => {
  let harnesses: TestAppHarness[] = [];

  beforeEach(() => {
    harnesses = [];
  });

  afterEach(async () => {
    for (const harness of harnesses) {
      await harness.cleanup();
    }
  });

  it("rejects terminal creation when maintenance commits before the start", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    acquireWorkQuiesceLease(fixture.harness.db, {
      operationId: "update-1",
      ownerSecretHash: "owner-hash",
      reason: "VPS update",
      now: Date.now(),
      expiresAt: Date.now() + 60_000,
    });

    const response = await fixture.harness.app.request("/api/v1/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cols: 100,
        rows: 30,
        target: { kind: "thread", threadId: fixture.thread.id },
      }),
    });

    expect(response.status).toBe(503);
    expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
      code: "work_quiesced",
      retryable: true,
      details: { operationId: "update-1" },
    });
    expect(readDaemonOperationMessages(fixture.socket)).toEqual([]);
    expect(
      listTerminalSessionsByThread(fixture.harness.db, fixture.thread.id),
    ).toEqual([]);
  });

  it("reports a terminal start that commits before maintenance acquisition", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const pending = await startPendingTerminalOpen(fixture);
    const service = new WorkQuiesceService({
      db: fixture.harness.db,
      transport: {
        listConnectedHostIds: () => [],
        send: async () => {
          throw new Error("no host barrier is expected");
        },
      },
    });

    const acquired = await service.acquire({
      operationId: "update-1",
      ownerSecret: "owner-secret",
      reason: "VPS update",
      ttlMs: 60_000,
    });

    expect(acquired.activity.activeByKind).toMatchObject({ terminals: 1 });
    acknowledgeTerminalOpen(fixture, pending.openMessage);
    expect((await pending.responsePromise).status).toBe(201);
  });
});
