import { describe, expect, it } from "vitest";
import { resolveRootComposeThreadEnvironment } from "./root-compose-thread-environment";

const projectId = "proj_123";

describe("resolveRootComposeThreadEnvironment", () => {
  it("preserves the project default for the server policy", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        environmentValue: "project-default",
        projectId,
      }),
    ).toEqual({ type: "project-default" });
  });
});
