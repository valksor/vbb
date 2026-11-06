import {
  createFakePluginHost,
  makeHostResponse,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import plugin from "./server.js";
import { rpcContract } from "./contracts.js";

async function setup() {
  const worker = vi.fn(
    async ({
      method,
    }: {
      method: string;
      hostId: string;
      signal?: AbortSignal;
    }): Promise<unknown> =>
      method === "run"
        ? { text: "done", images: [], exitCode: 0 }
        : method === "prepare"
          ? { status: "ready", version: "1.0.0-test", source: "release" }
          : null,
  );
  const host = createFakePluginHost({
    pluginId: "browser-automation",
    agentSkillIds: ["browser-automation"],
    experimental_callHostRpc: worker,
  });
  host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: "thread-test" }),
  );
  host.harness.sdk.stub("hosts.list", async () => [
    makeHostResponse({ id: "local-host", name: "Lab workstation" }),
    makeHostResponse({ id: "desktop-host", name: "Lab desktop" }),
  ]);
  await plugin(host.bb);
  return { ...host, worker };
}

describe("server session cleanup", () => {
  const ownedBy = (sessionId: string) => ({
    threadId: "thread-test",
    sessionId,
  });
  async function openLocal(
    h: Awaited<ReturnType<typeof setup>>,
    hostId = "local-host",
  ) {
    return rpcContract.open.output.parse(
      await h.harness.behavior.callRpc("open", {
        threadId: "thread-test",
        selection: { backend: "local", hostId },
      }),
    );
  }
  async function listed(h: Awaited<ReturnType<typeof setup>>, id: string) {
    const sessions = rpcContract.list.output.parse(
      await h.harness.behavior.callRpc("list", { threadId: "thread-test" }),
    );
    return sessions.find((entry) => entry.id === id);
  }
  const hostCalls = (h: Awaited<ReturnType<typeof setup>>, method: string) =>
    h.worker.mock.calls.filter(([call]) => call.method === method);

  it("keeps a healthy session running when saving its renewal fails", async () => {
    vi.useFakeTimers();
    const h = await setup();
    try {
      const session = await openLocal(h);
      vi.spyOn(h.bb.storage.kv, "set").mockRejectedValue(
        new Error("disk full"),
      );
      vi.setSystemTime(session.createdAt + 20 * 60_000);
      expect(
        await h.harness.behavior.callRpc("run", {
          ...ownedBy(session.id),
          script: "1",
        }),
      ).toMatchObject({ text: "done", exitCode: 0 });
      expect(hostCalls(h, "close")).toHaveLength(0);
      expect((await listed(h, session.id))?.state).toBe("ready");
      expect(
        h.harness.inspection.logEntries.filter(
          (entry) =>
            entry.level === "warn" &&
            entry.message.includes("renewal could not be saved: disk full"),
        ),
      ).toHaveLength(2);
    } finally {
      await h.harness.lifecycle.dispose();
      vi.useRealTimers();
    }
  });

  it("accepts a run on a busy session past its idle expiry and rejects it once idle", async () => {
    vi.useFakeTimers();
    const h = await setup();
    try {
      const session = await openLocal(h);
      const input = { ...ownedBy(session.id), script: "1" };
      let finishFirst!: () => void;
      let runs = 0;
      const started = new Promise<void>((resolve) => {
        h.worker.mockImplementation(async ({ method }) => {
          if (method !== "run") return null;
          if (runs++ === 0) {
            resolve();
            await new Promise<void>((done) => (finishFirst = done));
          }
          return { text: "done", images: [], exitCode: 0 };
        });
      });
      vi.setSystemTime(session.createdAt + 60_000);
      const first = h.harness.behavior.callRpc("run", input);
      await started;
      vi.setSystemTime(session.createdAt + 45 * 60_000);
      await h.harness.behavior.callRpc("run", input);
      expect((await listed(h, session.id))?.expiresAt).toBe(
        Date.now() + 30 * 60_000,
      );
      finishFirst();
      await first;
      vi.setSystemTime(Date.now() + 30 * 60_000);
      await expect(h.harness.behavior.callRpc("run", input)).rejects.toThrow(
        "Session stopped or expired",
      );
    } finally {
      await h.harness.lifecycle.dispose();
      vi.useRealTimers();
    }
  });

  it("does not let a stale post-restart run overwrite a record that cleanup closed", async () => {
    const h = await setup();
    let current = h;
    try {
      const session = await openLocal(h);
      vi.spyOn(h.bb.storage.kv, "set").mockResolvedValue(undefined);
      current = { ...h, ...(await h.harness.lifecycle.reload(plugin)) };
      const kv = current.bb.storage.kv;
      const realGet = kv.get.bind(kv);
      let releaseRead!: () => void;
      const gate = new Promise<void>((resolve) => (releaseRead = resolve));
      const read = vi.spyOn(kv, "get").mockImplementationOnce(async (key) => {
        const value = await realGet(key);
        await gate;
        return value;
      });
      const running = current.harness.behavior.callRpc("run", {
        ...ownedBy(session.id),
        script: "1",
      });
      await vi.waitFor(() => expect(read).toHaveBeenCalled());
      await current.harness.behavior.runService("restart-cleanup").done;
      releaseRead();
      await running;
      expect((await listed(current, session.id))?.state).toBe("closed");
    } finally {
      await current.harness.lifecycle.dispose();
    }
  });
});
