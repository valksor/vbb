import type { CreateThreadEnvironmentArgs } from "@bb/server-contract";
import {
  PROJECT_BRANCH_VALUE,
  PROJECT_DEFAULT_VALUE,
} from "@/components/pickers/environment-picker-value.fork";
import type { newThreadEnvironmentArgsToSeed } from "./new-thread-environment-seed";

type NewThreadEnvironmentSeed = NonNullable<
  ReturnType<typeof newThreadEnvironmentArgsToSeed>
>;

export function projectDefaultEnvironmentSeed(
  environment: Extract<
    CreateThreadEnvironmentArgs,
    { type: "project-default" }
  >,
): NewThreadEnvironmentSeed {
  return {
    selectionValue:
      environment.promotion === "branch"
        ? PROJECT_BRANCH_VALUE
        : PROJECT_DEFAULT_VALUE,
    providerMachine: null,
    providerHostId: null,
    providerInputs: null,
  };
}
