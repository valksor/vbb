import { useRef, useState, type RefObject } from "react";
import { isBackgroundAgentTaskType } from "@bb/domain";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import { useResizeObserver } from "usehooks-ts";
import { BackgroundCommandOutputPanel } from "@/components/promptbox/banner/BackgroundCommandOutputPanel";
import {
  PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PromptStackCard,
} from "@/components/promptbox/banner/PromptStackCard";
import { LiveDurationText } from "@/components/thread/timeline/LiveDurationText";
import { Icon } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  activityIconClass,
  activityMetaClass,
  activityRowClass,
  activityTextClass,
} from "@bb/shared-ui/activity-row-styles";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
  PromptStackChevron,
  PromptStackCountSlot,
  PromptStackHoverChevron,
  useDisclosureFocusHandoff,
  AnimatedDisclosureBody,
} from "@bb/shared-ui/prompt-stack-disclosure";

const BODY_ID = "thread-background-commands-card-body";
const TOGGLE_ID = "thread-background-commands-card-toggle";
const COMPACT_PROMPT_SHELL_MAX_WIDTH_REM = 34;
const DEFAULT_ROOT_FONT_SIZE_PX = 16;

function isCompactPromptShellWidth(width: number): boolean {
  const parsedRootFontSize =
    typeof window === "undefined"
      ? Number.NaN
      : Number.parseFloat(
          window.getComputedStyle(document.documentElement).fontSize,
        );
  const rootFontSize = Number.isFinite(parsedRootFontSize)
    ? parsedRootFontSize
    : DEFAULT_ROOT_FONT_SIZE_PX;
  return width <= COMPACT_PROMPT_SHELL_MAX_WIDTH_REM * rootFontSize;
}

interface BackgroundActivityDisplay {
  icon: "Terminal" | "UserRoundPlus";
  label: string;
  runningPrefix: string;
}

function detailPanelId(itemId: string): string {
  return `thread-background-command-detail-${itemId}`;
}

function detailTriggerId(itemId: string): string {
  return `thread-background-command-trigger-${itemId}`;
}

function backgroundActivityDisplay(
  row: TimelineWorkflowWorkRow,
  finished = false,
): BackgroundActivityDisplay {
  if (isBackgroundAgentTaskType(row.taskType)) {
    return {
      icon: "UserRoundPlus",
      label: "Background agent",
      runningPrefix: "Running background agent:",
    };
  }
  return {
    icon: "Terminal",
    label: "Background command",
    runningPrefix: finished
      ? "Finished background command:"
      : "Running background command:",
  };
}

function backgroundActivityGroupLabel(
  rows: readonly TimelineWorkflowWorkRow[],
): string {
  const hasAgent = rows.some((row) => isBackgroundAgentTaskType(row.taskType));
  const hasCommand = rows.some(
    (row) => !isBackgroundAgentTaskType(row.taskType),
  );
  if (hasAgent && hasCommand) {
    return "Background activity";
  }
  return hasAgent ? "Background agents" : "Background commands";
}

function backgroundActivityModel(row: TimelineWorkflowWorkRow): string | null {
  return isBackgroundAgentTaskType(row.taskType) ? row.model : null;
}

function backgroundActivityAriaLabel(
  row: TimelineWorkflowWorkRow,
  label = backgroundActivityDisplay(row).label,
): string {
  const model = backgroundActivityModel(row);
  return model
    ? `${label}: ${row.description} · Model ${model}`
    : `${label}: ${row.description}`;
}

function compactBackgroundActivityLabel(
  rows: readonly TimelineWorkflowWorkRow[],
): string {
  const agentCount = rows.filter((row) =>
    isBackgroundAgentTaskType(row.taskType),
  ).length;
  const commandCount = rows.length - agentCount;
  if (commandCount === 0) {
    return `Running ${agentCount} background agent${agentCount === 1 ? "" : "s"}`;
  }
  if (agentCount === 0) {
    return `Running ${commandCount} background command${commandCount === 1 ? "" : "s"}`;
  }
  return `Running ${rows.length} background activities`;
}

