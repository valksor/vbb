import { Buffer } from "node:buffer";
import { threadScope, turnScope } from "@bb/domain";
import {
  backgroundTaskOutputResponseSchema,
  threadTimelineResponseSchema,
} from "@bb/server-contract";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  readBackgroundTaskOutput,
  type BackgroundTaskOutputChunkRequest,
  type ReadBackgroundTaskOutputChunk,
} from "../../src/services/threads/background-task-output.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThread, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const ITEM_ID = "task-item-1";
const FAMILY_ID = "bbuild1";
const OUTPUT_FILE = `/tmp/claude-501/-proj/session-1/tasks/${FAMILY_ID}.output`;
const COMMAND = "pnpm run build --watch";
const REVISION = "a".repeat(64);

type Fixture = ReturnType<typeof seedThreadFixture>;

interface SeedTaskArgs {
  taskType?: string;
  familyId?: string | null;
  outputFile?: string | null;
  command?: string;
  taskStatus?: "running" | "completed";
  sequence?: number;
}

function seedBashTask(
  harness: TestAppHarness,
  fixture: Fixture,
  args: SeedTaskArgs = {},
): void {
  const taskStatus = args.taskStatus ?? "running";
  const item = {
    type: "backgroundTask" as const,
    id: ITEM_ID,
    taskType: args.taskType ?? "local_bash",
    description: "Watch the build",
    ...(args.command === undefined ? {} : { command: args.command }),
    status:
      taskStatus === "running" ? ("pending" as const) : ("completed" as const),
    taskStatus,
    skipTranscript: false,
    foreground: false,
    ...(args.familyId === null ? {} : { familyId: args.familyId ?? FAMILY_ID }),
    ...(args.outputFile === null
      ? {}
      : { outputFile: args.outputFile ?? OUTPUT_FILE }),
  };
  const base = {
    threadId: fixture.thread.id,
    environmentId: fixture.environment.id,
    providerThreadId: "provider-thread-1",
  };
  seedEvent(harness.deps, {
    ...base,
    scope: turnScope("turn-1"),
    sequence: 1,
    type: "turn/started",
    data: {},
  });
  seedEvent(harness.deps, {
    ...base,
    scope: turnScope("turn-1"),
    sequence: 2,
    type: "item/started",
    data: { item: { ...item, status: "pending", taskStatus: "running" } },
  });
  seedEvent(harness.deps, {
    ...base,
    scope: turnScope("turn-1"),
    sequence: 3,
    type: "turn/completed",
    data: { status: "completed" },
  });
  seedEvent(harness.deps, {
    ...base,
    scope: threadScope(),
    sequence: args.sequence ?? 4,
    type:
      taskStatus === "running"
        ? "item/backgroundTask/progress"
        : "item/backgroundTask/completed",
    data: { item },
  });
}

function fakeFile(content: Buffer): {
  readChunk: ReadBackgroundTaskOutputChunk;
  requests: BackgroundTaskOutputChunkRequest[];
} {
  const requests: BackgroundTaskOutputChunkRequest[] = [];
  return {
    requests,
    readChunk: async (request) => {
      requests.push(request);
      const slice = content.subarray(
        request.offset,
        request.offset + request.length,
      );
      return {
        path: request.path,
        sizeBytes: content.length,
        modifiedAtMs: 1,
        mimeType: null,
        revision: REVISION,
        offset: request.offset,
        content: slice.toString("base64"),
      };
    },
  };
}

function failingReader(error: ApiError): ReadBackgroundTaskOutputChunk {
  return async () => {
    throw error;
  };
}

function apiError(code: string): ApiError {
  return new ApiError(502, code, `${code} from host`, false);
}

const sleepDelays: number[] = [];

async function recordSleep(ms: number): Promise<void> {
  sleepDelays.push(ms);
}

async function readOutput(
  harness: TestAppHarness,
  fixture: Fixture,
  readChunk: ReadBackgroundTaskOutputChunk,
  tailBytes = 64 * 1024,
) {
  return readBackgroundTaskOutput(harness.deps, {
    threadId: fixture.thread.id,
    itemId: ITEM_ID,
    tailBytes,
    readChunk,
    sleep: recordSleep,
  });
}

