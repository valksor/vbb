import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { usageFeedbackMessages } from "./usage-feedback.js";
import type { UsageProvider } from "./usage-schema.js";

export function formatResetCountdown(resetsAt: string | null): string | null {
  if (resetsAt === null) return null;
  const remaining = new Date(resetsAt).getTime() - Date.now();
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) return "now";
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`;
}

export function shortWindowLabel(label: string): string {
  return label
    .replace(/^Five-hour limit$|^5 hours$/u, "5h")
    .replace(/^Weekly limit$|^Weekly/u, "7d")
    .replace(/^Daily limit$/u, "1d");
}

export function usageToneTextClass(
  usedPercent: number,
  neutralClass: string,
): string {
  if (usedPercent >= 95) return "text-destructive";
  if (usedPercent >= 80) return "text-warning";
  return neutralClass;
}

export function accountStatusMessage(account: UsageProvider): string | null {
  const usage = account.usage;
  switch (usage?.status) {
    case undefined:
      return "Usage not reported.";
    case "ok":
      return usage.windows.length === 0
        ? "No usage limits reported for this plan."
        : null;
    case "not_installed":
      return "Not installed on this machine.";
    case "unauthenticated":
      return account.signInHint;
    case "expired":
      return account.expiredHint;
    case "error":
      return usage.message;
  }
}

export function UsageSkeleton({ rows }: { rows: number }) {
  return (
    <div role="status" aria-label={usageFeedbackMessages.loading}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-6 items-center gap-2">
          <Skeleton className="size-3.5 rounded-full" />
          <Skeleton
            className={cn("h-2", index % 2 === 0 ? "w-2/5" : "w-1/3")}
          />
          <span className="flex-1" />
          <Skeleton className="h-2 w-9" />
          <Skeleton className="h-2 w-9" />
        </div>
      ))}
    </div>
  );
}
