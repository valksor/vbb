import type { QueryClientArg } from "../cache-effect-types";
import { projectSkillsQueryKey } from "../queries/query-keys";

interface ProjectSkillsRefreshArg extends QueryClientArg {
  projectId: string;
}

export function refreshProjectSkillsQueries({
  projectId,
  queryClient,
}: ProjectSkillsRefreshArg): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: projectSkillsQueryKey(projectId),
  });
}
