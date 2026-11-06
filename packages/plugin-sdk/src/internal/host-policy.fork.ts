import {
  parseImageDataUri,
  PLUGIN_ICON_MAX_BYTES,
} from "@bb/domain/plugin-icon";

export function validateProviderIconDataUri(id: string, icon: string): string {
  if (parseImageDataUri(icon) === null) {
    throw new Error(
      `provider "${id}" icon data URI must be a base64 SVG, PNG, or WebP image of at most ${PLUGIN_ICON_MAX_BYTES} bytes`,
    );
  }
  return icon;
}