describe("background task output", () => {
  beforeEach(() => {
    sleepDelays.length = 0;
  });

  it("projects command and outputAvailable onto the active background command row", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture, { command: COMMAND });

      const response = await harness.app.request(
        `/api/v1/threads/${fixture.thread.id}/timeline`,
      );
      expect(response.status).toBe(200);
      const timeline = threadTimelineResponseSchema.parse(
        await readJson(response),
      );
      expect(timeline.activeBackgroundCommands).toHaveLength(1);
      const row = timeline.activeBackgroundCommands[0]!;
      expect(row).toMatchObject({
        itemId: ITEM_ID,
        command: COMMAND,
        outputAvailable: true,
      });
      expect(JSON.stringify(row)).not.toContain(OUTPUT_FILE);
    });
  });

  it("reports a missing command and output as null/false", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture, { outputFile: null });

      const response = await harness.app.request(
        `/api/v1/threads/${fixture.thread.id}/timeline`,
      );
      const timeline = threadTimelineResponseSchema.parse(
        await readJson(response),
      );
      expect(timeline.activeBackgroundCommands[0]).toMatchObject({
        command: null,
        outputAvailable: false,
      });
    });
  });

  it("returns the tail of an available file, reading from the tasks directory root", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture);
      const file = fakeFile(Buffer.from("tick 1\ntick 2\n"));

      const result = await readOutput(harness, fixture, file.readChunk);

      expect(result).toEqual({
        state: "available",
        text: "tick 1\ntick 2\n",
        truncated: false,
        totalBytes: 14,
      });
      expect(file.requests).toEqual([
        {
          path: OUTPUT_FILE,
          rootPath: "/tmp/claude-501/-proj/session-1/tasks",
          offset: 0,
          length: 0,
        },
        {
          path: OUTPUT_FILE,
          rootPath: "/tmp/claude-501/-proj/session-1/tasks",
          offset: 0,
          length: 14,
        },
      ]);
    });
  });

  it("serves finished tasks while the file still exists", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture, { taskStatus: "completed" });
      const result = await readOutput(
        harness,
        fixture,
        fakeFile(Buffer.from("done\n")).readChunk,
      );
      expect(result).toMatchObject({ state: "available", text: "done\n" });
    });
  });

  it("returns pending when the file is missing and the task is running", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture);
      await expect(
        readOutput(harness, fixture, failingReader(apiError("ENOENT"))),
      ).resolves.toEqual({
        state: "pending",
        text: "",
        truncated: false,
        totalBytes: 0,
      });
    });
  });

  it("returns unavailable when the file is missing and the task is terminal", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture, { taskStatus: "completed" });
      await expect(
        readOutput(harness, fixture, failingReader(apiError("ENOENT"))),
      ).resolves.toMatchObject({ state: "unavailable", text: "" });
    });
  });

  it("returns unavailable when the daemon rejects the path", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture);
      await expect(
        readOutput(harness, fixture, failingReader(apiError("invalid_path"))),
      ).resolves.toMatchObject({ state: "unavailable" });
    });
  });

  it.each(["EACCES", "EISDIR", "file_too_large", "host_exploded"])(
    "fails closed to unavailable on a daemon %s error",
    async (code) => {
      await withTestHarness(async (harness) => {
        const fixture = seedThreadFixture(harness);
        seedBashTask(harness, fixture);
        await expect(
          readOutput(harness, fixture, failingReader(apiError(code))),
        ).resolves.toEqual({
          state: "unavailable",
          text: "",
          truncated: false,
          totalBytes: 0,
        });
      });
    },
  );

  it.each([
    new ApiError(502, "host_unavailable", "Host is not connected", false),
    new ApiError(
      504,
      "command_timeout",
      "Timed out waiting for command result",
    ),
  ])("propagates transport error $body.code", async (error) => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture);
      await expect(
        readOutput(harness, fixture, failingReader(error)),
      ).rejects.toBe(error);
    });
  });

  it("returns empty text for a 0-byte file", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture);
      const file = fakeFile(Buffer.alloc(0));
      await expect(
        readOutput(harness, fixture, file.readChunk),
      ).resolves.toEqual({
        state: "available",
        text: "",
        truncated: false,
        totalBytes: 0,
      });
      expect(file.requests).toHaveLength(1);
    });
  });

  it("drops the partial first line of a truncated tail, including a split UTF-8 character", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture);
      const content = Buffer.from("héllo wörld\nsecond line\nthird line\n");
      const tailBytes = content.length - 2;
      expect(content.subarray(2, 3).toString("utf8")).toBe("�");

      const result = await readOutput(
        harness,
        fixture,
        fakeFile(content).readChunk,
        tailBytes,
      );

      expect(result).toEqual({
        state: "available",
        text: "second line\nthird line\n",
        truncated: true,
        totalBytes: content.length,
      });
    });
  });

  it("keeps a truncated tail as decoded when it has no newline in the first 1 KB", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture);
      const content = Buffer.from("héllo wörld without any newline at all");
      const tailBytes = content.length - 2;

      const result = await readOutput(
        harness,
        fixture,
        fakeFile(content).readChunk,
        tailBytes,
      );

      expect(result.truncated).toBe(true);
      expect(result.text).toBe(`�${content.subarray(3).toString("utf8")}`);
    });
  });

  it("keeps a complete first line when the tail starts exactly on a line boundary", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture);
      const content = Buffer.from("aaaa\nbbbb\ncccc\n");
      const file = fakeFile(content);

      const result = await readOutput(harness, fixture, file.readChunk, 10);

      expect(result).toEqual({
        state: "available",
        text: "bbbb\ncccc\n",
        truncated: true,
        totalBytes: content.length,
      });
      expect(file.requests.at(-1)).toMatchObject({ offset: 4, length: 11 });
    });
  });

  it("retries only the tail read with the known size after file_changed", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture);
      const file = fakeFile(Buffer.from("steady\n"));
      let failures = 4;
      const result = await readOutput(harness, fixture, async (request) => {
        if (request.length > 0 && failures > 0) {
          failures -= 1;
          throw apiError("file_changed");
        }
        return file.readChunk(request);
      });
      expect(result).toMatchObject({ state: "available", text: "steady\n" });
      expect(failures).toBe(0);
      expect(
        file.requests.filter((request) => request.length === 0),
      ).toHaveLength(1);
    });
  });

  it("re-reads the size when the file shrinks between the size read and the tail read", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture);
      const before = fakeFile(Buffer.from("aaaa\nbbbb\ncccc\n"));
      const after = fakeFile(Buffer.from("new\n"));
      let current = before;
      const result = await readOutput(harness, fixture, async (request) => {
        const served = await current.readChunk(request);
        if (request.length === 0) {
          current = after;
        }
        return served;
      });
      expect(result).toEqual({
        state: "available",
        text: "new\n",
        truncated: false,
        totalBytes: 4,
      });
      expect(before.requests).toHaveLength(1);
      expect(after.requests).toHaveLength(3);
      expect(sleepDelays).toHaveLength(1);
    });
  });

  it("retries file_changed and succeeds", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture);
      const file = fakeFile(Buffer.from("steady\n"));
      let failures = 2;
      const result = await readOutput(harness, fixture, async (request) => {
        if (failures > 0) {
          failures -= 1;
          throw apiError("file_changed");
        }
        return file.readChunk(request);
      });
      expect(result).toMatchObject({ state: "available", text: "steady\n" });
      expect(failures).toBe(0);
    });
  });

  it("returns busy once file_changed retries are exhausted", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      seedBashTask(harness, fixture);
      let calls = 0;
      const result = await readOutput(harness, fixture, async () => {
        calls += 1;
        throw apiError("file_changed");
      });
      expect(result).toEqual({
        state: "busy",
        text: "",
        truncated: false,
        totalBytes: 0,
      });
      expect(calls).toBe(5);
      expect(sleepDelays).toHaveLength(4);
      for (const delay of sleepDelays) {
        expect(delay).toBeGreaterThanOrEqual(25);
        expect(delay).toBeLessThanOrEqual(100);
      }
    });
  });

  describe("rejects tasks whose output cannot be trusted", () => {
    const cases: Array<[string, SeedTaskArgs]> = [
      ["non-local_bash task", { taskType: "local_agent" }],
      ["missing familyId", { familyId: null }],
      ["missing outputFile", { outputFile: null }],
      [
        "path with a .. segment",
        { outputFile: `/tmp/claude-501/../etc/tasks/${FAMILY_ID}.output` },
      ],
      [
        "path without a claude-<uid> temp root segment",
        { outputFile: `/tmp/other/-proj/session-1/tasks/${FAMILY_ID}.output` },
      ],
      [
        "POSIX path whose backslash segment would widen the tasks root",
        { outputFile: `/tmp/claude-1/x\\..\\tasks/${FAMILY_ID}.output` },
      ],
      [
        "Windows path with a .. segment",
        {
          outputFile: `C:\\Temp\\claude-501\\..\\tasks\\${FAMILY_ID}.output`,
        },
      ],
      [
        "path for a different task",
        { outputFile: "/tmp/claude-501/-proj/session-1/tasks/other.output" },
      ],
      [
        "path outside a tasks directory",
        { outputFile: `/tmp/claude-501/-proj/session-1/${FAMILY_ID}.output` },
      ],
      ["relative path", { outputFile: `tasks/${FAMILY_ID}.output` }],
    ];

    it.each(cases)("%s", async (_name, args) => {
      await withTestHarness(async (harness) => {
        const fixture = seedThreadFixture(harness);
        seedBashTask(harness, fixture, args);
        const file = fakeFile(Buffer.from("secret\n"));
        await expect(
          readOutput(harness, fixture, file.readChunk),
        ).resolves.toEqual({
          state: "unavailable",
          text: "",
          truncated: false,
          totalBytes: 0,
        });
        expect(file.requests).toEqual([]);
      });
    });

    it("an item id requested through a different thread", async () => {
      await withTestHarness(async (harness) => {
        const fixture = seedThreadFixture(harness);
        seedBashTask(harness, fixture);
        const otherThread = seedThread(harness.deps, {
          projectId: fixture.project.id,
          environmentId: fixture.environment.id,
        });
        const file = fakeFile(Buffer.from("secret\n"));
        await expect(
          readBackgroundTaskOutput(harness.deps, {
            threadId: otherThread.id,
            itemId: ITEM_ID,
            tailBytes: 64 * 1024,
            readChunk: file.readChunk,
          }),
        ).resolves.toMatchObject({ state: "unavailable", text: "" });
        expect(file.requests).toEqual([]);
      });
    });

    it("an unknown item id", async () => {
      await withTestHarness(async (harness) => {
        const fixture = seedThreadFixture(harness);
        const file = fakeFile(Buffer.from("secret\n"));
        await expect(
          readOutput(harness, fixture, file.readChunk),
        ).resolves.toMatchObject({ state: "unavailable" });
        expect(file.requests).toEqual([]);
      });
    });
  });

  it("accepts a Windows-style output path and reads from its directory", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness);
      const windowsFile = `C:\\Users\\dev\\AppData\\Local\\Temp\\claude-501\\proj\\tasks\\${FAMILY_ID}.output`;
      seedBashTask(harness, fixture, {
        taskStatus: "completed",
        outputFile: windowsFile,
      });
      const file = fakeFile(Buffer.from("win\n"));
      const result = await readOutput(harness, fixture, file.readChunk);
      expect(result).toMatchObject({ state: "available", text: "win\n" });
      expect(file.requests[0]).toMatchObject({
        path: windowsFile,
        rootPath: `C:\\Users\\dev\\AppData\\Local\\Temp\\claude-501\\proj\\tasks`,
      });
    });
  });

  describe("GET /threads/:id/background-tasks/:itemId/output", () => {
    it("returns unavailable for a thread without an environment", async () => {
      await withTestHarness(async (harness) => {
        const fixture = seedThreadFixture(harness);
        seedBashTask(harness, fixture);
        const detached = seedThread(harness.deps, {
          projectId: fixture.project.id,
          environmentId: null,
        });
        const response = await harness.app.request(
          `/api/v1/threads/${detached.id}/background-tasks/${ITEM_ID}/output`,
        );
        expect(response.status).toBe(200);
        expect(await readJson(response)).toMatchObject({
          state: "unavailable",
        });
      });
    });

    it("returns unavailable, not an error, when the thread has no environment and the item is unknown", async () => {
      await withTestHarness(async (harness) => {
        const fixture = seedThreadFixture(harness);
        const detached = seedThread(harness.deps, {
          projectId: fixture.project.id,
          environmentId: null,
        });
        const response = await harness.app.request(
          `/api/v1/threads/${detached.id}/background-tasks/missing/output`,
        );
        expect(response.status).toBe(200);
        expect(await readJson(response)).toMatchObject({
          state: "unavailable",
        });
      });
    });

    it("maps a host EACCES to unavailable", async () => {
      await withTestHarness(async (harness) => {
        const fixture = seedThreadFixture(harness);
        seedBashTask(harness, fixture);
        registerHostRpcResponder(harness, {
          hostId: fixture.host.id,
          sessionId: fixture.session.id,
          handle: (): HostRpcHandlerResult => ({
            ok: false,
            errorCode: "EACCES",
            errorMessage: "permission denied, open '/tmp/claude-501/secret'",
          }),
        });
        const response = await harness.app.request(
          `/api/v1/threads/${fixture.thread.id}/background-tasks/${ITEM_ID}/output`,
        );
        expect(response.status).toBe(200);
        const body = await response.text();
        expect(JSON.parse(body)).toMatchObject({ state: "unavailable" });
        expect(body).not.toContain("/tmp/claude-501");
      });
    });

    function serveFile(
      harness: TestAppHarness,
      fixture: Fixture,
      content: Buffer,
    ) {
      const file = fakeFile(content);
      const responder = registerHostRpcResponder(harness, {
        hostId: fixture.host.id,
        sessionId: fixture.session.id,
        handle: async (request): Promise<HostRpcHandlerResult> => {
          if (request.command.type !== "host.read_file_chunk") {
            throw new Error(`Unexpected command ${request.command.type}`);
          }
          return {
            ok: true,
            result: await file.readChunk({
              path: request.command.path,
              rootPath: request.command.rootPath,
              offset: request.command.offset,
              length: request.command.length,
            }),
          };
        },
      });
      return { file, responder };
    }

    it("reads through the host with revision null and the default tail size", async () => {
      await withTestHarness(async (harness) => {
        const fixture = seedThreadFixture(harness);
        seedBashTask(harness, fixture);
        const content = Buffer.from(`${"x".repeat(100)}\nlast line\n`);
        const { responder } = serveFile(harness, fixture, content);

        const response = await harness.app.request(
          `/api/v1/threads/${fixture.thread.id}/background-tasks/${ITEM_ID}/output`,
        );

        expect(response.status).toBe(200);
        expect(
          backgroundTaskOutputResponseSchema.parse(await readJson(response)),
        ).toEqual({
          state: "available",
          text: content.toString("utf8"),
          truncated: false,
          totalBytes: content.length,
        });
        expect(
          responder.requests.map((request) => request.command),
        ).toMatchObject([
          { type: "host.read_file_chunk", path: OUTPUT_FILE, revision: null },
          { type: "host.read_file_chunk", path: OUTPUT_FILE, revision: null },
        ]);
      });
    });

    it("honours tailBytes and clamps it to the maximum", async () => {
      await withTestHarness(async (harness) => {
        const fixture = seedThreadFixture(harness);
        seedBashTask(harness, fixture);
        const content = Buffer.from("aaaa\nbbbb\ncccc\n");
        serveFile(harness, fixture, content);

        const small = await harness.app.request(
          `/api/v1/threads/${fixture.thread.id}/background-tasks/${ITEM_ID}/output?tailBytes=8`,
        );
        expect(await readJson(small)).toEqual({
          state: "available",
          text: "cccc\n",
          truncated: true,
          totalBytes: content.length,
        });

        const huge = await harness.app.request(
          `/api/v1/threads/${fixture.thread.id}/background-tasks/${ITEM_ID}/output?tailBytes=999999999`,
        );
        expect(huge.status).toBe(200);
      });
    });

    it("rejects a zero tailBytes and an unknown thread", async () => {
      await withTestHarness(async (harness) => {
        const fixture = seedThreadFixture(harness);
        seedBashTask(harness, fixture);
        const zero = await harness.app.request(
          `/api/v1/threads/${fixture.thread.id}/background-tasks/${ITEM_ID}/output?tailBytes=0`,
        );
        expect(zero.status).toBe(400);
        const unknown = await harness.app.request(
          `/api/v1/threads/thr_missing/background-tasks/${ITEM_ID}/output`,
        );
        expect(unknown.status).toBe(404);
      });
    });

    it("maps a host ENOENT to pending for a running task", async () => {
      await withTestHarness(async (harness) => {
        const fixture = seedThreadFixture(harness);
        seedBashTask(harness, fixture);
        registerHostRpcResponder(harness, {
          hostId: fixture.host.id,
          sessionId: fixture.session.id,
          handle: (): HostRpcHandlerResult => ({
            ok: false,
            errorCode: "ENOENT",
            errorMessage: "Path does not exist",
          }),
        });
        const response = await harness.app.request(
          `/api/v1/threads/${fixture.thread.id}/background-tasks/${ITEM_ID}/output`,
        );
        expect(response.status).toBe(200);
        expect(await readJson(response)).toMatchObject({ state: "pending" });
      });
    });
  });
});