function BackgroundActivitySummary({
  row,
  showDuration,
  finished,
}: {
  row: TimelineWorkflowWorkRow;
  showDuration: boolean;
  finished: boolean;
}) {
  const display = backgroundActivityDisplay(row, finished);
  const model = backgroundActivityModel(row);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 text-left">
      <span
        className={cn(
          "shrink-0 whitespace-nowrap",
          activityMetaClass("active"),
        )}
      >
        {display.runningPrefix}
      </span>
      <span
        className={cn("min-w-0 truncate", activityTextClass("active"))}
        title={row.description}
      >
        {row.description}
      </span>
      {model ? (
        <span
          className={cn(
            "shrink-0 whitespace-nowrap font-mono text-2xs",
            activityMetaClass("active"),
          )}
          title={`Model: ${model}`}
        >
          {model}
        </span>
      ) : null}
      {showDuration && !finished ? (
        <span
          className={cn("shrink-0 tabular-nums", activityMetaClass("active"))}
        >
          <LiveDurationText startedAt={row.startedAt} />
        </span>
      ) : null}
    </span>
  );
}

interface ExpandedActivityRowProps {
  row: TimelineWorkflowWorkRow;
  threadId: string;
  finished: boolean;
  useCompactSummary: boolean;
  isGroupExpanded: boolean;
  isDetailOpen: boolean;
  onToggleDetail: () => void;
}

