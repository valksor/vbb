import { expect, it } from "vitest";
import { resolveRootComposeThreadEnvironment } from "@/views/root-compose-thread-environment";
import { newThreadEnvironmentArgsToSeed } from "./new-thread-environment-seed";

const PROJECT_ID = "proj_1";

it("preserves branch promotion through composer seed and request", () => {
  const seed = newThreadEnvironmentArgsToSeed({
    type: "project-default",
    promotion: "branch",
  });
  expect(seed).not.toBeNull();
  expect(
    resolveRootComposeThreadEnvironment({
      projectId: PROJECT_ID,
      environmentValue: seed!.selectionValue,
    }),
  ).toEqual({ type: "project-default", promotion: "branch" });
});
