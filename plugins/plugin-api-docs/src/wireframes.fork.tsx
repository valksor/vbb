import { cn } from "@/lib/utils";
import { Mark, MeasuredBadge, PluginGlyph } from "./wireframes";

export function composerRowClassName(mobile: boolean): string {
  return cn(
    "border-t border-border-hairline p-4",
    mobile ? "space-y-2" : "flex items-end gap-3",
  );
}

export function pendingInteractionClassName(mobile: boolean): string {
  return cn(
    "block border border-border bg-card p-3",
    !mobile && "min-w-0 flex-1",
  );
}

export function ComposerAsideFixture({ mobile }: { mobile: boolean }) {
  if (mobile) return null;
  return (
    <Mark
      id="composer-aside"
      label="Plugin composer-aside content, in the gutter beside the composer"
      className="w-24 shrink-0 border border-border bg-card p-2"
      showChip={false}
    >
      <span className="flex items-center gap-1.5 text-foreground">
        <PluginGlyph className="size-3" />
        <span className="text-2xs">Checks</span>
      </span>
      <span
        aria-hidden
        className="mt-1.5 block h-1.5 w-full rounded-sm bg-muted/60"
      />
    </Mark>
  );
}

export function ComposerAsideBadge({ scene }: { scene: string }) {
  if (scene !== "desktop") return null;
  return (
    <MeasuredBadge
      id="composer-aside"
      label="Plugin composer-aside content, in the gutter beside the composer"
      anchor='[data-guide-region="composer-aside"]'
      at="above"
    />
  );
}
