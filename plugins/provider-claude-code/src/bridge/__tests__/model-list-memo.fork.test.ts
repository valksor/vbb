import { describe, expect, it, vi } from "vitest";
import { createClaudeCodeBridgeModelListMemo } from "../model-list.js";

const buildTarget = () => ({ env: {}, tokenProfile: null });

function catalog(model: string) {
  return {
    models: [
      {
        id: model,
        model,
        displayName: model,
        description: "",
        reasoningDiscovery: "known" as const,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: "medium" as const,
        isDefault: true,
      },
    ],
    selectedOnlyModels: [],
  };
}

describe("createClaudeCodeBridgeModelListMemo", () => {
  it("builds the target before the memo lookup so a refused build is never served from or stored in the cache", async () => {
    const list = vi.fn(() => Promise.resolve(catalog("glm")));
    const listModels = createClaudeCodeBridgeModelListMemo({
      list,
      now: () => 0,
      ttlMs: 1_000,
    });
    await listModels(buildTarget);

    expect(() =>
      listModels(() => {
        throw new Error("token file is missing");
      }),
    ).toThrow("token file is missing");
    expect(list).toHaveBeenCalledTimes(1);

    await expect(listModels(buildTarget)).resolves.toEqual(catalog("glm"));
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed probe", async () => {
    const list = vi
      .fn<() => Promise<ReturnType<typeof catalog>>>()
      .mockRejectedValueOnce(new Error("probe failed"))
      .mockResolvedValueOnce(catalog("glm"));
    const listModels = createClaudeCodeBridgeModelListMemo({
      list,
      now: () => 0,
      ttlMs: 1_000,
    });

    await expect(listModels(buildTarget)).rejects.toThrow("probe failed");
    await expect(listModels(buildTarget)).resolves.toEqual(catalog("glm"));
  });
});