function ExpandedActivityRow({
  row,
  threadId,
  finished,
  useCompactSummary,
  isGroupExpanded,
  isDetailOpen,
  onToggleDetail,
}: ExpandedActivityRowProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const display = backgroundActivityDisplay(row, finished);
  const model = backgroundActivityModel(row);
  const isCommand = !isBackgroundAgentTaskType(row.taskType);
  const showPanel = isCommand && isDetailOpen && isGroupExpanded;
  const rowClass = cn(
    "flex min-w-0 gap-1.5 px-3 py-0.5 text-xs",
    useCompactSummary ? "items-start" : "items-center",
  );
  const content = (
    <>
      <span className="flex h-[1lh] shrink-0 items-center">
        <Icon
          name={display.icon}
          className="size-3.5 text-muted-foreground/60"
          aria-hidden="true"
        />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-left text-muted-foreground",
          useCompactSummary ? "line-clamp-2 break-all" : "truncate",
        )}
        title={row.description}
      >
        {row.description}
      </span>
      {model ? (
        <span
          className="shrink-0 whitespace-nowrap font-mono text-2xs text-subtle-foreground"
          title={`Model: ${model}`}
        >
          {model}
        </span>
      ) : null}
      <span className="shrink-0 whitespace-nowrap tabular-nums text-subtle-foreground">
        {finished ? (
          "Finished"
        ) : isGroupExpanded ? (
          <LiveDurationText startedAt={row.startedAt} />
        ) : null}
      </span>
    </>
  );

  if (!isCommand) {
    return <div className={rowClass}>{content}</div>;
  }
  return (
    <div>
      <button
        type="button"
        id={detailTriggerId(row.itemId)}
        ref={triggerRef}
        aria-expanded={showPanel}
        aria-controls={detailPanelId(row.itemId)}
        onClick={onToggleDetail}
        onKeyDown={(event) => {
          if (event.key === "Escape" && showPanel) {
            event.stopPropagation();
            onToggleDetail();
          }
        }}
        className={cn(
          rowClass,
          useCompactSummary ? "min-h-10" : "min-h-6",
          "w-full cursor-pointer transition-colors hover:bg-background/80",
        )}
      >
        {content}
        <span className="flex h-[1lh] shrink-0 items-center">
          <Icon
            name={showPanel ? "ChevronUp" : "ChevronDown"}
            className="size-3.5 text-subtle-foreground"
            aria-hidden="true"
          />
        </span>
      </button>
      {showPanel ? (
        <BackgroundCommandOutputPanel
          id={detailPanelId(row.itemId)}
          labelledBy={detailTriggerId(row.itemId)}
          threadId={threadId}
          row={row}
          finished={finished}
          onEscape={() => {
            onToggleDetail();
            triggerRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

function useCompactCard(cardRef: RefObject<HTMLElement>): boolean {
  const isCompactViewport = useIsCompactViewport();
  const [isCompactCard, setIsCompactCard] = useState<boolean | null>(null);
  useResizeObserver({
    ref: cardRef,
    box: "border-box",
    onResize: ({ width }) => {
      if (width === undefined) return;
      const nextIsCompact = isCompactPromptShellWidth(width);
      setIsCompactCard((previous) =>
        previous === nextIsCompact ? previous : nextIsCompact,
      );
    },
  });
  return isCompactCard ?? isCompactViewport;
}

interface OpenCommandDetail {
  commands: TimelineWorkflowWorkRow[];
  rows: TimelineWorkflowWorkRow[];
  retainedRow: TimelineWorkflowWorkRow | null;
  openTaskId: string | null;
  toggleDetail: (itemId: string) => void;
}

function useOpenCommandDetail(
  commands: TimelineWorkflowWorkRow[],
  isGroupExpanded: boolean,
): OpenCommandDetail {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<TimelineWorkflowWorkRow | null>(
    null,
  );
  const liveOpenRow =
    openTaskId === null
      ? null
      : (commands.find((row) => row.itemId === openTaskId) ?? null);
  if (liveOpenRow !== null && liveOpenRow !== snapshot) {
    setSnapshot(liveOpenRow);
  }
  const hasRetainedRow =
    openTaskId !== null &&
    liveOpenRow === null &&
    snapshot?.itemId === openTaskId;
  const [wasGroupExpanded, setWasGroupExpanded] = useState(isGroupExpanded);
  if (wasGroupExpanded !== isGroupExpanded) {
    setWasGroupExpanded(isGroupExpanded);
  }
  const dropRetainedRow =
    hasRetainedRow &&
    commands.length > 0 &&
    wasGroupExpanded &&
    !isGroupExpanded;
  if (dropRetainedRow) {
    setOpenTaskId(null);
  }
  const retainedRow = hasRetainedRow && !dropRetainedRow ? snapshot : null;
  return {
    commands,
    rows: retainedRow ? [...commands, retainedRow] : commands,
    retainedRow,
    openTaskId,
    toggleDetail: (itemId) =>
      setOpenTaskId((current) => (current === itemId ? null : itemId)),
  };
}

interface ActivityCardProps {
  threadId: string;
  cardRef: RefObject<HTMLElement>;
  detail: OpenCommandDetail;
  isCompact: boolean;
}

function SingleCommandCard({
  threadId,
  cardRef,
  detail,
  isCompact,
}: ActivityCardProps) {
  const { commands, rows, retainedRow, openTaskId, toggleDetail } = detail;
  const toggleRef = useRef<HTMLButtonElement>(null);
  const row = rows[0]!;
  const finished = row === retainedRow;
  const isOpen = openTaskId === row.itemId;
  const display = backgroundActivityDisplay(row, finished);
  const label = finished
    ? "Finished background command"
    : compactBackgroundActivityLabel(commands);
  return (
    <PromptStackCard
      rootRef={cardRef}
      ariaLabel={backgroundActivityGroupLabel(rows)}
      className="overflow-hidden"
      style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
    >
      <div className="flex items-center">
        <button
          type="button"
          id={TOGGLE_ID}
          ref={toggleRef}
          aria-expanded={isOpen}
          aria-controls={detailPanelId(row.itemId)}
          aria-label={
            isCompact
              ? label
              : backgroundActivityAriaLabel(
                  row,
                  finished ? "Finished background command" : display.label,
                )
          }
          onClick={() => toggleDetail(row.itemId)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && isOpen) {
              event.stopPropagation();
              toggleDetail(row.itemId);
            }
          }}
          className={activityRowClass(
            "active",
            cn(
              PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
              PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
            ),
          )}
        >
          <Icon
            name={display.icon}
            className={activityIconClass("active", "size-3.5 shrink-0")}
            aria-hidden="true"
          />
          {isCompact ? (
            <>
              <span className="min-w-0 flex-1 truncate text-left font-medium">
                {label}
              </span>
              <PromptStackHoverChevron isExpanded={isOpen} />
            </>
          ) : (
            <>
              <BackgroundActivitySummary
                row={row}
                showDuration
                finished={finished}
              />
              <PromptStackChevron isExpanded={isOpen} />
            </>
          )}
        </button>
      </div>
      {isOpen ? (
        <div className="border-t border-border bg-popover">
          {isCompact && row.command !== null ? (
            <div
              className="line-clamp-2 break-all px-3 pt-2 text-xs text-muted-foreground"
              title={row.description}
            >
              {row.description}
            </div>
          ) : null}
          <BackgroundCommandOutputPanel
            id={detailPanelId(row.itemId)}
            labelledBy={TOGGLE_ID}
            threadId={threadId}
            row={row}
            finished={finished}
            onEscape={() => {
              toggleDetail(row.itemId);
              toggleRef.current?.focus();
            }}
          />
        </div>
      ) : null}
    </PromptStackCard>
  );
}

interface GroupActivityCardProps extends ActivityCardProps {
  isExpanded: boolean;
  onToggle: () => void;
}

function GroupActivityCard({
  threadId,
  cardRef,
  detail,
  isCompact,
  isExpanded,
  onToggle,
}: GroupActivityCardProps) {
  const focus = useDisclosureFocusHandoff(isExpanded, onToggle);
  const { commands, rows, retainedRow, openTaskId, toggleDetail } = detail;
  const primary = commands[0]!;
  const primaryDisplay = backgroundActivityDisplay(primary);
  const compactLabel = compactBackgroundActivityLabel(commands);
  const groupLabel = backgroundActivityGroupLabel(commands);
  const canExpand = rows.length > 1 || isCompact;
  const icon = (
    <Icon
      name={primaryDisplay.icon}
      className={activityIconClass("active", "size-3.5 shrink-0")}
      aria-hidden="true"
    />
  );

  return (
    <PromptStackCard
      rootRef={cardRef}
      ariaLabel={groupLabel}
      className="overflow-hidden"
      style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
    >
      <div className="flex items-center">
        {canExpand ? (
          <button
            type="button"
            id={TOGGLE_ID}
            aria-expanded={isExpanded}
            aria-controls={BODY_ID}
            aria-label={
              isCompact
                ? compactLabel
                : backgroundActivityAriaLabel(primary, groupLabel)
            }
            ref={focus.triggerRef}
            onClick={focus.onTriggerClick}
            className={activityRowClass(
              "active",
              cn(
                PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
                PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
              ),
            )}
          >
            {icon}
            {isCompact ? (
              <>
                <span className="min-w-0 flex-1 truncate text-left font-medium">
                  {compactLabel}
                </span>
                <PromptStackHoverChevron isExpanded={isExpanded} />
              </>
            ) : (
              <>
                <BackgroundActivitySummary
                  row={primary}
                  showDuration={false}
                  finished={false}
                />
                <PromptStackCountSlot count={commands.length} />
              </>
            )}
          </button>
        ) : (
          <div
            className={activityRowClass(
              "active",
              "flex min-h-8 w-full min-w-0 cursor-default items-center gap-1.5 rounded-none px-3 py-1.5 text-xs text-foreground",
            )}
            aria-label={backgroundActivityAriaLabel(primary)}
          >
            {icon}
            <BackgroundActivitySummary
              row={primary}
              showDuration
              finished={false}
            />
          </div>
        )}
      </div>
      {canExpand ? (
        <AnimatedDisclosureBody
          id={BODY_ID}
          labelledBy={TOGGLE_ID}
          isExpanded={isExpanded}
          collapsedBorder="none"
          collapseLabel={`Collapse ${groupLabel.toLowerCase()}`}
          collapseRef={focus.collapseRef}
          onCollapse={focus.onCollapseClick}
        >
          <div className="flex flex-col gap-1 py-1">
            {rows.map((row) => (
              <ExpandedActivityRow
                key={row.id}
                row={row}
                threadId={threadId}
                finished={row === retainedRow}
                useCompactSummary={isCompact}
                isGroupExpanded={isExpanded}
                isDetailOpen={openTaskId === row.itemId}
                onToggleDetail={() => toggleDetail(row.itemId)}
              />
            ))}
          </div>
        </AnimatedDisclosureBody>
      ) : null}
    </PromptStackCard>
  );
}

interface ThreadBackgroundCommandsCardProps {
  threadId: string;
  commands: TimelineWorkflowWorkRow[];
  isExpanded: boolean;
  onToggle: () => void;
}

export function ThreadBackgroundCommandsCard({
  threadId,
  commands,
  isExpanded,
  onToggle,
}: ThreadBackgroundCommandsCardProps) {
  const cardRef = useRef<HTMLElement>(null!);
  const isCompact = useCompactCard(cardRef);
  const detail = useOpenCommandDetail(commands, isExpanded);
  const primary = detail.rows[0];
  if (!primary) {
    return null;
  }
  const shared = { threadId, cardRef, detail, isCompact };
  if (
    detail.rows.length === 1 &&
    !isBackgroundAgentTaskType(primary.taskType)
  ) {
    return <SingleCommandCard {...shared} />;
  }
  return (
    <GroupActivityCard
      {...shared}
      isExpanded={isExpanded}
      onToggle={onToggle}
    />
  );
}
