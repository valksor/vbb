import { describe, expect, it } from "vitest";
import { GLM_PROBE_MODELS } from "./__fixtures__/glm-model-list.js";
import { buildClaudeCodeModels } from "./model-list.js";
import { filterTokenProfileModels } from "./token-profile-rules.js";

describe("filterTokenProfileModels", () => {
  const profileEnv = {
    ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3[1m]",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.3-flashx[1m]",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.3-flash[1m]",
    API_TIMEOUT_MS: "3000000",
  };

  it("keeps only the profile's models, drops the leaked claude rows and the opus[1m] duplicate", () => {
    const filtered = filterTokenProfileModels(GLM_PROBE_MODELS, profileEnv);

    expect(filtered.map((model) => model.value)).toEqual([
      "default",
      "opus",
      "sonnet",
      "haiku",
    ]);
    const result = buildClaudeCodeModels(filtered);
    expect(result.models.map((model) => model.model)).toEqual([
      "glm-5.3[1m]",
      "glm-5.3-flashx[1m]",
      "glm-5.3-flash[1m]",
    ]);
    expect(result.models.filter((model) => model.isDefault)).toEqual([
      expect.objectContaining({ model: "glm-5.3[1m]" }),
    ]);
    expect(result.selectedOnlyModels.map((model) => model.model)).toEqual([
      "opus",
      "sonnet",
      "haiku",
    ]);
  });

  it("matches ANTHROPIC_MODEL, the small fast model and the custom option", () => {
    const rows = ["glm-main", "glm-fast", "glm-custom", "claude-leaked"].map(
      (model) => ({
        value: model,
        resolvedModel: model,
        displayName: model,
        description: model,
      }),
    );

    const filtered = filterTokenProfileModels(rows, {
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
      ANTHROPIC_MODEL: "glm-main",
      ANTHROPIC_SMALL_FAST_MODEL: "glm-fast",
      ANTHROPIC_CUSTOM_MODEL_OPTION: "glm-custom",
      ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: "claude-leaked",
    });

    expect(filtered.map((model) => model.value)).toEqual([
      "glm-main",
      "glm-fast",
      "glm-custom",
    ]);
  });
});
