import type { Box, FrameData, Letterbox, ModelInput } from './types';

const PAD_VALUE = 114 / 255;

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
  return {
    pixels,
    letterbox: { size, scale, padX, padY, uprightWidth, uprightHeight },
  };
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

export function toUpright(letterbox: Letterbox, x: number, y: number): [number, number] {
  'worklet';
  return [(x - letterbox.padX) / letterbox.scale, (y - letterbox.padY) / letterbox.scale];
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

function clamp(value: number): number {
  'worklet';
  return Math.max(0, Math.min(255, value));
}
