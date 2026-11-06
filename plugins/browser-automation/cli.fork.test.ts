import { describe, expect, it } from "vitest";
import { browserCliFailure } from "./cli.js";

describe("CLI boundaries", () => {
  it.each([
    "Session stopped or expired; open a new session",
    "Session stopped, expired, or worker restarted; open a new session",
    "Session expired; open a new session",
    "Session does not belong to this thread",
  ])("classifies %j as an unavailable session", (message) => {
    expect(browserCliFailure(new Error(message))).toMatchObject({
      code: "session_unavailable",
    });
  });

  it("tells the user to raise --timeout when browser work is cancelled or times out", () => {
    expect(
      browserCliFailure(new Error("Browser work cancelled or timed out")),
    ).toMatchObject({
      code: "session_unavailable",
      hint: expect.stringMatching(
        /bb browser-automation open.*larger `--timeout`.*120 seconds/u,
      ),
    });
  });
});
