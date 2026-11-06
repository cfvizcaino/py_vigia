import type { Box, FrameData, Letterbox, ModelInput } from './types';

const PAD_VALUE = 114 / 255;
const INV_255 = 1 / 255;

function clamp(value: number): number {
  'worklet';
  return Math.max(0, Math.min(255, value));
}

function readRgb(frame: FrameData, x: number, y: number): [number, number, number] {
  'worklet';
  if (frame.format === 'bgra8888' || frame.format === 'rgba8888' || frame.format === 'rgb888') {
    const plane = frame.planes[0];
    if (!plane) throw new RangeError('El frame BGRA no contiene plano.');
    const bytesPerPixel = plane.bytesPerPixel ?? (frame.format === 'rgb888' ? 3 : 4);
    const pixel = y * plane.bytesPerRow + x * bytesPerPixel;
    if (frame.format === 'rgba8888' || frame.format === 'rgb888') {
      return [plane.bytes[pixel] ?? 0, plane.bytes[pixel + 1] ?? 0, plane.bytes[pixel + 2] ?? 0];
    }
    return [plane.bytes[pixel + 2] ?? 0, plane.bytes[pixel + 1] ?? 0, plane.bytes[pixel] ?? 0];
  }

  const [luma, uPlane, vPlane] = frame.planes;
  if (!luma || !uPlane || (frame.planes.length !== 2 && !vPlane)) {
    throw new RangeError('El frame YUV420 no contiene planos suficientes.');
  }
  const yy = luma.bytes[y * luma.bytesPerRow + x] ?? 0;
  const uvX = Math.floor(x / 2);
  const uvY = Math.floor(y / 2);
  const interleaved = frame.planes.length === 2;
  const uPixelStride = interleaved ? 2 : (uPlane.bytesPerPixel ?? 1);
  const vPixelStride = interleaved ? 2 : (vPlane?.bytesPerPixel ?? 1);
  const uIndex = uvY * uPlane.bytesPerRow + uvX * uPixelStride;
  const vIndex = interleaved ? uIndex + 1 : uvY * (vPlane?.bytesPerRow ?? 0) + uvX * vPixelStride;
  const cb = (uPlane.bytes[uIndex] ?? 128) - 128;
  const cr = ((interleaved ? uPlane.bytes[vIndex] : vPlane?.bytes[vIndex]) ?? 128) - 128;
  return [
    clamp(yy + ((91881 * cr) >> 16)),
    clamp(yy - ((22554 * cb + 46802 * cr) >> 16)),
    clamp(yy + ((116130 * cb) >> 16)),
  ];
}

export function uprightToSensor(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
): [number, number] {
  'worklet';
  if (rotation === 90) return [y, height - 1 - x];
  if (rotation === 180) return [width - 1 - x, height - 1 - y];
  if (rotation === 270) return [width - 1 - y, x];
  return [x, y];
}

/**
 * Where upright pixel (ux, uy) of a packed RGB frame starts in its bytes:
 * base + ux * stepX + uy * stepY. Rotation becomes signed steps, so the hot
 * loops below do additions instead of a function call and two arrays per
 * pixel (Hermes has no JIT: that was ~130 ms per frame). Null for YUV frames,
 * which keep the per-pixel path.
 */
interface PackedLayout {
  bytes: Uint8Array;
  base: number;
  stepX: number;
  stepY: number;
  red: number;
  green: number;
  blue: number;
}

function packedLayout(frame: FrameData, rotation: number): PackedLayout | null {
  'worklet';
  if (frame.format === 'yuv420') return null;
  const plane = frame.planes[0];
  if (!plane) throw new RangeError('El frame RGB no contiene plano.');
  const pixel = plane.bytesPerPixel ?? (frame.format === 'rgb888' ? 3 : 4);
  const row = plane.bytesPerRow;
  const lastX = (frame.width - 1) * pixel;
  const lastY = (frame.height - 1) * row;
  // Same mapping as uprightToSensor, as byte offsets.
  let base = 0;
  let stepX = pixel;
  let stepY = row;
  if (rotation === 90) {
    base = lastY;
    stepX = -row;
    stepY = pixel;
  } else if (rotation === 180) {
    base = lastX + lastY;
    stepX = -pixel;
    stepY = -row;
  } else if (rotation === 270) {
    base = lastX;
    stepX = row;
    stepY = -pixel;
  }
  const bgr = frame.format === 'bgra8888';
  return { bytes: plane.bytes, base, stepX, stepY, red: bgr ? 2 : 0, green: 1, blue: bgr ? 0 : 2 };
}

