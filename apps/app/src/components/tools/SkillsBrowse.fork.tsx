import type { ReactNode } from "react";
import { ResourceInstallControl } from "@bb/shared-ui/resource-list";

export function RegistrySkillInstallActions({
  children,
  installed,
  installing,
  onInstall,
  presentation,
  skillName,
}: {
  children: ReactNode;
  installed: boolean;
  installing: boolean;
  onInstall: () => void;
  presentation: "label" | "icon";
  skillName: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <ResourceInstallControl
        accessibleLabel={
          installed
            ? `${skillName} is installed in bb`
            : `Install ${skillName} into bb`
        }
        label={installed ? "Installed" : "Install"}
        icon={installed ? "Check" : "Download"}
        pending={installing && !installed}
        disabled={installed}
        presentation={presentation}
        tooltip={
          installed ? `${skillName} is installed` : `Install ${skillName}`
        }
        onAction={onInstall}
      />
      {children}
    </span>
  );
}
