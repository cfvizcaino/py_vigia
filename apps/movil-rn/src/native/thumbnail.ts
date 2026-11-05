import { requireOptionalNativeModule } from 'expo-modules-core';

import { base64ToBytes } from '../edge/outbox';
import type { EncodeThumbnail } from '../edge/engine';

interface NativeThumbnailEncoder {
  encodeRgbJpeg(pixels: Uint8Array, width: number, height: number, quality: number): Promise<string>;
}

/** JPEG quality of the recortes, as in Flutter (≈10 KB; the central accepts up to 64 KB). */
const thumbnailQuality = 80;

/** Native JPEG encoder for recortes, or null where the module is missing (iOS, tests). */
export function createThumbnailEncoder(): EncodeThumbnail | null {
  const native = requireOptionalNativeModule<NativeThumbnailEncoder>('VigiaCameraServer');
  if (!native) return null;
  return async ({ rgb, width, height }) =>
    base64ToBytes(await native.encodeRgbJpeg(rgb, width, height, thumbnailQuality));
}
