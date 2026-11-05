import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { PromptBannerActionButton } from "@bb/shared-ui/prompt-banner-actions";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";

interface ThreadQuickRepliesCardProps {
  messages: readonly string[];
  onSend: (text: string) => void;
}

export function ThreadQuickRepliesCard({
  messages,
  onSend,
}: ThreadQuickRepliesCardProps) {
  if (messages.length === 0) return null;
  return (
    <PromptStackCard className="overflow-hidden">
      <div className="flex min-h-8 flex-nowrap items-center gap-1.5 overflow-x-auto px-3 py-1.5 text-xs">
        <TooltipProvider delayDuration={300}>
          {messages.map((message, index) => (
            <Tooltip key={index}>
              <TooltipTrigger asChild>
                <PromptBannerActionButton
                  className="shrink-0"
                  aria-label={`Send “${message}”`}
                  onClick={() => onSend(message)}
                >
                  <span className="max-w-40 truncate">{message}</span>
                </PromptBannerActionButton>
              </TooltipTrigger>
              <TooltipContent className="max-h-60 max-w-80 overflow-y-auto whitespace-pre-wrap break-words">
                {message}
              </TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </div>
    </PromptStackCard>
  );
}
