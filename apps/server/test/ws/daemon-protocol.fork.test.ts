import { afterEach, describe, expect, it, vi } from "vitest";
import { openDaemonSocketBehindMaintenanceGate } from "../../src/ws/daemon-protocol.fork.js";

vi.mock("../../src/internal/session-owner-side-effects.js", () => ({
  handleDaemonSocketOpened: vi.fn(),
}));

vi.mock("../../src/services/server-move/freeze-state.js", () => ({
  isServerMoveFrozen: () => true,
  isServerMoveSnapshotFenced: () => true,
}));

type GateDeps = Parameters<typeof openDaemonSocketBehindMaintenanceGate>[0];
type GateQuiesce = Parameters<typeof openDaemonSocketBehindMaintenanceGate>[2];
type GateSocket = Parameters<
  typeof openDaemonSocketBehindMaintenanceGate
>[1]["socket"];

function createGate(args: {
  applyToConnectingDaemon: () => Promise<boolean>;
  unregisterDaemon?: () => void;
}) {
  const hub = {
    registerDaemon: vi.fn(),
    markDaemonDispatchable: vi.fn(),
    unregisterDaemon: vi.fn(args.unregisterDaemon ?? (() => {})),
  };
  const logger = { error: vi.fn() };
  const socket = { close: vi.fn() };
  const sharedPorts = {
    pushCurrentSharedPortsForHost: vi.fn(),
    pushCurrentNextTunnelForHost: vi.fn(),
  };
  const deps = { hub, logger, sharedPorts } as unknown as GateDeps;
  const workQuiesce = {
    applyToConnectingDaemon: vi.fn(args.applyToConnectingDaemon),
  } as unknown as GateQuiesce;
  openDaemonSocketBehindMaintenanceGate(
    deps,
    {
      hostId: "host-1",
      sessionId: "session-1",
      socket: socket as unknown as GateSocket,
    },
    workQuiesce,
  );
  return { hub, logger, socket, sharedPorts };
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

describe("openDaemonSocketBehindMaintenanceGate", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };

  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    unhandled.length = 0;
  });

  it("unregisters, closes and logs once when the gate rejects", async () => {
    process.on("unhandledRejection", onUnhandled);
    const failure = new Error("gate down");
    const { hub, logger, socket } = createGate({
      applyToConnectingDaemon: () => Promise.reject(failure),
    });
    await settle();
    expect(hub.unregisterDaemon).toHaveBeenCalledWith("session-1");
    expect(socket.close).toHaveBeenCalledWith(1011, "maintenance-gate-failed");
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      { err: failure, hostId: "host-1" },
      "Daemon maintenance gate failed during registration",
    );
    expect(unhandled).toEqual([]);
  });

  it("logs the cleanup error instead of leaking an unhandled rejection", async () => {
    process.on("unhandledRejection", onUnhandled);
    const cleanupFailure = new Error("unregister failed");
    const { logger, socket } = createGate({
      applyToConnectingDaemon: () => Promise.reject(new Error("gate down")),
      unregisterDaemon: () => {
        throw cleanupFailure;
      },
    });
    await settle();
    expect(socket.close).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      { err: cleanupFailure, hostId: "host-1" },
      "Daemon maintenance gate failed during registration",
    );
    expect(unhandled).toEqual([]);
  });

  it("marks the daemon dispatchable without cleanup when the gate passes", async () => {
    process.on("unhandledRejection", onUnhandled);
    const { hub, logger, socket, sharedPorts } = createGate({
      applyToConnectingDaemon: () => Promise.resolve(false),
    });
    await settle();
    expect(hub.markDaemonDispatchable).toHaveBeenCalledWith("session-1");
    expect(sharedPorts.pushCurrentSharedPortsForHost).toHaveBeenCalledWith(
      "host-1",
    );
    expect(hub.unregisterDaemon).not.toHaveBeenCalled();
    expect(socket.close).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });
});
