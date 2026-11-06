import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGitSubdirectoryComparer,
  gitMirrorCacheDir,
  type GitSubdirectoryComparisonFailure,
} from "../../../src/services/plugins/git-subtree-mirror.js";
import {
  PluginInstallCancelledError,
  runCancellableInstall,
} from "../../../src/services/plugins/install-cancellation.js";
import { parsePluginSource } from "../../../src/services/plugins/install-sources.js";

vi.setConfig({ hookTimeout: 30_000, testTimeout: 120_000 });
const run = promisify(execFile);
async function git(cwd: string, args: string[]): Promise<string> {
  return (await run("git", args, { cwd })).stdout.trim();
}

describe("git subdirectory comparer failures", () => {
  const commit = "a".repeat(40);
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-subtree-mirror-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function comparison(url: string) {
    return {
      pluginId: "redaction",
      url,
      subdirectory: "plugins/y",
      fromCommit: commit,
      toCommit: "b".repeat(40),
      otherPluginRoots: [],
    };
  }

  it("reports a failure without the source url or its credentials", async () => {
    const failures: GitSubdirectoryComparisonFailure[] = [];
    const compare = createGitSubdirectoryComparer({
      dataDir,
      withLock: (_key, fn) => fn(),
      onFailure: (failure) => failures.push(failure),
    });
    const url = "https://user:s3cr3t@127.0.0.1:9/org/repo.git";

    await expect(compare(comparison(url))).resolves.toBe(false);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      pluginId: "redaction",
      repository: "127.0.0.1:9/org/repo",
      step: "mirror",
    });
    expect(JSON.stringify(failures)).not.toContain("s3cr3t");
    expect(JSON.stringify(failures)).not.toContain(url);
  });

  it("propagates a cancelled comparison without reporting a failure", async () => {
    const failures: GitSubdirectoryComparisonFailure[] = [];
    const compare = createGitSubdirectoryComparer({
      dataDir,
      withLock: (_key, fn) => fn(),
      onFailure: (failure) => failures.push(failure),
    });

    await expect(
      runCancellableInstall(AbortSignal.abort(), () =>
        compare(comparison("https://127.0.0.1:9/org/repo.git")),
      ),
    ).rejects.toBeInstanceOf(PluginInstallCancelledError);
    expect(failures).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "keeps the mirror when the install is cancelled during the health probe",
    async () => {
      const sourceRepo = join(dataDir, "source-repo");
      await mkdir(sourceRepo, { recursive: true });
      await git(sourceRepo, ["init", "-q", "-b", "main"]);
      await git(sourceRepo, ["config", "user.email", "test@example.com"]);
      await git(sourceRepo, ["config", "user.name", "Test"]);
      const commitFile = async (name: string): Promise<string> => {
        await mkdir(join(sourceRepo, "plugins", "y"), { recursive: true });
        await writeFile(join(sourceRepo, "plugins", "y", name), name);
        await git(sourceRepo, ["add", "-A"]);
        await git(sourceRepo, ["commit", "-qm", name]);
        return git(sourceRepo, ["rev-parse", "HEAD"]);
      };
      const first = await commitFile("a.txt");
      const second = await commitFile("b.txt");
      const failures: GitSubdirectoryComparisonFailure[] = [];
      const compare = createGitSubdirectoryComparer({
        dataDir,
        withLock: (_key, fn) => fn(),
        onFailure: (failure) => failures.push(failure),
      });
      const request = (toCommit: string) => ({
        pluginId: "probe",
        url: sourceRepo,
        subdirectory: "plugins/y",
        fromCommit: first,
        toCommit,
        otherPluginRoots: [],
      });
      await compare(request(second));
      const parsed = parsePluginSource(`git:${sourceRepo}`);
      if (parsed.kind !== "git") throw new Error("expected a git source");
      const mirrorDir = gitMirrorCacheDir(dataDir, parsed.cachePath);
      await stat(join(mirrorDir, "HEAD"));
      const third = await commitFile("c.txt");

      const shimDir = join(dataDir, "shim");
      const marker = join(shimDir, "probe-started");
      const realGit = (await run("which", ["git"])).stdout.trim();
      await mkdir(shimDir, { recursive: true });
      await writeFile(
        join(shimDir, "git"),
        [
          "#!/bin/sh",
          'for arg in "$@"; do',
          '  case "$arg" in',
          "    diff) exit 1;;",
          `    'HEAD^{commit}') : > '${marker}'; sleep 30; exit 1;;`,
          "  esac",
          "done",
          `exec '${realGit}' "$@"`,
          "",
        ].join("\n"),
      );
      await chmod(join(shimDir, "git"), 0o755);
      const originalPath = process.env.PATH;
      process.env.PATH = `${shimDir}:${originalPath}`;
      try {
        const controller = new AbortController();
        const pending = runCancellableInstall(controller.signal, () =>
          compare(request(third)),
        );
        await vi.waitFor(() => stat(marker), { timeout: 15_000 });
        controller.abort();
        await expect(pending).rejects.toBeInstanceOf(
          PluginInstallCancelledError,
        );
      } finally {
        process.env.PATH = originalPath;
      }

      expect(failures).toEqual([]);
      await stat(join(mirrorDir, "HEAD"));
    },
  );
});
