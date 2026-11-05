import type { List, Nodes } from "mdast";
import type {} from "mdast-util-to-hast";
import { visit } from "unist-util-visit";

interface SourceListNumbersFile {
  value: unknown;
}

function readSourceMarkerNumber(
  source: string,
  offset: number | undefined,
): number | null {
  if (offset === undefined) {
    return null;
  }
  const marker = /\d{1,9}(?=[.)])/y;
  marker.lastIndex = offset;
  const match = marker.exec(source);
  return match === null ? null : Number(match[0]);
}

export function remarkSourceListNumbers() {
  return (tree: Nodes, file: SourceListNumbersFile): void => {
    const source = String(file.value);
    visit(tree, "list", (list: List) => {
      if (list.ordered !== true) {
        return;
      }
      const typedNumbers = list.children.map((item) =>
        readSourceMarkerNumber(source, item.position?.start.offset),
      );
      const firstNumber = typedNumbers[0];
      if (
        firstNumber !== null &&
        typedNumbers.every((number) => number === firstNumber)
      ) {
        return;
      }
      list.children.forEach((item, index) => {
        const value = typedNumbers[index];
        if (value === null || value === undefined) {
          return;
        }
        const data = item.data ?? (item.data = {});
        data.hProperties = { ...data.hProperties, value };
      });
    });
  };
}
