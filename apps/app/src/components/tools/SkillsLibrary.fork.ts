import { useCallback, useMemo } from "react";
import type { SkillSummary } from "@bb/server-contract";
import type { RegistrySkill } from "@/lib/skills-registry";
import { appToast } from "@/components/ui/app-toast";
import {
  useInstallingRegistrySkillIds,
  useInstallRegistrySkill,
} from "@/hooks/queries/skills-queries.fork";

export function useRegistrySkillInstall(
  registrySkills: readonly RegistrySkill[],
  findLocalRegistrySkill: (skill: RegistrySkill) => SkillSummary | null,
) {
  const { mutateAsync: installRegistrySkillAsync } = useInstallRegistrySkill();
  const installingRegistrySkillIds = useInstallingRegistrySkillIds();
  const installRegistrySkill = useCallback(
    (skill: RegistrySkill) => {
      installRegistrySkillAsync(skill.id)
        .then(() => appToast.success(`Installed ${skill.name}`))
        .catch(() => {});
    },
    [installRegistrySkillAsync],
  );
  const installedRegistrySkillIds = useMemo(
    () =>
      new Set(
        registrySkills.flatMap((skill) =>
          findLocalRegistrySkill(skill) === null ? [] : [skill.id],
        ),
      ),
    [registrySkills, findLocalRegistrySkill],
  );
  return {
    installRegistrySkill,
    installedRegistrySkillIds,
    installingRegistrySkillIds,
  };
}