export function toUpright(letterbox: Letterbox, x: number, y: number): [number, number] {
  'worklet';
  return [(x - letterbox.padX) / letterbox.scale, (y - letterbox.padY) / letterbox.scale];
}

export function prepareInput(frame: FrameData, size: number, channelsFirst = false): ModelInput {
  'worklet';
  const rotation = ((frame.rotationDegrees ?? 0) % 360 + 360) % 360;
  const turned = rotation === 90 || rotation === 270;
  const uprightWidth = turned ? frame.height : frame.width;
  const uprightHeight = turned ? frame.width : frame.height;
  const scale = Math.min(size / uprightWidth, size / uprightHeight);
  const contentWidth = Math.round(uprightWidth * scale);
  const contentHeight = Math.round(uprightHeight * scale);
  const padX = Math.floor((size - contentWidth) / 2);
  const padY = Math.floor((size - contentHeight) / 2);
  const pixels = new Float32Array(size * size * 3);
  pixels.fill(PAD_VALUE);
  const plane = size * size;
  const channelStride = channelsFirst ? plane : 1;
  const pixelStride = channelsFirst ? 1 : 3;
  const letterbox = { size, scale, padX, padY, uprightWidth, uprightHeight };

  const layout = packedLayout(frame, rotation);
  if (layout) {
    const { bytes, base, stepX, stepY, red, green, blue } = layout;
    const columns = new Int32Array(contentWidth);
    for (let ox = 0; ox < contentWidth; ox++) {
      columns[ox] = Math.min(Math.floor((ox + 0.5) / scale), uprightWidth - 1) * stepX;
    }
    const greenStride = channelStride;
    const blueStride = channelStride * 2;
    for (let oy = 0; oy < contentHeight; oy++) {
      const rowBase = base + Math.min(Math.floor((oy + 0.5) / scale), uprightHeight - 1) * stepY;
      let index = ((padY + oy) * size + padX) * pixelStride;
      for (let ox = 0; ox < contentWidth; ox++) {
        const offset = rowBase + (columns[ox] as number);
        pixels[index] = (bytes[offset + red] as number) * INV_255;
        pixels[index + greenStride] = (bytes[offset + green] as number) * INV_255;
        pixels[index + blueStride] = (bytes[offset + blue] as number) * INV_255;
        index += pixelStride;
      }
    }
    return { pixels, letterbox };
  }

  for (let oy = 0; oy < contentHeight; oy++) {
    const uy = Math.min(Math.floor((oy + 0.5) / scale), uprightHeight - 1);
    let index = ((padY + oy) * size + padX) * pixelStride;
    for (let ox = 0; ox < contentWidth; ox++) {
      const ux = Math.min(Math.floor((ox + 0.5) / scale), uprightWidth - 1);
      const [sx, sy] = uprightToSensor(ux, uy, frame.width, frame.height, rotation);
      const [red, green, blue] = readRgb(frame, sx, sy);
      pixels[index] = red / 255;
      pixels[index + channelStride] = green / 255;
      pixels[index + channelStride * 2] = blue / 255;
      index += pixelStride;
    }
  }
  return { pixels, letterbox };
}

export function prepareCrop(frame: FrameData, box: Box, size: number, channelsFirst = false): Float32Array {
  'worklet';
  const rotation = ((frame.rotationDegrees ?? 0) % 360 + 360) % 360;
  const turned = rotation === 90 || rotation === 270;
  const width = turned ? frame.height : frame.width;
  const height = turned ? frame.width : frame.height;
  const side = Math.max(1, Math.min(Math.round(Math.min(box.x2 - box.x1, box.y2 - box.y1)), width, height));
  const left = Math.max(0, Math.min(width - side, Math.round(box.x1 + (box.x2 - box.x1 - side) / 2)));
  const top = Math.max(0, Math.min(height - side, Math.round(box.y1 + (box.y2 - box.y1 - side) / 2)));
  const out = new Float32Array(size * size * 3);
  const plane = size * size;

  const layout = packedLayout(frame, rotation);
  if (layout) {
    const { bytes, base, stepX, stepY, red, green, blue } = layout;
    const columns = new Int32Array(size);
    for (let x = 0; x < size; x++) {
      columns[x] = (left + Math.min(side - 1, Math.floor((x + 0.5) * side / size))) * stepX;
    }
    const channelStride = channelsFirst ? plane : 1;
    const pixelStride = channelsFirst ? 1 : 3;
    const blueStride = channelStride * 2;
    let index = 0;
    for (let y = 0; y < size; y++) {
      const rowBase = base + (top + Math.min(side - 1, Math.floor((y + 0.5) * side / size))) * stepY;
      for (let x = 0; x < size; x++) {
        const offset = rowBase + (columns[x] as number);
        out[index] = (bytes[offset + red] as number) * INV_255;
        out[index + channelStride] = (bytes[offset + green] as number) * INV_255;
        out[index + blueStride] = (bytes[offset + blue] as number) * INV_255;
        index += pixelStride;
      }
    }
    return out;
  }

  for (let y = 0; y < size; y++) {
    const uy = top + Math.min(side - 1, Math.floor((y + 0.5) * side / size));
    for (let x = 0; x < size; x++) {
      const ux = left + Math.min(side - 1, Math.floor((x + 0.5) * side / size));
      const [sx, sy] = uprightToSensor(ux, uy, frame.width, frame.height, rotation);
      const [red, green, blue] = readRgb(frame, sx, sy);
      const pixel = y * size + x;
      if (channelsFirst) {
        out[pixel] = red / 255;
        out[plane + pixel] = green / 255;
        out[plane * 2 + pixel] = blue / 255;
      } else {
        out[pixel * 3] = red / 255;
        out[pixel * 3 + 1] = green / 255;
        out[pixel * 3 + 2] = blue / 255;
      }
    }
  }
  return out;
}

