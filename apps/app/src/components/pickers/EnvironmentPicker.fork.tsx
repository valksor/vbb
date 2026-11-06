import { CommandGroup } from "@bb/shared-ui/command";
import type { IconName } from "@bb/shared-ui/icon";
import { PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID } from "@bb/client-core";
import { EnvironmentMenuItem } from "./EnvironmentPicker";
import {
  PROJECT_BRANCH_VALUE,
  PROJECT_DEFAULT_VALUE,
  type ParsedEnvironmentValue,
} from "./environment-picker-value";

const PROJECT_DEFAULT_LABEL = "Checkout, then worktree";
const PROJECT_DEFAULT_DESCRIPTION =
  "Starts in the project checkout; the agent moves to a worktree before the first change";
const PROJECT_CHECKOUT_DESCRIPTION =
  "Stays in the project checkout; concurrent threads share its files";

export function projectCheckoutDescription(provider: {
  id: string;
}): string | undefined {
  return provider.id === PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID
    ? PROJECT_CHECKOUT_DESCRIPTION
    : undefined;
}

export function projectDefaultSelected(
  parsed: ParsedEnvironmentValue,
  hostUnavailableReason: string | null,
): { modeLabel: string; compactModeLabel: string; icon: IconName } | null {
  if (parsed?.type !== "project-default" || hostUnavailableReason !== null) {
    return null;
  }
  const label =
    parsed.promotion === "branch"
      ? "Checkout, then branch"
      : PROJECT_DEFAULT_LABEL;
  return { modeLabel: label, compactModeLabel: label, icon: "GitBranch" };
}

export function ProjectDefaultEnvironmentOption(props: {
  disabled: boolean;
  onSelect: ((promotion: "worktree" | "branch") => void) | undefined;
  projectless: boolean;
  value: string;
}) {
  if (props.projectless || props.onSelect === undefined) return null;
  return (
    <CommandGroup>
      <EnvironmentMenuItem
        value={PROJECT_DEFAULT_VALUE}
        label={PROJECT_DEFAULT_LABEL}
        description={PROJECT_DEFAULT_DESCRIPTION}
        icon="GitBranch"
        selected={props.value === PROJECT_DEFAULT_VALUE}
        disabled={props.disabled}
        onSelect={() => props.onSelect?.("worktree")}
      />
      <EnvironmentMenuItem
        value={PROJECT_BRANCH_VALUE}
        label="Checkout, then branch"
        description="Starts in this checkout; the agent switches it to a generated branch before editing, or an existing branch you request. Shares files with other checkout users; another live thread blocks the switch."
        icon="GitBranch"
        selected={props.value === PROJECT_BRANCH_VALUE}
        disabled={props.disabled}
        onSelect={() => props.onSelect?.("branch")}
      />
    </CommandGroup>
  );
}
