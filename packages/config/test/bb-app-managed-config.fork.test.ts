import { describe, expect, it } from "vitest";
import { parseBbAppManagedConfig } from "../src/bb-app-managed-config.js";

function parseWithWarnings(rawConfig: unknown) {
  const warnings: Record<string, unknown>[] = [];
  const parsed = parseBbAppManagedConfig(rawConfig, {
    logger: {
      warn(fields): void {
        warnings.push(fields);
      },
    },
  });
  return { parsed, warnings };
}

describe("parseBbAppManagedConfig", () => {
  it("parses custom models with Claude Code profile provider ids", () => {
    const parsed = parseBbAppManagedConfig({
      customModels: [
        { providerId: "claude-code-work", model: "claude-opus-4-1" },
        { providerId: "claude-code-team-2", model: "claude-sonnet-4" },
      ],
    });

    expect(parsed.customModels?.map((entry) => entry.providerId)).toEqual([
      "claude-code-work",
      "claude-code-team-2",
    ]);
  });

  it("caps the Claude Code profile part of a provider id at 41 characters", () => {
    const atLimit = `claude-code-${"a".repeat(41)}`;
    expect(
      parseBbAppManagedConfig({
        customModels: [{ providerId: atLimit, model: "m" }],
      }).customModels?.map((entry) => entry.providerId),
    ).toEqual([atLimit]);

    const { parsed, warnings } = parseWithWarnings({
      customModels: [
        { providerId: `claude-code-${"a".repeat(42)}`, model: "m" },
      ],
    });
    expect(parsed.customModels).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("drops malformed or unknown claude-code-like custom model provider ids with a warning", () => {
    for (const providerId of [
      "claude-code-",
      "claude-code--x",
      "claude-code-work-",
      "claude-code-a--b",
      "claude-code-Work",
      "claude-codex",
      "claude-codework",
    ]) {
      const { parsed, warnings } = parseWithWarnings({
        customModels: [{ providerId, model: "provider/model" }],
      });
      expect(parsed.customModels).toEqual([]);
      expect(warnings).toHaveLength(1);
    }
  });
});
