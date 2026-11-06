import { PLUGIN_ICON_MAX_BYTES } from "./plugin-icon.js";

const IMAGE_DATA_URI_PATTERN =
  /^data:(image\/(?:svg\+xml|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u;

export function isImageDataUri(icon: string): boolean {
  return icon.startsWith("data:");
}

export function parseImageDataUri(
  icon: string,
): { bytes: Uint8Array; contentType: string } | null {
  const match = IMAGE_DATA_URI_PATTERN.exec(icon);
  const contentType = match?.[1];
  const encoded = match?.[2];
  if (contentType === undefined || encoded === undefined) {
    return null;
  }
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return null;
  }
  if (decoded.length > PLUGIN_ICON_MAX_BYTES) {
    return null;
  }
  return {
    bytes: Uint8Array.from(decoded, (char) => char.charCodeAt(0)),
    contentType,
  };
}
