import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fork-footprint.mjs",
);

function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "fork-footprint-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "--quiet", "--initial-branch=master");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  appendFileSync(
    path.join(dir, ".git", "info", "exclude"),
    "scripts/fork-copies.json\n",
  );
  return {
    dir,
    git,
    write(file, content) {
      const target = path.join(dir, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    },
    remove(file) {
      rmSync(path.join(dir, file));
    },
    commit(message) {
      git("add", "-A");
      git("commit", "--quiet", "-m", message);
      return git("rev-parse", "--short", "HEAD");
    },
    setCopies(content) {
      this.write("scripts/fork-copies.json", content);
    },
    run(...args) {
      return spawnSync("node", [script, ...args], {
        cwd: dir,
        encoding: "utf8",
      });
    },
    report(...args) {
      const result = this.run("--json", ...args);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    },
  };
}

function withRepo(body) {
  return () => {
    const repo = makeRepo();
    try {
      repo.setCopies("{}");
      body(repo);
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  };
}

test(
  "counts a modified file as added plus removed lines",
  withRepo((repo) => {
    repo.write("src/a.ts", "a\nb\nc\n");
    const base = repo.commit("base");
    repo.write("src/a.ts", "a\nB\nc\nd\n");
    repo.commit("fork");
    const report = repo.report("--base", base);
    assert.deepEqual(report.files, [
      { path: "src/a.ts", status: "M", added: 2, removed: 1, footprint: 3 },
    ]);
    assert.equal(report.total, 3);
    assert.equal(report.base, base);
  }),
);

test(
  "does not count a file the fork added",
  withRepo((repo) => {
    repo.write("src/a.ts", "a\n");
    const base = repo.commit("base");
    repo.write("src/new.ts", "1\n2\n3\n");
    repo.commit("fork");
    const report = repo.report("--base", base);
    assert.deepEqual(report.files, []);
    assert.equal(report.total, 0);
  }),
);

test(
  "does not count fork-owned files",
  withRepo((repo) => {
    repo.write("src/x.fork.ts", "a\n");
    repo.write("src/x.fork.test.ts", "a\n");
    repo.write("README.fork.md", "a\n");
    repo.write("packages/db/drizzle-fork/0001.sql", "a\n");
    repo.write("src/real.ts", "a\n");
    const base = repo.commit("base");
    repo.write("src/x.fork.ts", "b\n");
    repo.write("src/x.fork.test.ts", "b\n");
    repo.write("README.fork.md", "b\n");
    repo.write("packages/db/drizzle-fork/0001.sql", "b\n");
    repo.write("src/real.ts", "b\n");
    repo.commit("fork");
    const report = repo.report("--base", base);
    assert.deepEqual(
      report.files.map((file) => file.path),
      ["src/real.ts"],
    );
    assert.equal(report.total, 2);
  }),
);

test(
  "lists regenerated files separately and leaves them out of the total",
  withRepo((repo) => {
    repo.write("pnpm-lock.yaml", "a\n");
    repo.write("src/a.ts", "a\n");
    const base = repo.commit("base");
    repo.write("pnpm-lock.yaml", "a\nb\nc\n");
    repo.write("src/a.ts", "b\n");
    repo.commit("fork");
    const report = repo.report("--base", base);
    assert.deepEqual(report.regenerated, [
      { path: "pnpm-lock.yaml", status: "M", added: 2, removed: 0, footprint: 2 },
    ]);
    assert.deepEqual(
      report.files.map((file) => file.path),
      ["src/a.ts"],
    );
    assert.equal(report.total, 2);
  }),
);

test(
  "budget gate exits 1 only when the total is over the budget",
  withRepo((repo) => {
    repo.write("src/a.ts", "a\nb\nc\n");
    const base = repo.commit("base");
    repo.write("src/a.ts", "a\nB\nc\nd\n");
    repo.commit("fork");

    const above = repo.run("--base", base, "--budget", "4");
    assert.equal(above.status, 0);
    assert.match(above.stdout, /within budget/u);

    const equal = repo.run("--base", base, "--budget", "3");
    assert.equal(equal.status, 0);
    assert.match(equal.stdout, /within budget/u);

    const below = repo.run("--base", base, "--budget", "2");
    assert.equal(below.status, 1);
    assert.match(below.stdout, /over budget/u);

    assert.equal(repo.run("--base", base).status, 0);
  }),
);

test(
  "reports upstream commits that touch a copy after its recorded base",
  withRepo((repo) => {
    repo.write("plugins/tasks/a.ts", "1\n");
    repo.write("plugins/github/a.ts", "1\n");
    repo.write("other/b.ts", "1\n");
    const base = repo.commit("base");
    repo.write("plugins/tasks/a.ts", "2\n");
    repo.commit("touch tasks");
    repo.write("other/b.ts", "2\n");
    repo.commit("touch other");
    repo.git("update-ref", "refs/remotes/_get-bb/main", "HEAD");
    repo.setCopies(
      JSON.stringify({ "plugins/tasks": base, "plugins/github": base }),
    );

    const report = repo.report("--base", base);
    assert.deepEqual(
      report.drift["plugins/tasks"].map((entry) => entry.subject),
      ["touch tasks"],
    );
    assert.match(report.drift["plugins/tasks"][0].commit, /^[0-9a-f]+$/u);
    assert.deepEqual(report.drift["plugins/github"], []);

    const human = repo.run("--base", base);
    assert.equal(human.status, 0, human.stderr);
    assert.match(human.stdout, /touch tasks/u);
    assert.match(human.stdout, /no upstream commits/u);
  }),
);

test(
  "exits 2 when the copies file is missing, invalid, or names an unknown commit",
  withRepo((repo) => {
    repo.write("src/a.ts", "a\n");
    const base = repo.commit("base");

    repo.remove("scripts/fork-copies.json");
    assert.equal(repo.run("--base", base).status, 2);

    repo.setCopies("{not json");
    assert.equal(repo.run("--base", base).status, 2);

    repo.setCopies("[]");
    assert.equal(repo.run("--base", base).status, 2);

    repo.setCopies(JSON.stringify({ "plugins/tasks": 7 }));
    assert.equal(repo.run("--base", base).status, 2);

    repo.setCopies(JSON.stringify({ "plugins/tasks": "deadbeefdeadbeef" }));
    const unknown = repo.run("--base", base);
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /deadbeefdeadbeef/u);
  }),
);

