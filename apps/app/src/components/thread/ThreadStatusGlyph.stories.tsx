import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { ThreadStatusGlyph } from "./ThreadStatusGlyph";

export default { title: "thread/Thread status glyph" };

const WAITING_KINDS = [
  {
    indicator: "waiting-for-plan-approval",
    label: "plan approval",
  },
  {
    indicator: "waiting-for-answer",
    label: "answer",
  },
  {
    indicator: "waiting-for-input",
    label: "generic input",
  },
] as const;

export function WaitingKinds() {
  return (
    <StoryCard
      columns={["16px sidebar", "14px compact", "12px related threads"]}
    >
      {WAITING_KINDS.map(({ indicator, label }) => (
        <StoryRow key={indicator} label={label}>
          <ThreadStatusGlyph indicator={indicator} />
          <ThreadStatusGlyph indicator={indicator} size="compact" />
          <span className="flex items-center text-subtle-foreground [&_[data-icon-root]]:size-3">
            <ThreadStatusGlyph indicator={indicator} size="compact" />
          </span>
        </StoryRow>
      ))}
    </StoryCard>
  );
}
