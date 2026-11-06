export interface ParsedProjectDefaultEnvironmentValue {
  type: "project-default";
  promotion?: "branch";
}

export const PROJECT_DEFAULT_VALUE = "project-default";
export const PROJECT_BRANCH_VALUE = "project-default:branch";

export function parseProjectDefaultValue(
  value: string,
): ParsedProjectDefaultEnvironmentValue | null {
  if (value === PROJECT_BRANCH_VALUE)
    return { type: "project-default", promotion: "branch" };
  if (value === PROJECT_DEFAULT_VALUE) {
    return { type: "project-default" };
  }
  return null;
}