export interface ThumbnailPixels {
  rgb: Uint8Array;
  width: number;
  height: number;
}

/**
 * The recorte an admin sees to confirm a detection, as in the Flutter app: the
 * vehicle's box plus a 10 % margin, upright, longest side at most [maxSide].
 * Each output pixel averages a block of the frame, so a large box stays sharp.
 * Returns raw RGB; the JPEG is encoded natively.
 */
export function prepareThumbnail(frame: FrameData, box: Box, maxSide = 224, margin = 0.1): ThumbnailPixels {
  'worklet';
  const rotation = ((frame.rotationDegrees ?? 0) % 360 + 360) % 360;
  const turned = rotation === 90 || rotation === 270;
  const uprightWidth = turned ? frame.height : frame.width;
  const uprightHeight = turned ? frame.width : frame.height;
  const padX = (box.x2 - box.x1) * margin;
  const padY = (box.y2 - box.y1) * margin;
  const left = Math.max(0, Math.min(uprightWidth - 1, Math.floor(box.x1 - padX)));
  const top = Math.max(0, Math.min(uprightHeight - 1, Math.floor(box.y1 - padY)));
  const right = Math.max(left + 1, Math.min(uprightWidth, Math.ceil(box.x2 + padX)));
  const bottom = Math.max(top + 1, Math.min(uprightHeight, Math.ceil(box.y2 + padY)));
  const width = right - left;
  const height = bottom - top;
  const step = Math.max(1, Math.ceil(Math.max(width, height) / maxSide));
  const outWidth = Math.max(1, Math.floor(width / step));
  const outHeight = Math.max(1, Math.floor(height / step));
  const rgb = new Uint8Array(outWidth * outHeight * 3);
  const scale = 1 / (step * step);
  const layout = packedLayout(frame, rotation);
  if (layout) {
    const { bytes, base, stepX, stepY, red, green, blue } = layout;
    let offsetOut = 0;
    for (let oy = 0; oy < outHeight; oy++) {
      const blockTop = base + (top + oy * step) * stepY;
      for (let ox = 0; ox < outWidth; ox++) {
        const blockStart = blockTop + (left + ox * step) * stepX;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let dy = 0; dy < step; dy++) {
          let offset = blockStart + dy * stepY;
          for (let dx = 0; dx < step; dx++) {
            r += bytes[offset + red] as number;
            g += bytes[offset + green] as number;
            b += bytes[offset + blue] as number;
            offset += stepX;
          }
        }
        rgb[offsetOut] = Math.round(r * scale);
        rgb[offsetOut + 1] = Math.round(g * scale);
        rgb[offsetOut + 2] = Math.round(b * scale);
        offsetOut += 3;
      }
    }
    return { rgb, width: outWidth, height: outHeight };
  }
  for (let oy = 0; oy < outHeight; oy++) {
    for (let ox = 0; ox < outWidth; ox++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let dy = 0; dy < step; dy++) {
        const uy = top + oy * step + dy;
        for (let dx = 0; dx < step; dx++) {
          const ux = left + ox * step + dx;
          const [sx, sy] = uprightToSensor(ux, uy, frame.width, frame.height, rotation);
          const [r, g, b] = readRgb(frame, sx, sy);
          red += r;
          green += g;
          blue += b;
        }
      }
      const offset = (oy * outWidth + ox) * 3;
      rgb[offset] = Math.round(red * scale);
      rgb[offset + 1] = Math.round(green * scale);
      rgb[offset + 2] = Math.round(blue * scale);
    }
  }
  return { rgb, width: outWidth, height: outHeight };
}
