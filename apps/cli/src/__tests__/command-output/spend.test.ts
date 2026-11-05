import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerSpendCommands } from "../../commands/spend.js";

describe("bb spend command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerSpendCommands(program, () => "http://server");

  it("defaults to provider grouping over the local 14-day window", async () => {
    const get = vi.fn(async () => ({
      coverage: { historyComplete: 1, historyPartial: 0, threads: 1 },
      rows: [],
    }));
    stubServerApi({ "v1.spend.rollup.$get": get });
    vi.spyOn(Date, "now").mockReturnValue(new Date(2026, 0, 14, 12).valueOf());

    await runCommand(["spend"], register);

    expect(get).toHaveBeenCalledWith({
      query: { from: "2026-01-01", groupBy: "provider", to: "2026-01-14" },
    });
  });

  it("prints JSON and empty results through the spend transport", async () => {
    const result = {
      coverage: { historyComplete: 1, historyPartial: 0, threads: 1 },
      rows: [],
    };
    const get = vi.fn(async () => result);
    stubServerApi({ "v1.spend.rollup.$get": get });

    await runCommand(
      ["spend", "list", "--by", "model", "--from", "2026-02-01", "--to", "2026-02-02", "--thread", "thr_1", "--provider", "codex", "--json"],
      register,
    );

    expect(get).toHaveBeenCalledWith({
      query: {
        from: "2026-02-01",
        groupBy: "model",
        providerId: "codex",
        threadId: "thr_1",
        to: "2026-02-02",
      },
    });
    expect(JSON.parse(collectLogPayloads(vi.mocked(console.log))[0] ?? "")).toEqual(
      result,
    );

    vi.mocked(console.log).mockClear();
    await runCommand(["spend", "list"], register);
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "No spend recorded for this window.",
      "If the rollup is new, run `bb spend backfill` to replay the usage events still in the store.",
    ]);
  });

  it("renders priced and unpriced groups", async () => {
    stubServerApi({
      "v1.spend.rollup.$get": vi.fn(async () => ({
        coverage: { historyComplete: 1, historyPartial: 0, threads: 1 },
        rows: [
          {
            cachedInputTokens: 25,
            costUsd: 1.2,
            day: "*",
            firstEventAt: 1,
            inputTokens: 100,
            lastEventAt: 2,
            model: "gpt-5",
            outputTokens: 50,
            providerId: "openai",
            reasoningOutputTokens: 0,
            threadId: "*",
            totalTokens: 175,
            turns: 2,
            weightedUnits: 352.5,
          },
          {
            cachedInputTokens: 0,
            costUsd: null,
            day: "*",
            firstEventAt: 1,
            inputTokens: 5,
            lastEventAt: 2,
            model: "",
            outputTokens: 1,
            providerId: "codex",
            reasoningOutputTokens: 0,
            threadId: "*",
            totalTokens: 6,
            turns: 1,
            weightedUnits: 10,
          },
        ],
      })),
    });

    await runCommand(["spend", "list", "--by", "model"], register);

    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain("gpt-5");
    expect(output).toContain("unknown-model");
    expect(output).toContain("1.20");
    expect(output).toContain("no price");
  });

  it("rejects invalid grouping before transport", async () => {
    await expect(
      runCommand(["spend", "list", "--by", "month"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "--by must be one of day, thread, provider, model",
    );
  });

  it("backfills through the SDK transport and renders the result", async () => {
    const post = vi.fn(async () => ({
      contributionsApplied: 2,
      threadsHistoryComplete: 1,
      threadsHistoryPartial: 1,
      threadsScanned: 2,
      usageEventsScanned: 3,
    }));
    stubServerApi({ "v1.spend.backfill.$post": post });

    await runCommand(["spend", "backfill"], register);

    expect(post).toHaveBeenCalledWith({});
    expect(collectLogLines(vi.mocked(console.log)).join("\n")).toContain(
      "Contributions applied:  2",
    );
    expect(collectLogLines(vi.mocked(console.log)).join("\n")).toContain(
      "A partial thread could not be proven complete",
    );
  });
});
