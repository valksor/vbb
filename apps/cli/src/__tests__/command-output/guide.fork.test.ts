import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  runCommand,
  setupCommandOutputTestEnvironment,
} from "../helpers/command-output-harness.js";
import { registerGuideCommand } from "../../commands/guide.js";

describe("bb guide command output", () => {
  setupCommandOutputTestEnvironment();

  it("bb guide spend and its command group are discoverable", async () => {
    await runCommand(["guide", "spend"], registerGuideCommand);
    await runCommand(["guide", "commands", "spend"], registerGuideCommand);

    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain("bb spend list");
    expect(output).toContain("bb spend backfill");
  }, 30_000);
});
