import { selectionClipboard } from "./markdown-clipboard";

let bareCodeActive = false;

export function isBareCode(): boolean {
  return bareCodeActive;
}

export function selectionClipboardBare(
  selected: Range,
  root: Element,
  spanFormat: "text" | "markdown",
): { text: string; html: string } {
  bareCodeActive = true;
  try {
    return selectionClipboard(selected, root, spanFormat);
  } finally {
    bareCodeActive = false;
  }
}
