import type { ComponentType } from "react";

/**
 * Props passed to an `experimental_threadHeaderAction` component, rendered in
 * the thread header's action row.
 */
export interface PluginThreadHeaderActionProps {
  /**
   * The thread this header belongs to. Never null: the slot is not rendered
   * on the compose screen or other non-thread routes. A split layout renders
   * one header per pane, so the component mounts once per visible thread,
   * each with its own id — keep per-thread state in the component, never in a
   * module-level singleton.
   */
  threadId: string;
  projectId: string;
  /**
   * True on phone-width viewports and coarse pointers. Collapse to an
   * icon-sized control when it is true — the row is short.
   */
  isCompactViewport: boolean;
}

/**
 * Props passed to an `experimental_composerAside` component, rendered in the
 * gutter beside an open thread's composer.
 */
export interface PluginComposerAsideProps {
  /**
   * The thread this composer belongs to. Never null: the slot is not rendered
   * on the compose screen or in embedded chats. A split layout renders one
   * composer per pane, so the component mounts once per visible thread, each
   * with its own id — keep per-thread state in the component, never in a
   * module-level singleton.
   */
  threadId: string;
  projectId: string;
}

/**
 * Render a plugin component in the gutter to the right of an open thread's
 * composer.
 *
 * The host sizes the region for you: the width is the space right of the
 * thread column minus the table-of-contents reserve, at most 18rem; the height
 * is capped at 12rem (`max-h-48`) and scrolls (`overflow-y-auto`), so nothing
 * is clipped silently. The host hides the region when that space is narrower
 * than about 15rem — a pane narrower than about 1240px. The host provides the
 * region landmark named with `title`; do not render your own.
 *
 * Render an element. Output that is only text (or nothing) counts as empty,
 * and the host removes the empty region from the accessibility tree.
 */
export interface PluginComposerAsideRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Names the region the host wraps around your component. */
  title: string;
  component: ComponentType<PluginComposerAsideProps>;
}

export interface ForkPluginAppSlots {
  /**
   * Render a component in the gutter beside an open thread's composer (see
   * {@link PluginComposerAsideRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_composerAside(
    registration: PluginComposerAsideRegistration,
  ): void;
}
