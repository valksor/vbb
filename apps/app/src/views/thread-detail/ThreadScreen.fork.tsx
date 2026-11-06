import type { ReactNode } from "react";

export function withComposerAside(
  promptArea: ReactNode,
  aside: ReactNode,
): ReactNode {
  if (promptArea === null) return null;
  return (
    <div className="relative">
      {promptArea}
      {aside}
    </div>
  );
}
