import { describe, expect, it } from "vitest";
import {
  isImageDataUri,
  parseImageDataUri,
  PLUGIN_ICON_MAX_BYTES,
} from "../src/index.js";

describe("image data URIs", () => {
  it("decodes a base64 svg, png, or webp image", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const parsed = parseImageDataUri(`data:image/svg+xml;base64,${btoa(svg)}`);
    expect(parsed?.contentType).toBe("image/svg+xml");
    expect(new TextDecoder().decode(parsed?.bytes)).toBe(svg);
    expect(
      parseImageDataUri("data:image/png;base64,iVBORw0K")?.contentType,
    ).toBe("image/png");
    expect(isImageDataUri("data:image/webp;base64,UklGRg==")).toBe(true);
    expect(isImageDataUri("Zap")).toBe(false);
  });

  it("refuses other types, non-base64 payloads, and oversized images", () => {
    for (const icon of [
      "data:text/html;base64,PGgxPg==",
      "data:image/svg+xml,<svg/>",
      "data:image/png;base64,",
      "data:image/png;base64,not base64!",
      `data:image/png;base64,${btoa("x".repeat(PLUGIN_ICON_MAX_BYTES + 1))}`,
    ]) {
      expect(parseImageDataUri(icon), icon).toBeNull();
    }
  });
});
