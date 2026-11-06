import { useCallback, useEffect, useRef, type ReactNode } from "react";
import type {
  SessionOptionChoice,
  SessionOptionMenuSection,
} from "./SessionOptionsMenu";
import { Icon } from "@bb/shared-ui/icon";
import { COARSE_POINTER_ICON_SIZE_SHRINK_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Popover, PopoverAnchor, PopoverContent } from "@bb/shared-ui/popover";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  MENU_ITEM_LAST_HOVERED_CLASS,
  MenuHoverProvider,
  useMenuItemHover,
} from "@bb/shared-ui/menu-item-hover";
import { cn } from "@bb/shared-ui/lib/utils";
import { MODEL_PICKER_MENU_WIDTH_CLASS_NAME } from "./model-picker-menu";
import { MenuSectionLabel } from "./ModelReasoningMenu";

function SessionOptionItemButton({
  item,
  onSelect,
}: {
  item: SessionOptionMenuSection["items"][number];
  onSelect: (value: SessionOptionChoice) => void;
}) {
  const { hoverProps } = useMenuItemHover();
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={item.selected}
      title={item.description ?? undefined}
      onClick={() => onSelect(item.value)}
      className={cn(
        "relative flex w-full cursor-default select-none items-center justify-between gap-3 rounded-sm px-2 text-xs outline-none hover:bg-state-hover hover:text-foreground",
        LIST_HOVER_TRANSITION,
        MENU_ITEM_LAST_HOVERED_CLASS,
        "py-[0.3125rem] max-md:pointer-coarse:py-2",
      )}
      {...hoverProps}
    >
      <span className="truncate">{item.label}</span>
      <Icon
        name="Check"
        className={cn(
          COARSE_POINTER_ICON_SIZE_SHRINK_CLASS,
          "shrink-0 text-subtle-foreground",
          item.selected ? "opacity-100" : "opacity-0",
        )}
      />
    </button>
  );
}

export function CollapsedSelectSection({
  section,
  note,
  inline,
  open,
  onOpenChange,
  onSelect,
}: {
  section: SessionOptionMenuSection;
  note: ReactNode;
  inline: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (value: SessionOptionChoice) => void;
}) {
  const { isLastHovered, hoverProps } = useMenuItemHover();
  const openedWithoutPointerRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const previousOpenRef = useRef(open);
  const focusFirstSubItem = useCallback(() => {
    window.setTimeout(() => {
      contentRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    if (open && !openedWithoutPointerRef.current && !isLastHovered) {
      onOpenChange(false);
    }
  }, [open, isLastHovered, onOpenChange]);

  useEffect(() => {
    if (!open && previousOpenRef.current) {
      openedWithoutPointerRef.current = false;
      if (contentRef.current?.contains(document.activeElement)) {
        triggerRef.current?.focus();
      }
    }
    previousOpenRef.current = open;
  }, [open]);

  if (inline) {
    return (
      <div className="px-1 py-1" title={section.description ?? undefined}>
        <MenuSectionLabel className="mb-1 px-1 py-0">
          {section.label}
          {note}
        </MenuSectionLabel>
        <div
          role="menu"
          aria-label={section.label}
          className="max-h-48 overflow-y-auto overscroll-contain"
        >
          {section.items.map((item) => (
            <SessionOptionItemButton
              key={item.key}
              item={item}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          title={section.description ?? undefined}
          onClick={() => {
            if (!open) {
              openedWithoutPointerRef.current = true;
              onOpenChange(true);
            }
          }}
          onPointerEnter={(event) => {
            hoverProps.onPointerEnter(event);
            openedWithoutPointerRef.current = false;
            if (!open) {
              onOpenChange(true);
            }
          }}
          onKeyDown={(event) => {
            hoverProps.onKeyDown(event);

            if (
              event.key === "Enter" ||
              event.key === " " ||
              event.key === "Spacebar" ||
              event.key === "ArrowRight"
            ) {
              event.preventDefault();
              openedWithoutPointerRef.current = true;
              onOpenChange(true);
              focusFirstSubItem();
              return;
            }

            if (event.key === "Escape" || event.key === "ArrowLeft") {
              event.preventDefault();
              onOpenChange(false);
              triggerRef.current?.focus();
            }
          }}
          className={cn(
            "relative flex w-full cursor-default select-none items-center justify-between gap-3 rounded-sm px-2 py-[0.3125rem] text-xs outline-none hover:bg-state-hover hover:text-foreground",
            LIST_HOVER_TRANSITION,
            MENU_ITEM_LAST_HOVERED_CLASS,
          )}
          data-last-hovered={hoverProps["data-last-hovered"]}
        >
          <span className="min-w-0 truncate">
            {section.label}
            {note}
          </span>
          <span className="flex min-w-0 shrink items-center gap-1 text-muted-foreground">
            <span className="truncate">{section.selectedLabel}</span>
            <Icon name="ChevronRight" className="size-3.5 shrink-0" />
          </span>
        </button>
      </PopoverAnchor>
      <PopoverContent
        ref={contentRef}
        side="right"
        align="start"
        sideOffset={6}
        className={cn(
          "max-h-[min(20rem,var(--radix-popover-content-available-height),calc(100dvh-0.5rem))] overflow-y-auto overscroll-contain p-1 data-[state=closed]:animate-none",
          MODEL_PICKER_MENU_WIDTH_CLASS_NAME,
        )}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (event.key === "Escape" || event.key === "ArrowLeft") {
            event.preventDefault();
            onOpenChange(false);
            triggerRef.current?.focus();
          }
        }}
      >
        <MenuHoverProvider>
          <div role="menu" aria-label={section.label}>
            {section.items.map((item) => (
              <SessionOptionItemButton
                key={item.key}
                item={item}
                onSelect={(value) => {
                  onSelect(value);
                  onOpenChange(false);
                  triggerRef.current?.focus();
                }}
              />
            ))}
          </div>
        </MenuHoverProvider>
      </PopoverContent>
    </Popover>
  );
}
