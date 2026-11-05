import { useEffect, useRef, useState, type ReactNode } from "react";
import { PAGE_CONTENT_MAX_WIDTH_PX } from "@/components/ui/page-shell";
import { PluginPerThreadSlotMount } from "./PluginPerThreadSlotMount.fork";
import { usePluginSlots } from "@/lib/plugin-slots";

const ASIDE_WIDTH_STYLE = {
  width: `min(18rem, calc((100cqw - ${PAGE_CONTENT_MAX_WIDTH_PX}px) / 2 - 3.5rem))`,
} as const;

function ComposerAsideRegion({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    let observedChild: Element | null = null;
    const syncOverflow = () => {
      setScrollable(wrapper.scrollHeight > wrapper.clientHeight);
    };
    const resizeObserver = new ResizeObserver(syncOverflow);
    const syncChildren = () => {
      wrapper.hidden = wrapper.firstElementChild === null;
      const child = wrapper.firstElementChild;
      if (child !== observedChild) {
        if (observedChild !== null) resizeObserver.unobserve(observedChild);
        observedChild = child;
        if (child !== null) resizeObserver.observe(child);
      }
      syncOverflow();
    };
    syncChildren();
    resizeObserver.observe(wrapper);
    const observer = new MutationObserver(syncChildren);
    observer.observe(wrapper, { childList: true });
    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      role="region"
      aria-label={title}
      className="max-h-48 overflow-y-auto"
      tabIndex={scrollable ? 0 : undefined}
    >
      {children}
    </div>
  );
}

export function PluginComposerAside({
  threadId,
  projectId,
}: {
  threadId: string;
  projectId: string;
}) {
  const { composerAsides } = usePluginSlots();

  if (composerAsides.length === 0) return null;

  return (
    <div
      className="absolute bottom-0 left-full ml-3 hidden @min-[1240px]/page:block"
      style={ASIDE_WIDTH_STYLE}
    >
      {composerAsides.map((slot) => {
        const Component = slot.component;
        return (
          <PluginPerThreadSlotMount
            key={`${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}`}
            slot={slot}
            slotKind="composerAside"
            instanceId={threadId}
          >
            <ComposerAsideRegion title={slot.title}>
              <Component threadId={threadId} projectId={projectId} />
            </ComposerAsideRegion>
          </PluginPerThreadSlotMount>
        );
      })}
    </div>
  );
}
