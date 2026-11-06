import { describe, expect, it } from "vitest";
import {
  parseEnvironmentValue,
  PROJECT_DEFAULT_VALUE,
  PROJECT_BRANCH_VALUE,
} from "./environment-picker-value";

describe("provider environment values", () => {
  it("keeps branch promotion distinct from worktree promotion", () => {
    expect(parseEnvironmentValue(PROJECT_BRANCH_VALUE)).toEqual({
      type: "project-default",
      promotion: "branch",
    });
  });

  it("keeps the project default distinct from an explicit provider", () => {
    expect(parseEnvironmentValue(PROJECT_DEFAULT_VALUE)).toEqual({
      type: "project-default",
    });
    expect(parseEnvironmentValue("provider:project-checkout")).toEqual({
      type: "provider",
      environmentProviderId: "project-checkout",
    });
  });
});
