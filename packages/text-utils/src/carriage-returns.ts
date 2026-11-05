export function collapseCarriageReturns(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const segments = line.split("\r").filter((segment) => segment !== "");
      return segments.at(-1) ?? "";
    })
    .join("\n");
}
