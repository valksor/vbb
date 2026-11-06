import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assembleForkTemplateBody } from "../scripts/generate-templates.fork.mjs";

describe("assembleForkTemplateBody", () => {
  let templatesDir = "";

  beforeEach(async () => {
    templatesDir = await mkdtemp(path.join(tmpdir(), "bb-template-fragment-"));
  });

  afterEach(async () => {
    await rm(templatesDir, { force: true, recursive: true });
  });

  it("appends registered fragments after the canonical body", async () => {
    await writeFile(
      path.join(templatesDir, "bb-guide-threads.fork.md"),
      "---\nignored: metadata\n---\nFork section\n",
    );

    await expect(
      assembleForkTemplateBody(
        templatesDir,
        "bb-guide-threads.md",
        "Canonical section\n",
      ),
    ).resolves.toBe("Canonical section\n\nFork section");
  });

  it("replaces the registered inline marker with its fragment", async () => {
    await writeFile(
      path.join(templatesDir, "bb-guide-environments.fork.md"),
      "Inline fork\n",
    );

    await expect(
      assembleForkTemplateBody(
        templatesDir,
        "bb-guide-environments.md",
        "Before\n\n<!-- bb-fork-template: bb-guide-environments -->\n\nAfter",
      ),
    ).resolves.toBe("Before\n\nInline fork\n\nAfter");
  });

  it("preserves replacement metasequences in inline fragments", async () => {
    const fragmentBody = "$& $` $' $$";
    await writeFile(
      path.join(templatesDir, "bb-guide-environments.fork.md"),
      `${fragmentBody}\n`,
    );

    await expect(
      assembleForkTemplateBody(
        templatesDir,
        "bb-guide-environments.md",
        "Before\n\n<!-- bb-fork-template: bb-guide-environments -->\n\nAfter",
      ),
    ).resolves.toBe(`Before\n\n${fragmentBody}\n\nAfter`);
  });

  it("returns unregistered canonical templates trimmed", async () => {
    await expect(
      assembleForkTemplateBody(templatesDir, "ordinary.md", "\nCanonical\n"),
    ).resolves.toBe("Canonical");
  });

  it("fails when a registered fragment is missing", async () => {
    await expect(
      assembleForkTemplateBody(
        templatesDir,
        "bb-guide-threads.md",
        "Canonical section",
      ),
    ).rejects.toThrow(/ENOENT/u);
  });

  it("fails when a registered inline marker is missing", async () => {
    await writeFile(
      path.join(templatesDir, "bb-guide-environments.fork.md"),
      "Inline fork\n",
    );

    await expect(
      assembleForkTemplateBody(
        templatesDir,
        "bb-guide-environments.md",
        "Canonical section",
      ),
    ).rejects.toThrow(/exactly once/u);
  });

  it("fails when a registered inline marker is duplicated", async () => {
    await writeFile(
      path.join(templatesDir, "bb-guide-environments.fork.md"),
      "Inline fork\n",
    );

    await expect(
      assembleForkTemplateBody(
        templatesDir,
        "bb-guide-environments.md",
        "<!-- bb-fork-template: bb-guide-environments -->\n<!-- bb-fork-template: bb-guide-environments -->",
      ),
    ).rejects.toThrow(/exactly once/u);
  });
});
