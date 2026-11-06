import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const UPSTREAM_REF = "_get-bb/main";
const COPIES_FILE = path.join("scripts", "fork-copies.json");
const USAGE =
  "usage: fork-footprint [--base <ref>] [--budget <N>] [--top <N>] [--json]";
const COUNTED_STATUSES = new Set(["M", "D", "R"]);
const REGENERATED = [
  "pnpm-lock.yaml",
  "apps/mobile/src/theme/theme.native.ts",
  "packages/provider-bridge-protocol/recordings/row-counts.json",
];

class ExitError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseInteger(value) {
  if (value === undefined || !/^\d+$/u.test(value)) {
    throw new ExitError(USAGE, 2);
  }
  return Number(value);
}

function parseArgs(argv) {
  const options = { base: undefined, budget: undefined, top: 20, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") options.json = true;
    else if (flag === "--base") {
      options.base = argv[(index += 1)];
      if (!options.base || options.base.startsWith("-")) {
        throw new ExitError(USAGE, 2);
      }
    } else if (flag === "--budget") {
      options.budget = parseInteger(argv[(index += 1)]);
    } else if (flag === "--top") {
      options.top = parseInteger(argv[(index += 1)]);
    } else throw new ExitError(USAGE, 2);
  }
  return options;
}

function readCopies(repoRoot) {
  const file = path.join(repoRoot, COPIES_FILE);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new ExitError(`cannot read ${COPIES_FILE}: ${error.message}`, 2);
  }
  const isRecord =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  if (!isRecord || !Object.values(parsed).every((v) => typeof v === "string")) {
    throw new ExitError(
      `${COPIES_FILE} must be an object of plugin path to commit string`,
      2,
    );
  }
  for (const [copyPath, commit] of Object.entries(parsed)) {
    if (commit.startsWith("-")) {
      throw new ExitError(
        `${COPIES_FILE}: commit ${commit} for ${copyPath} must not start with "-"`,
        2,
      );
    }
    try {
      git(["rev-parse", "--verify", `${commit}^{commit}`]);
    } catch {
      throw new ExitError(
        `${COPIES_FILE}: commit ${commit} for ${copyPath} does not resolve`,
        2,
      );
    }
  }
  return parsed;
}

function resolveBase(explicit) {
  if (explicit) {
    try {
      git(["rev-parse", "--verify", `${explicit}^{commit}`]);
    } catch {
      throw new ExitError(`base ${explicit} does not resolve to a commit`, 2);
    }
    return explicit;
  }
  try {
    return git(["merge-base", "HEAD", UPSTREAM_REF]).trim();
  } catch {
    throw new ExitError(`cannot find merge-base of HEAD and ${UPSTREAM_REF}`, 2);
  }
}

function parseStatuses(output) {
  const tokens = output.split("\0");
  const statuses = new Map();
  let index = 0;
  while (index < tokens.length && tokens[index] !== "") {
    const status = tokens[index++][0];
    if (status === "R" || status === "C") index += 1;
    statuses.set(tokens[index++], status);
  }
  return statuses;
}

function parseNumstat(output) {
  const tokens = output.split("\0");
  const rows = [];
  let index = 0;
  while (index < tokens.length && tokens[index] !== "") {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/u.exec(tokens[index++]);
    if (!match) throw new Error(`unexpected numstat entry: ${tokens[index - 1]}`);
    let file = match[3];
    if (file === "") {
      index += 1;
      file = tokens[index++];
    }
    const binary = match[1] === "-";
    rows.push({
      path: file,
      binary,
      added: binary ? 0 : Number(match[1]),
      removed: binary ? 0 : Number(match[2]),
    });
  }
  return rows;
}

function isForkOwned(file) {
  const segments = file.split("/");
  return (
    segments[segments.length - 1].includes(".fork.") ||
    segments.slice(0, -1).includes("drizzle-fork")
  );
}

