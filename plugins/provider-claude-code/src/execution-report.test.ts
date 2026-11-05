import { describe, expect, it } from "vitest";
import { translateClaudeExecution } from "./execution-report.js";

function init(overrides: Record<string, unknown> = {}) {
  return {
    type: "system",
    subtype: "init",
    model: "claude-opus-4-6",
    ...overrides,
  };
}

describe("Claude execution reports", () => {
  it.each([
    ["acceptEdits", "on", "accept-edits", "fast"],
    ["auto", "off", "auto", "default"],
    ["bypassPermissions", "unknown", "full", null],
    ["unknown", undefined, null, null],
  ])(
    "maps permission and fast mode %s / %s",
    (permissionMode, fastModeState, expectedPermission, expectedTier) => {
      expect(
        translateClaudeExecution(
          init({ permissionMode, fast_mode_state: fastModeState, effort: "high" }),
        ),
      ).toEqual([
        {
          kind: "thread.execution",
          execution: {
            model: "claude-opus-4-6",
            reasoningLevel: "high",
            permissionMode: expectedPermission,
            serviceTier: expectedTier,
          },
        },
      ]);
    },
  );

  it("omits invalid model input and reports absent optional values as null", () => {
    expect(translateClaudeExecution(init({ model: "" }))).toBeNull();
    expect(translateClaudeExecution({ type: "system", subtype: "init" })).toBeNull();
    expect(translateClaudeExecution(init({ effort: "unknown" }))).toEqual([
      {
        kind: "thread.execution",
        execution: {
          model: "claude-opus-4-6",
          reasoningLevel: "unknown",
          permissionMode: null,
          serviceTier: null,
        },
      },
    ]);
  });
});
