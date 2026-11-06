// @vitest-environment jsdom

import { expect, it } from "vitest";

it("resolves every named branding.icon the shipped plugins declare", async () => {
  const { existsSync } = await import("node:fs");
  const { readdir, readFile } = await import("node:fs/promises");
  const { dirname, join, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { isBuiltinIconName } = await import("@bb/shared-ui/icon");

  const pluginsDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../../plugins",
  );
  const entries = await readdir(pluginsDir, { withFileTypes: true });
  const declared: Array<[string, string]> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(pluginsDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest: { bb?: { branding?: { icon?: string } } } = JSON.parse(
      await readFile(manifestPath, "utf8"),
    );
    const icon = manifest.bb?.branding?.icon;
    if (icon === undefined || icon.startsWith("./")) continue;
    declared.push([entry.name, icon]);
  }

  expect(declared.length).toBeGreaterThan(0);
  expect(declared.filter(([, icon]) => !isBuiltinIconName(icon))).toEqual([]);
});
