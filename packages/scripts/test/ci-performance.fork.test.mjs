import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";

const installDependencies = fileURLToPath(
  new URL(
    "../../../.github/actions/setup-workspace/install-dependencies.sh",
    import.meta.url,
  ),
);

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "bb-ci-install-stub-"));
  const bin = join(root, "bin");
  const npmStore = join(root, "npm-store");
  const pnpmStore = join(root, "pnpm-store");
  const home = join(root, "home");
  const npmConfig = join(root, "npmrc");
  const githubEnv = join(root, "github-env");
  const capture = join(root, "pnpm-capture.json");
  mkdirSync(bin);
  mkdirSync(home);
  mkdirSync(npmStore);
  mkdirSync(pnpmStore);
  writeFileSync(npmConfig, "");
  mkdirSync(join(root, ".turbo/cache"), { recursive: true });
  writeFileSync(join(npmStore, "sentinel"), "healthy npm store");
  writeFileSync(join(pnpmStore, "sentinel"), "healthy pnpm store");
  writeFileSync(join(root, ".turbo/cache/sentinel"), "healthy Turbo cache");
  const pnpm = join(bin, "pnpm");
  writeFileSync(
    pnpm,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(process.env.PNPM_CAPTURE_FILE, JSON.stringify({
  args: process.argv.slice(2),
  env: {
    npm_config_fetch_retries: process.env.npm_config_fetch_retries,
    npm_config_fetch_retry_maxtimeout: process.env.npm_config_fetch_retry_maxtimeout,
    npm_config_fetch_retry_mintimeout: process.env.npm_config_fetch_retry_mintimeout,
    npm_config_store_dir: process.env.npm_config_store_dir,
    pnpm_config_fetch_retries: process.env.pnpm_config_fetch_retries,
    pnpm_config_fetch_retry_maxtimeout: process.env.pnpm_config_fetch_retry_maxtimeout,
    pnpm_config_fetch_retry_mintimeout: process.env.pnpm_config_fetch_retry_mintimeout,
    pnpm_config_store_dir: process.env.pnpm_config_store_dir,
  },
}));
process.exit(Number(process.env.PNPM_STUB_EXIT || 0));
`,
  );
  chmodSync(pnpm, 0o755);
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    npmStore,
    pnpmStore,
    githubEnv,
    run({
      pnpmOutcome = "success",
      turboOutcome = "success",
      exitCode = 0,
      args = [],
    } = {}) {
      const result = spawnSync("bash", [installDependencies, ...args], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          HOME: home,
          npm_config_userconfig: npmConfig,
          npm_config_store_dir: npmStore,
          pnpm_config_store_dir: pnpmStore,
          GITHUB_ENV: githubEnv,
          GITHUB_STEP_SUMMARY: join(root, "summary.md"),
          PNPM_CAPTURE_FILE: capture,
          PNPM_STUB_EXIT: String(exitCode),
          PNPM_CACHE_RESTORE_OUTCOME: pnpmOutcome,
          RUNNER_TEMP: root,
          TURBO_CACHE_RESTORE_OUTCOME: turboOutcome,
        },
      });
      return {
        capture: JSON.parse(readFileSync(capture, "utf8")),
        result,
      };
    },
  };
}

it("stub preserves restore boundaries, retry environment, arguments, and pnpm failures", () => {
  const healthy = createFixture();
  const healthyResult = healthy.run({
    args: ["--ignore-scripts", "--offline"],
  });
  expect(healthyResult.result.status).toBe(0);
  expect(healthyResult.capture.args).toEqual([
    "install",
    "--frozen-lockfile",
    "--prefer-offline",
    "--fetch-timeout=30000",
    "--ignore-scripts",
    "--offline",
  ]);
  expect(healthyResult.capture.env).toMatchObject({
    npm_config_fetch_retries: "2",
    npm_config_fetch_retry_maxtimeout: "5000",
    npm_config_fetch_retry_mintimeout: "1000",
    npm_config_store_dir: healthy.npmStore,
    pnpm_config_fetch_retries: "2",
    pnpm_config_fetch_retry_maxtimeout: "5000",
    pnpm_config_fetch_retry_mintimeout: "1000",
    pnpm_config_store_dir: healthy.pnpmStore,
  });
  expect(existsSync(join(healthy.npmStore, "sentinel"))).toBe(true);
  expect(existsSync(join(healthy.pnpmStore, "sentinel"))).toBe(true);
  expect(existsSync(join(healthy.root, ".turbo/cache/sentinel"))).toBe(true);
  expect(existsSync(healthy.githubEnv)).toBe(false);

  const pnpmRestoreFailed = createFixture();
  const pnpmRestoreFailedResult = pnpmRestoreFailed.run({
    pnpmOutcome: "failure",
  });
  expect(pnpmRestoreFailedResult.result.status).toBe(0);
  expect(pnpmRestoreFailedResult.capture.env.npm_config_store_dir).not.toBe(
    pnpmRestoreFailed.npmStore,
  );
  expect(pnpmRestoreFailedResult.capture.env.pnpm_config_store_dir).toBe(
    pnpmRestoreFailedResult.capture.env.npm_config_store_dir,
  );
  expect(
    existsSync(pnpmRestoreFailedResult.capture.env.npm_config_store_dir),
  ).toBe(true);
  expect(
    readFileSync(pnpmRestoreFailed.githubEnv, "utf8").trim().split("\n"),
  ).toEqual([
    `npm_config_store_dir=${pnpmRestoreFailedResult.capture.env.npm_config_store_dir}`,
    `pnpm_config_store_dir=${pnpmRestoreFailedResult.capture.env.pnpm_config_store_dir}`,
  ]);
  expect(
    existsSync(join(pnpmRestoreFailed.root, ".turbo/cache/sentinel")),
  ).toBe(true);

  const turboRestoreFailed = createFixture();
  const turboRestoreFailedResult = turboRestoreFailed.run({
    turboOutcome: "failure",
  });
  expect(turboRestoreFailedResult.result.status).toBe(0);
  expect(turboRestoreFailedResult.capture.env.npm_config_store_dir).toBe(
    turboRestoreFailed.npmStore,
  );
  expect(turboRestoreFailedResult.capture.env.pnpm_config_store_dir).toBe(
    turboRestoreFailed.pnpmStore,
  );
  expect(existsSync(join(turboRestoreFailed.npmStore, "sentinel"))).toBe(true);
  expect(existsSync(join(turboRestoreFailed.pnpmStore, "sentinel"))).toBe(true);
  expect(
    existsSync(join(turboRestoreFailed.root, ".turbo/cache/sentinel")),
  ).toBe(false);
  expect(existsSync(turboRestoreFailed.githubEnv)).toBe(false);

  const pnpmFailed = createFixture();
  const pnpmFailedResult = pnpmFailed.run({ exitCode: 17 });
  expect(pnpmFailedResult.result.status).toBe(17);
  expect(pnpmFailedResult.capture.args).toEqual([
    "install",
    "--frozen-lockfile",
    "--prefer-offline",
    "--fetch-timeout=30000",
  ]);
  expect(existsSync(join(pnpmFailed.root, "summary.md"))).toBe(false);
});

it("isolates failed cache restores while preserving healthy caches through a real frozen install", ({
  skip,
}) => {
  if (process.env.BB_RUN_REAL_CI_INSTALL_FIXTURE !== "1") {
    return skip(
      "set BB_RUN_REAL_CI_INSTALL_FIXTURE=1 to run the real pnpm fixture",
    );
  }
  if (process.platform === "win32") {
    return skip("this fixture invokes pnpm through its POSIX executable");
  }
  const root = mkdtempSync(join(tmpdir(), "bb-ci-cache-fallback-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "package.json"),
    '{"name":"cache-fixture","private":true}',
  );
  const env = {
    ...process.env,
    npm_config_store_dir: join(root, "store"),
    pnpm_config_store_dir: join(root, "store"),
    GITHUB_STEP_SUMMARY: join(root, "summary.md"),
    GITHUB_ENV: join(root, "github-env"),
    RUNNER_TEMP: root,
  };
  const options = {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 30_000,
    stdio: "pipe",
  };
  execFileSync("pnpm", ["install", "--lockfile-only"], options);
  const store = execFileSync(
    "pnpm",
    ["store", "path", "--silent"],
    options,
  ).trim();
  mkdirSync(store, { recursive: true });
  mkdirSync(join(root, ".turbo/cache"), { recursive: true });
  const sentinels = [
    join(store, "partial"),
    join(root, ".turbo/cache/partial"),
  ];
  for (const file of sentinels) writeFileSync(file, "partial restore");
  const script = fileURLToPath(
    new URL(
      "../../../.github/actions/setup-workspace/install-dependencies.sh",
      import.meta.url,
    ),
  );
  execFileSync("bash", [script], {
    ...options,
    env: {
      ...env,
      PNPM_CACHE_RESTORE_OUTCOME: "success",
      TURBO_CACHE_RESTORE_OUTCOME: "success",
    },
  });
  expect(sentinels.map(existsSync)).toEqual([true, true]);
  execFileSync("bash", [script], {
    ...options,
    env: {
      ...env,
      PNPM_CACHE_RESTORE_OUTCOME: "failure",
      TURBO_CACHE_RESTORE_OUTCOME: "success",
    },
  });
  expect(sentinels.map(existsSync)).toEqual([true, true]);
  const fallback = Object.fromEntries(
    readFileSync(env.GITHUB_ENV, "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  expect(fallback.npm_config_store_dir).not.toBe(env.npm_config_store_dir);
  expect(fallback.pnpm_config_store_dir).toBe(fallback.npm_config_store_dir);
  expect(fallback.TURBO_CACHE_DIR).toBeUndefined();
  expect(existsSync(fallback.npm_config_store_dir)).toBe(true);
  const nextStore = execFileSync("pnpm", ["store", "path", "--silent"], {
    ...options,
    env: { ...env, ...fallback },
  }).trim();
  expect(nextStore.startsWith(fallback.npm_config_store_dir)).toBe(true);
  execFileSync("bash", [script], {
    ...options,
    env: {
      ...env,
      PNPM_CACHE_RESTORE_OUTCOME: "success",
      TURBO_CACHE_RESTORE_OUTCOME: "failure",
    },
  });
  expect(sentinels.map(existsSync)).toEqual([true, false]);
  expect(
    execFileSync("pnpm", ["store", "path", "--silent"], options).trim(),
  ).toBe(store);
}, 30_000);
