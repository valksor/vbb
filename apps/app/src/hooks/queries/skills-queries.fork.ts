import { useMemo } from "react";
import {
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import { refreshProjectSkillsQueries } from "@/hooks/cache-owners/skills-cache-effects.fork";

const INSTALL_REGISTRY_SKILL_MUTATION_KEY = ["skills-registry", "install"];

export function useInstallRegistrySkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: INSTALL_REGISTRY_SKILL_MUTATION_KEY,
    meta: { errorMessage: "Failed to install skill." },
    mutationFn: (registrySkillId: string) =>
      sdk.skills.registry.install({ registrySkillId }),
    onSuccess: () =>
      refreshProjectSkillsQueries({
        projectId: PERSONAL_PROJECT_ID,
        queryClient,
      }),
  });
}

export function useInstallingRegistrySkillIds(): ReadonlySet<string> {
  const variables = useMutationState({
    filters: {
      mutationKey: INSTALL_REGISTRY_SKILL_MUTATION_KEY,
      status: "pending",
    },
    select: (mutation) => mutation.state.variables,
  });
  return useMemo(
    () =>
      new Set(
        variables.filter(
          (registrySkillId): registrySkillId is string =>
            typeof registrySkillId === "string",
        ),
      ),
    [variables],
  );
}
