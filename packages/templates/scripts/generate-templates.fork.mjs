import { readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

const FORK_TEMPLATE_REGISTRY = new Map([
  [
    "bb-guide-maintenance.md",
    { fragmentFileName: "bb-guide-maintenance.fork.md", mode: "append" },
  ],
  [
    "bb-guide-threads.md",
    { fragmentFileName: "bb-guide-threads.fork.md", mode: "append" },
  ],
  [
    "bb-guide-terminals.md",
    { fragmentFileName: "bb-guide-terminals.fork.md", mode: "append" },
  ],
  [
    "bb-guide-environments.md",
    {
      fragmentFileName: "bb-guide-environments.fork.md",
      marker: "<!-- bb-fork-template: bb-guide-environments -->",
      mode: "replace",
    },
  ],
  [
    "bb-guide-providers.md",
    {
      fragmentFileName: "bb-guide-providers.fork.md",
      marker: "<!-- bb-fork-template: bb-guide-providers -->",
      mode: "replace",
    },
  ],
]);

export async function assembleForkTemplateBody(templatesDir, fileName, body) {
  const canonicalBody = body.trim();
  const registration = FORK_TEMPLATE_REGISTRY.get(fileName);
  if (!registration) return canonicalBody;

  const fragmentBody = matter(
    await readFile(path.join(templatesDir, registration.fragmentFileName), "utf8"),
  ).content.trim();

  if (registration.mode === "append") {
    return [canonicalBody, fragmentBody].filter(Boolean).join("\n\n");
  }

  const markerCount = canonicalBody.split(registration.marker).length - 1;
  if (markerCount !== 1) {
    throw new Error(
      `Template "${fileName}" must contain marker "${registration.marker}" exactly once`,
    );
  }

  return canonicalBody.replace(registration.marker, () => fragmentBody);
}
