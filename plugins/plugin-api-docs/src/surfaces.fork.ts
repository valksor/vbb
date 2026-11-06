import type { PluginSurface } from "./surfaces";

export const COMPOSER_ASIDE_SURFACE: PluginSurface = {
  id: "composer-aside",
  title: "Composer aside",
  summary:
    "Add content in the gutter beside an open thread's composer. With this, a plugin can:",
  bullets: [
    "Show live status, checks, or controls next to the prompt box",
    "Keep tall content inside a capped region bb sizes for the gutter",
    "Mount once per open thread pane with that pane's thread and project",
  ],
  apiSymbols: ["PluginComposerAsideRegistration", "PluginComposerAsideProps"],
  experimental: true,
};
