import { afterAll, describe, expect, it, vi } from "vitest";
import { Agent } from "undici";
import { createServerClient, type FetchFn } from "./server-client.js";

const agentConstructions = vi.hoisted(() =>
  vi.fn<(options: unknown, instance: unknown) => void>(),
);

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    Agent: class extends actual.Agent {
      constructor(options?: ConstructorParameters<typeof actual.Agent>[0]) {
        super(options);
        agentConstructions(options, this);
      }
    },
  };
});

afterAll(async () => {
  for (const [, instance] of agentConstructions.mock.calls) {
    if (instance instanceof Agent) await instance.close();
  }
});

function createLogger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe("tool-call transport timeout", () => {
  it("allows every forwarded tool call to hold the response open", async () => {
    const seen: Array<{ tool: string; hasDispatcher: boolean }> = [];
    const dispatchers: unknown[] = [];
    const fetchFn = vi.fn<FetchFn>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { tool: string };
      const dispatcher =
        init && "dispatcher" in init ? init.dispatcher : undefined;
      seen.push({
        tool: body.tool,
        hasDispatcher: dispatcher instanceof Agent,
      });
      dispatchers.push(dispatcher);
      return Response.json({ success: true, contentItems: [] });
    });
    const client = createServerClient({
      fetchFn,
      getSessionId: () => "session-1",
      hostKey: "key",
      logger: createLogger(),
      serverUrl: "http://localhost",
    });
    const base = {
      requestId: 1,
      threadId: "thread",
      providerThreadId: "provider-thread",
      turnId: "turn",
      callId: "call",
    };
    await expect(
      client.callTool({ ...base, tool: "AskUserQuestion" }),
    ).resolves.toMatchObject({ success: true, contentItems: [] });
    await expect(
      client.callTool({ ...base, tool: "Bash" }),
    ).resolves.toMatchObject({ success: true, contentItems: [] });
    expect(seen).toEqual([
      { tool: "AskUserQuestion", hasDispatcher: true },
      { tool: "Bash", hasDispatcher: true },
    ]);
    expect(dispatchers[0]).toBe(dispatchers[1]);
    expect(agentConstructions).toHaveBeenCalledWith(
      {
        headersTimeout: 65 * 60 * 1000,
        bodyTimeout: 65 * 60 * 1000,
      },
      dispatchers[0],
    );
  });

  it("leaves unrelated manifest requests on their existing transport", async () => {
    const treeHash = "a".repeat(64);
    const seen: unknown[] = [];
    const fetchFn = vi.fn<FetchFn>(async (_input, init) => {
      seen.push(init && "dispatcher" in init ? init.dispatcher : undefined);
      return Response.json({ treeHash, files: [] });
    });
    const client = createServerClient({
      fetchFn,
      getSessionId: () => "session-1",
      hostKey: "key",
      logger: createLogger(),
      serverUrl: "http://localhost",
    });
    await expect(client.fetchSkillTreeManifest(treeHash)).resolves.toEqual({
      treeHash,
      files: [],
    });
    expect(seen).toEqual([undefined]);
  });

  it("preserves forwarded tool transport failures and HTTP errors", async () => {
    const failure = new Error("tool transport unavailable");
    const fetchFn = vi
      .fn<FetchFn>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(
        Response.json(
          { code: "invalid_request", message: "Tool denied" },
          { status: 403 },
        ),
      );
    const client = createServerClient({
      fetchFn,
      getSessionId: () => "session-1",
      hostKey: "key",
      logger: createLogger(),
      serverUrl: "http://localhost",
    });
    const request = {
      requestId: 1,
      threadId: "thread",
      providerThreadId: "provider-thread",
      turnId: "turn",
      callId: "call",
      tool: "Bash",
    };
    await expect(client.callTool(request)).rejects.toBe(failure);
    await expect(client.callTool(request)).rejects.toMatchObject({
      status: 403,
      code: "invalid_request",
      retryable: false,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
