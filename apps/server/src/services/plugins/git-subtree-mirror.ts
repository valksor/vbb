import { access, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  listInstalledPlugins,
  type DbConnection,
  type InstalledPluginRow,
  type PluginGitSelector,
} from "@bb/db";
import {
  isCommitSha,
  parsePluginSource,
  resolveInside,
  runInstallCommand,
} from "./install-sources.js";
import { PluginInstallCancelledError } from "./install-cancellation.js";

export function gitMirrorCacheDir(dataDir: string, cachePath: string): string {
  return resolveInside(
    join(dataDir, "plugins", "cache", "git-mirror"),
    [...cachePath.split("/"), "mirror.git"],
    "git mirror",
  );
}

interface GitSubdirectoryComparison {
  pluginId: string;
  url: string;
  subdirectory: string;
  fromCommit: string;
  toCommit: string;
  otherPluginRoots: string[];
}

interface ComparisonTrace {
  repository: string;
  step: string;
}

export interface GitSubdirectoryComparisonFailure extends ComparisonTrace {
  pluginId: string;
  detail: string;
}

const MAX_GIT_LISTING_BYTES = 32 * 1024 * 1024;

function foreignPluginRoots(
  subdirectory: string,
  otherPluginRoots: string[],
): string[] {
  const roots = otherPluginRoots.filter(
    (root) =>
      root !== subdirectory &&
      !subdirectory.startsWith(`${root}/`) &&
      !root.startsWith(`${subdirectory}/`),
  );
  return [...new Set(roots)].sort();
}

