import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "profile-env-names.json",
);
const binary = realpathSync(
  process.argv[2] ??
    execFileSync("which", ["claude"], { encoding: "utf8" }).trim(),
);
const version = execFileSync(binary, ["--version"], {
  encoding: "utf8",
}).trim();

const strings = execFileSync("strings", ["-a", binary], {
  encoding: "utf8",
  maxBuffer: 1 << 30,
});

const wholeIdentifier = /^[A-Z][A-Z0-9_]*[A-Z0-9]$/u;
const candidatePattern =
  /(?<![A-Za-z0-9_])(?:ANTHROPIC_|CLAUDE_|AGENT_PROXY_|CCR_|AWS_BEARER_)[A-Z0-9_]*[A-Z0-9](?![A-Za-z0-9_])/gu;
const credentialShaped =
  /OAUTH|TOKEN|SECRET|CRED|AUTH|KEY|DESCRIPTOR|ACCOUNT|ORGANIZATION|EMAIL|BEARER|PASSPHRASE|BASE_URL|SECURESTORAGE|PROVIDER_MANAGED|PROXY/u;

const candidates = new Set(
  (strings.match(candidatePattern) ?? []).filter((name) =>
    wholeIdentifier.test(name),
  ),
);

const inScope = [...candidates].filter(
  (name) =>
    !candidates.has(name.slice(0, -1)) &&
    (name.startsWith("ANTHROPIC_") ||
      name.startsWith("CLAUDE_CODE_USE_") ||
      credentialShaped.test(name)),
);

const previous = existsSync(fixturePath)
  ? JSON.parse(readFileSync(fixturePath, "utf8")).names
  : {};

const names = Object.fromEntries(
  inScope.sort().map((name) => [name, previous[name] ?? "unreviewed"]),
);

writeFileSync(
  fixturePath,
  `${JSON.stringify(
    { source: { version }, names },
    null,
    2,
  )}\n`,
);
