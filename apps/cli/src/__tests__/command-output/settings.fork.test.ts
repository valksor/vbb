import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import {
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerSettingsCommands } from "../../commands/settings.js";

describe("bb settings commands", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerSettingsCommands(program, () => "http://server");

  it("lists quick replies and reads their empty default through UI commands", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        preferences: {
          "composer.quickReplies": {
            value: ["continue", "run the tests\nthen report", "continue"],
            revision: 7,
          },
        },
      })
      .mockResolvedValueOnce({
        preferences: { "composer.quickReplies": { value: [], revision: 8 } },
      });
    stubServerApi({ "v1.preferences.ui.$get": list });
    await runCommand(["settings", "ui", "list", "--json"], register);
    await runCommand(
      ["settings", "ui", "get", "composer.quickReplies", "--json"],
      register,
    );
    expect(
      collectLogPayloads(vi.mocked(console.log)).map((value) =>
        JSON.parse(value),
      ),
    ).toEqual([
      {
        preferences: {
          "composer.quickReplies": {
            value: ["continue", "run the tests\nthen report", "continue"],
            revision: 7,
          },
        },
      },
      { key: "composer.quickReplies", value: [], revision: 8 },
    ]);
  });

  it("sets ordered quick replies with the fetched revision and resets to default", async () => {
    const quickReplies = ["continue", "run the tests\nthen report", "continue"];
    const list = vi.fn(async () => ({
      preferences: { "composer.quickReplies": { value: [], revision: 8 } },
    }));
    const put = vi.fn(async ({ json }) => ({
      key: "composer.quickReplies",
      value: json.value,
      revision: 9,
    }));
    const reset = vi.fn(async () => ({
      key: "composer.quickReplies",
      value: [],
      revision: 10,
    }));
    stubServerApi({
      "v1.preferences.ui.$get": list,
      "v1.preferences.ui.:key.$put": put,
      "v1.preferences.ui.:key.$delete": reset,
    });
    await runCommand(
      [
        "settings",
        "ui",
        "set",
        "composer.quickReplies",
        JSON.stringify(quickReplies),
        "--json",
      ],
      register,
    );
    await runCommand(
      ["settings", "ui", "reset", "composer.quickReplies", "--json"],
      register,
    );
    expect(list).toHaveBeenCalledExactlyOnceWith({});
    expect(put).toHaveBeenCalledExactlyOnceWith({
      json: { expectedRevision: 8, value: quickReplies },
      param: { key: "composer.quickReplies" },
    });
    expect(reset).toHaveBeenCalledExactlyOnceWith({
      param: { key: "composer.quickReplies" },
    });
    expect(
      collectLogPayloads(vi.mocked(console.log)).map((value) =>
        JSON.parse(value),
      ),
    ).toEqual([
      { key: "composer.quickReplies", value: quickReplies, revision: 9 },
      { key: "composer.quickReplies", value: [], revision: 10 },
    ]);
  });

  it.each([
    { key: "providerTurnIdleWatchdogEnabled", value: "off", expected: false },
    { key: "providerTurnIdleNotifyMs", value: "300000", expected: 300_000 },
    {
      key: "providerTurnIdleInterruptMs",
      value: "43800000",
      expected: 43_800_000,
    },
  ] as const)(
    "updates watchdog setting $key through general settings",
    async ({ key, value, expected }) => {
      const put = vi.fn(async ({ json }) => json);
      stubServerApi({
        "v1.system.config.$get": vi.fn(async () => ({
          generalSettings: defaultAppSettings,
        })),
        "v1.settings.general.$put": put,
      });
      await runCommand(["settings", "general", key, value], register);
      expect(put).toHaveBeenCalledExactlyOnceWith({
        json: { ...defaultAppSettings, [key]: expected },
      });
    },
  );

  it("rejects a watchdog threshold that would equal the interrupt threshold", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
      })),
      "v1.settings.general.$put": put,
    });
    await expect(
      runCommand(
        ["settings", "general", "providerTurnIdleNotifyMs", "43200000"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(put).not.toHaveBeenCalled();
  });
});