export function createGitSubdirectoryComparer(args: {
  dataDir: string;
  withLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  onFailure: (failure: GitSubdirectoryComparisonFailure) => void;
}) {
  const comparisons = new Map<string, boolean>();

  async function ensureMirror(url: string, mirrorDir: string): Promise<void> {
    const initialized = await access(join(mirrorDir, "HEAD")).then(
      () => true,
      () => false,
    );
    if (initialized) {
      await runInstallCommand("git", [
        "-C",
        mirrorDir,
        "remote",
        "set-url",
        "origin",
        url,
      ]);
      return;
    }
    await rm(mirrorDir, { recursive: true, force: true });
    await mkdir(dirname(mirrorDir), { recursive: true });
    try {
      await runInstallCommand("git", [
        "clone",
        "--bare",
        "--filter=blob:none",
        "--quiet",
        url,
        mirrorDir,
      ]);
    } catch (error: unknown) {
      await rm(mirrorDir, { recursive: true, force: true });
      throw error;
    }
  }

  async function hasCommit(
    mirrorDir: string,
    commit: string,
  ): Promise<boolean> {
    try {
      await runInstallCommand("git", [
        "-C",
        mirrorDir,
        "rev-parse",
        "--verify",
        "--quiet",
        `${commit}^{commit}`,
      ]);
      return true;
    } catch (error: unknown) {
      if (error instanceof PluginInstallCancelledError) throw error;
      return false;
    }
  }

  async function fetchMissing(
    mirrorDir: string,
    commits: string[],
  ): Promise<void> {
    const missing: string[] = [];
    for (const commit of commits) {
      if (!(await hasCommit(mirrorDir, commit))) missing.push(commit);
    }
    if (missing.length === 0) return;
    try {
      await runInstallCommand("git", [
        "-C",
        mirrorDir,
        "fetch",
        "--quiet",
        "--filter=blob:none",
        "origin",
        ...missing,
      ]);
    } catch {
      await runInstallCommand("git", [
        "-C",
        mirrorDir,
        "fetch",
        "--quiet",
        "--filter=blob:none",
        "origin",
        "+refs/heads/*:refs/heads/*",
      ]);
    }
  }

  async function objectType(
    mirrorDir: string,
    commit: string,
    subdirectory: string,
  ): Promise<string | null> {
    try {
      return await runInstallCommand("git", [
        "-C",
        mirrorDir,
        "cat-file",
        "-t",
        `${commit}:${subdirectory}`,
      ]);
    } catch (error: unknown) {
      if (error instanceof PluginInstallCancelledError) throw error;
      return null;
    }
  }

  async function subdirectoryUnchanged(
    mirrorDir: string,
    comparison: GitSubdirectoryComparison,
    trace: ComparisonTrace,
  ): Promise<boolean> {
    const { subdirectory, fromCommit, toCommit } = comparison;
    trace.step = "object-type";
    if (
      (await objectType(mirrorDir, fromCommit, subdirectory)) !== "tree" ||
      (await objectType(mirrorDir, toCommit, subdirectory)) !== "tree"
    ) {
      return false;
    }
    trace.step = "ls-tree";
    const listing = await runInstallCommand(
      "git",
      ["-C", mirrorDir, "ls-tree", "-r", "-z", `${toCommit}:${subdirectory}`],
      { maxStdoutBytes: MAX_GIT_LISTING_BYTES },
    );
    if (listing.split("\0").some((record) => record.startsWith("120000 "))) {
      return false;
    }
    trace.step = "diff";
    const changed = await runInstallCommand(
      "git",
      [
        "-C",
        mirrorDir,
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        fromCommit,
        toCommit,
      ],
      { maxStdoutBytes: MAX_GIT_LISTING_BYTES },
    );
    const roots = foreignPluginRoots(subdirectory, comparison.otherPluginRoots);
    return changed
      .split("\0")
      .filter((path) => path.length > 0)
      .every((path) => roots.some((root) => path.startsWith(`${root}/`)));
  }

  async function compare(
    comparison: GitSubdirectoryComparison,
    trace: ComparisonTrace,
  ): Promise<boolean> {
    const { url, subdirectory, fromCommit, toCommit } = comparison;
    if (!isCommitSha(fromCommit) || !isCommitSha(toCommit)) return false;
    const parsed = parsePluginSource(`git:${url}@${toCommit}`);
    if (parsed.kind !== "git") return false;
    trace.repository = parsed.cachePath;
    const key = JSON.stringify([
      url,
      subdirectory,
      fromCommit,
      toCommit,
      foreignPluginRoots(subdirectory, comparison.otherPluginRoots),
    ]);
    const mirrorDir = gitMirrorCacheDir(args.dataDir, parsed.cachePath);
    return args.withLock(mirrorDir, async () => {
      const cached = comparisons.get(key);
      if (cached !== undefined) return cached;
      try {
        trace.step = "mirror";
        await ensureMirror(url, mirrorDir);
        trace.step = "fetch";
        await fetchMissing(mirrorDir, [fromCommit, toCommit]);
        const unchanged = await subdirectoryUnchanged(
          mirrorDir,
          comparison,
          trace,
        );
        comparisons.set(key, unchanged);
        return unchanged;
      } catch (error: unknown) {
        if (
          !(error instanceof PluginInstallCancelledError) &&
          !(await hasCommit(mirrorDir, "HEAD"))
        ) {
          await rm(mirrorDir, { recursive: true, force: true }).catch(() => {});
        }
        throw error;
      }
    });
  }

  return async (comparison: GitSubdirectoryComparison): Promise<boolean> => {
    const trace: ComparisonTrace = { repository: "", step: "parse" };
    try {
      return await compare(comparison, trace);
    } catch (error: unknown) {
      if (error instanceof PluginInstallCancelledError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      args.onFailure({
        ...trace,
        pluginId: comparison.pluginId,
        detail: message.replaceAll(comparison.url, trace.repository),
      });
      return false;
    }
  };
}

export function createUnchangedSubdirectoryCheck(args: {
  deps: {
    dataDir: string;
    db: DbConnection;
    logger: { warn(fields: object, message: string): void };
  };
  withLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
}) {
  const { deps } = args;
  const unchanged = createGitSubdirectoryComparer({
    dataDir: deps.dataDir,
    withLock: args.withLock,
    onFailure: (failure) =>
      deps.logger.warn(
        failure,
        "git subdirectory comparison failed; treating the plugin as changed",
      ),
  });
  return async (
    row: InstalledPluginRow,
    fromCommit: string,
    intent: { url: string; selector: PluginGitSelector },
    remote: { candidate: { version: string } },
  ): Promise<boolean> =>
    row.sourceGitSubdirectory !== null &&
    intent.selector.kind !== "range" &&
    intent.selector.refKind === "branch" &&
    (await unchanged({
      pluginId: row.id,
      url: intent.url,
      subdirectory: row.sourceGitSubdirectory,
      fromCommit,
      toCommit: remote.candidate.version,
      otherPluginRoots: listInstalledPlugins(deps.db).flatMap((other) =>
        other.sourceKind === "git" &&
        other.sourceGitUrl === intent.url &&
        other.sourceGitSubdirectory !== null
          ? [other.sourceGitSubdirectory]
          : [],
      ),
    }));
}
