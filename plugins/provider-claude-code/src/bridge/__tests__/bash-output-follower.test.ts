import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClaudeBashOutputFollower,
  claudeCodeTempRoot,
  locateClaudeTaskOutputFile,
  locateClaudeTaskOutputFileSync,
} from "../bash-output-follower.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: vi.fn(actual.lstat),
    readdir: vi.fn(actual.readdir),
  };
});

const SESSION_ID = "6c1f0b7e-session";

describe("ClaudeBashOutputFollower", () => {
  let tempRoot: string;
  let tasksDir: string;
  let published: Array<[string, string]>;
  let follower: ClaudeBashOutputFollower;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "bb-bash-follower-"));
    tasksDir = join(tempRoot, "-Users-me-project", SESSION_ID, "tasks");
    published = [];
    follower = new ClaudeBashOutputFollower({
      tempRoot,
      pollIntervalMs: 5,
      publish: (toolUseId, text) => published.push([toolUseId, text]),
    });
  });

  afterEach(async () => {
    follower.stopAll();
    await rm(tempRoot, { recursive: true, force: true });
  });

  function outputFor(toolUseId: string): string {
    return published
      .filter(([id]) => id === toolUseId)
      .map(([, text]) => text)
      .join("");
  }

  it("streams appended output once the task file appears under any project dir", async () => {
    follower.follow({
      toolUseId: "toolu_1",
      taskId: "b1",
      sessionId: SESSION_ID,
    });
    await mkdir(tasksDir, { recursive: true });
    await writeFile(join(tasksDir, "b1.output"), "tick 1\n");
    await vi.waitFor(() => expect(outputFor("toolu_1")).toBe("tick 1\n"));

    await appendFile(join(tasksDir, "b1.output"), "tick 2\n");
    await vi.waitFor(() =>
      expect(outputFor("toolu_1")).toBe("tick 1\ntick 2\n"),
    );
  });

  it("keeps multi-byte characters intact across reads", async () => {
    await mkdir(tasksDir, { recursive: true });
    const path = join(tasksDir, "b2.output");
    const bytes = Buffer.from("ā✓", "utf8");
    await writeFile(path, bytes.subarray(0, 3));
    follower.follow({
      toolUseId: "toolu_2",
      taskId: "b2",
      sessionId: SESSION_ID,
    });
    await vi.waitFor(() => expect(outputFor("toolu_2")).toBe("ā"));
    await appendFile(path, bytes.subarray(3));
    await vi.waitFor(() => expect(outputFor("toolu_2")).toBe("ā✓"));
  });

  it("publishes nothing after the task is stopped", async () => {
    await mkdir(tasksDir, { recursive: true });
    const path = join(tasksDir, "b3.output");
    await writeFile(path, "before\n");
    follower.follow({
      toolUseId: "toolu_3",
      taskId: "b3",
      sessionId: SESSION_ID,
    });
    await vi.waitFor(() => expect(outputFor("toolu_3")).toBe("before\n"));

    follower.stopTask("b3");
    await appendFile(path, "after\n");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(outputFor("toolu_3")).toBe("before\n");
  });

  describe("output file resolution", () => {
    it("locates a regular tasks/<taskId>.output file", async () => {
      await mkdir(tasksDir, { recursive: true });
      await writeFile(join(tasksDir, "r1.output"), "x");
      await expect(
        locateClaudeTaskOutputFile({
          tempRoot,
          sessionId: SESSION_ID,
          taskId: "r1",
        }),
      ).resolves.toBe(join(tasksDir, "r1.output"));
    });

    it("rejects symlinks and directories, and returns undefined when absent", async () => {
      await mkdir(join(tasksDir, "dir.output"), { recursive: true });
      await writeFile(join(tempRoot, "elsewhere"), "secret");
      await symlink(join(tempRoot, "elsewhere"), join(tasksDir, "link.output"));
      for (const taskId of ["dir", "link", "missing"]) {
        await expect(
          locateClaudeTaskOutputFile({
            tempRoot,
            sessionId: SESSION_ID,
            taskId,
          }),
        ).resolves.toBeUndefined();
      }
    });

    describe("retries", () => {
      const fakeRoot = "/fake-claude-root";
      const fakeTasksDir = join(fakeRoot, "-proj", SESSION_ID, "tasks");
      let fileExists: boolean;
      let resolved: string[];
      let timed: ClaudeBashOutputFollower;

      function createFollower(
        options: Partial<
          ConstructorParameters<typeof ClaudeBashOutputFollower>[0]
        > = {},
      ): ClaudeBashOutputFollower {
        timed = new ClaudeBashOutputFollower({
          tempRoot: fakeRoot,
          resolveIntervalMs: 1,
          lateResolveIntervalMs: 5,
          publish: () => undefined,
          ...options,
        });
        return timed;
      }

      function resolve(taskId: string): void {
        timed.resolveOutputFile({ taskId, sessionId: SESSION_ID }, (path) =>
          resolved.push(path),
        );
      }

      beforeEach(async () => {
        const actual =
          await vi.importActual<typeof import("node:fs/promises")>(
            "node:fs/promises",
          );
        fileExists = false;
        resolved = [];
        vi.useFakeTimers();
        vi.mocked(readdir).mockImplementation((async (path: string) => {
          if (path === fakeRoot) return ["-proj"];
          if (path === fakeTasksDir) return fileExists ? ["t.output"] : [];
          return actual.readdir(path);
        }) as typeof readdir);
        vi.mocked(lstat).mockImplementation((async () => ({
          isFile: () => true,
        })) as unknown as typeof lstat);
      });

      afterEach(async () => {
        timed?.stopAll();
        vi.useRealTimers();
        const actual =
          await vi.importActual<typeof import("node:fs/promises")>(
            "node:fs/promises",
          );
        vi.mocked(readdir).mockImplementation(actual.readdir as typeof readdir);
        vi.mocked(lstat).mockImplementation(actual.lstat as typeof lstat);
      });

      it("resolves once the file appears within the initial window", async () => {
        createFollower();
        resolve("t");
        await vi.advanceTimersByTimeAsync(3);
        expect(resolved).toEqual([]);

        fileExists = true;
        await vi.advanceTimersByTimeAsync(2);

        expect(resolved).toEqual([join(fakeTasksDir, "t.output")]);
        expect(vi.getTimerCount()).toBe(0);
      });

      it("slows to the late interval after the initial window, then resolves", async () => {
        createFollower({ resolveIntervalMs: 1, lateResolveIntervalMs: 2_000 });
        resolve("t");
        await vi.advanceTimersByTimeAsync(100);
        fileExists = true;
        await vi.advanceTimersByTimeAsync(100);
        expect(resolved).toEqual([]);

        await vi.advanceTimersByTimeAsync(2_000);

        expect(resolved).toEqual([join(fakeTasksDir, "t.output")]);
      });

      it("stops late retries once the resolve window is spent", async () => {
        createFollower({ resolveWindowMs: 40 });
        resolve("t");
        await vi.advanceTimersByTimeAsync(200);
        expect(vi.getTimerCount()).toBe(0);

        fileExists = true;
        await vi.advanceTimersByTimeAsync(200);

        expect(resolved).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
      });

      it("cancels late retries when the task ends", async () => {
        createFollower();
        resolve("t");
        await vi.advanceTimersByTimeAsync(40);
        expect(vi.getTimerCount()).toBe(1);

        timed.cancelResolve("t");
        expect(vi.getTimerCount()).toBe(0);
        fileExists = true;
        await vi.advanceTimersByTimeAsync(100);

        expect(resolved).toEqual([]);
      });

      it("clears pending retries on stopAll", async () => {
        createFollower({ resolveIntervalMs: 20 });
        resolve("t");
        await vi.advanceTimersByTimeAsync(5);
        expect(vi.getTimerCount()).toBe(1);

        timed.stopAll();
        fileExists = true;
        await vi.advanceTimersByTimeAsync(200);

        expect(vi.getTimerCount()).toBe(0);
        expect(resolved).toEqual([]);
      });
    });

    it("locates a regular task output file synchronously and rejects links", async () => {
      await mkdir(tasksDir, { recursive: true });
      await writeFile(join(tasksDir, "s1.output"), "x");
      await mkdir(join(tasksDir, "sdir.output"));
      await writeFile(join(tempRoot, "elsewhere"), "secret");
      await symlink(
        join(tempRoot, "elsewhere"),
        join(tasksDir, "slink.output"),
      );
      const locate = (taskId: string) =>
        locateClaudeTaskOutputFileSync({
          tempRoot,
          sessionId: SESSION_ID,
          taskId,
        });

      expect(locate("s1")).toBe(join(tasksDir, "s1.output"));
      expect(locate("sdir")).toBeUndefined();
      expect(locate("slink")).toBeUndefined();
      expect(locate("missing")).toBeUndefined();
      expect(
        locateClaudeTaskOutputFileSync({
          tempRoot: join(tempRoot, "no-such-root"),
          sessionId: SESSION_ID,
          taskId: "s1",
        }),
      ).toBeUndefined();
    });
  });

  it("derives the per-uid temp root from CLAUDE_CODE_TMPDIR", () => {
    const uid = process.getuid?.() ?? 0;
    expect(claudeCodeTempRoot({ CLAUDE_CODE_TMPDIR: "/var/cc" })).toBe(
      `/var/cc/claude-${uid}`,
    );
    expect(claudeCodeTempRoot({})).toBe(`/tmp/claude-${uid}`);
  });
});