test(
  "exits 2 without a stack trace when the upstream ref does not resolve",
  withRepo((repo) => {
    repo.write("plugins/a/a.ts", "1\n");
    const base = repo.commit("base");
    repo.setCopies(JSON.stringify({ "plugins/a": base }));
    const result = repo.run("--base", base);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /_get-bb\/main does not resolve/u);
    assert.doesNotMatch(result.stderr, / {4}at /u);
  }),
);

test(
  "exits 2 without a stack trace when --base does not resolve",
  withRepo((repo) => {
    repo.write("src/a.ts", "a\n");
    repo.commit("base");
    const result = repo.run("--base", "doesnotexist-ref");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /base doesnotexist-ref does not resolve/u);
    assert.doesNotMatch(result.stderr, / {4}at /u);
  }),
);

test(
  "rejects a ref that starts with a dash instead of passing it to git",
  withRepo((repo) => {
    repo.write("src/a.ts", "a\n");
    const base = repo.commit("base");

    const dashBase = repo.run("--base", "--output=x");
    assert.equal(dashBase.status, 2);
    assert.match(dashBase.stderr, /usage/u);
    assert.equal(existsSync(path.join(repo.dir, "x")), false);

    repo.setCopies(JSON.stringify({ "plugins/a": "--output=x" }));
    const dashCommit = repo.run("--base", base);
    assert.equal(dashCommit.status, 2);
    assert.match(dashCommit.stderr, /plugins\/a/u);
    assert.equal(existsSync(path.join(repo.dir, "x")), false);
  }),
);

test(
  "counts a file deleted from upstream",
  withRepo((repo) => {
    repo.write("src/gone.ts", "a\nb\n");
    const base = repo.commit("base");
    repo.remove("src/gone.ts");
    repo.commit("fork");
    const report = repo.report("--base", base);
    assert.deepEqual(report.files, [
      { path: "src/gone.ts", status: "D", added: 0, removed: 2, footprint: 2 },
    ]);
  }),
);

test(
  "reports non-ASCII paths unquoted",
  withRepo((repo) => {
    repo.write("a→b.txt", "a\n");
    const base = repo.commit("base");
    repo.write("a→b.txt", "b\n");
    repo.commit("fork");
    const report = repo.report("--base", base);
    assert.deepEqual(
      report.files.map((file) => file.path),
      ["a→b.txt"],
    );
  }),
);

test(
  "lists binary files with a zero count",
  withRepo((repo) => {
    repo.write("img.bin", Buffer.from([0, 1, 2, 3]));
    const base = repo.commit("base");
    repo.write("img.bin", Buffer.from([0, 9, 9, 9, 9]));
    repo.commit("fork");
    const report = repo.report("--base", base);
    assert.deepEqual(report.binary, ["img.bin"]);
    assert.equal(report.total, 0);
  }),
);

test(
  "sorts largest first and limits the human list with --top",
  withRepo((repo) => {
    repo.write("small.ts", "a\n");
    repo.write("large.ts", "a\n");
    const base = repo.commit("base");
    repo.write("small.ts", "b\n");
    repo.write("large.ts", "b\nc\nd\n");
    repo.commit("fork");
    const report = repo.report("--base", base);
    assert.deepEqual(
      report.files.map((file) => file.path),
      ["large.ts", "small.ts"],
    );
    const human = repo.run("--base", base, "--top", "1");
    assert.match(human.stdout, /large\.ts/u);
    assert.doesNotMatch(human.stdout, /small\.ts/u);
  }),
);

test(
  "rejects unknown arguments and non-integer numbers with exit 2",
  withRepo((repo) => {
    repo.write("src/a.ts", "a\n");
    const base = repo.commit("base");
    for (const args of [
      ["--nope"],
      ["--budget", "abc"],
      ["--budget"],
      ["--top", "1.5"],
      ["--base"],
    ]) {
      const result = repo.run("--base", base, ...args);
      assert.equal(result.status, 2, args.join(" "));
      assert.match(result.stderr, /usage/u);
    }
  }),
);

test(
  "counts a renamed upstream file under its new path",
  withRepo((repo) => {
    repo.write("src/old.ts", "1\n2\n3\n4\n5\n6\n7\n8\n");
    const base = repo.commit("base");
    repo.remove("src/old.ts");
    repo.write("src/renamed.ts", "1\n2\n3\n4\n5\n6\n7\nnine\n");
    repo.commit("fork");
    const report = repo.report("--base", base);
    assert.deepEqual(report.files, [
      { path: "src/renamed.ts", status: "R", added: 1, removed: 1, footprint: 2 },
    ]);
  }),
);