function measure(base) {
  const diff = (format) =>
    git(["diff", "-z", format, "--find-renames", base, "HEAD"]);
  const statuses = parseStatuses(diff("--name-status"));
  const rows = parseNumstat(diff("--numstat"));
  const files = [];
  const regenerated = [];
  const binary = [];
  for (const row of rows) {
    const status = statuses.get(row.path);
    if (!COUNTED_STATUSES.has(status) || isForkOwned(row.path)) continue;
    const entry = {
      path: row.path,
      status,
      added: row.added,
      removed: row.removed,
      footprint: row.added + row.removed,
    };
    if (REGENERATED.includes(row.path)) regenerated.push(entry);
    else {
      files.push(entry);
      if (row.binary) binary.push(row.path);
    }
  }
  const bySize = (a, b) =>
    b.footprint - a.footprint || a.path.localeCompare(b.path);
  files.sort(bySize);
  regenerated.sort(bySize);
  return { files, regenerated, binary };
}

function readDrift(copies) {
  const drift = {};
  for (const [copyPath, commit] of Object.entries(copies)) {
    let log;
    try {
      log = git([
        "log",
        "--format=%h %s",
        `${commit}..${UPSTREAM_REF}`,
        "--",
        copyPath,
      ]);
    } catch {
      throw new ExitError(
        `cannot list upstream commits for ${copyPath}: ${UPSTREAM_REF} does not resolve`,
        2,
      );
    }
    drift[copyPath] = log
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const split = line.indexOf(" ");
        return split === -1
          ? { commit: line, subject: "" }
          : { commit: line.slice(0, split), subject: line.slice(split + 1) };
      });
  }
  return drift;
}

function formatEntry(entry) {
  return `${String(entry.footprint).padStart(7)}  ${entry.status}  +${entry.added} -${entry.removed}  ${entry.path}`;
}

function formatReport(report, top) {
  const lines = [
    `base: ${report.base}`,
    `total footprint: ${report.total} lines in ${report.files.length} files`,
    "",
    `top ${Math.min(top, report.files.length)} files:`,
    ...report.files.slice(0, top).map(formatEntry),
    "",
    "regenerated (not counted):",
    ...(report.regenerated.length
      ? report.regenerated.map(formatEntry)
      : ["  none"]),
  ];
  if (report.binary.length) {
    lines.push("", "binary (counted as 0):", ...report.binary.map((p) => `  ${p}`));
  }
  lines.push("", "copy drift:");
  const copyPaths = Object.keys(report.drift);
  if (!copyPaths.length) lines.push("  no copies recorded");
  for (const copyPath of copyPaths) {
    const commits = report.drift[copyPath];
    lines.push(`  ${copyPath}:`);
    if (!commits.length) lines.push("    no upstream commits");
    for (const { commit, subject } of commits) {
      lines.push(`    ${commit} ${subject}`);
    }
  }
  return lines.join("\n");
}

function run(argv) {
  const options = parseArgs(argv);
  let repoRoot;
  try {
    repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
  } catch {
    throw new ExitError("not inside a git repository", 2);
  }
  const copies = readCopies(repoRoot);
  const base = resolveBase(options.base);
  const { files, regenerated, binary } = measure(base);
  const total = files.reduce((sum, file) => sum + file.footprint, 0);
  const report = {
    base,
    total,
    files,
    regenerated,
    binary,
    drift: readDrift(copies),
  };
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report, options.top));
  }
  if (options.budget === undefined) return 0;
  const over = total > options.budget;
  const verdict = over
    ? `over budget: total ${total} > ${options.budget}`
    : `within budget: total ${total} <= ${options.budget}`;
  (options.json ? console.error : console.log)(verdict);
  return over ? 1 : 0;
}

export function main(argv) {
  try {
    return run(argv);
  } catch (error) {
    console.error(error instanceof ExitError ? error.message : error.stack);
    return error instanceof ExitError ? error.code : 2;
  }
}

