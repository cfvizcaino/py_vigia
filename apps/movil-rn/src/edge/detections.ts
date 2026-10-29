import { toUpright } from './preprocess';
import type { Box, Detection, Letterbox } from './types';

export const vehicleLabels: Readonly<Record<number, Detection['label']>> = {
  2: 'car',
  3: 'motorcycle',
};

export function decodeYolo(
  output: Float32Array,
  shape: number[],
  letterbox: Letterbox,
  labels: Readonly<Record<number, Detection['label']>> = vehicleLabels,
  minScore = 0.35,
  iouThreshold = 0.5,
): Detection[] {
  'worklet';
  if (shape.length !== 3 || shape[0] !== 1) throw new RangeError(`Salida de modelo no soportada: ${shape.join(',')}`);
  const raw: Detection[] = [];
  const modelSize = letterbox.size;

  if (shape[2] === 6) {
    const rows = shape[1] ?? 0;
    const factor = looksNormalized(output, rows, 6, [0, 1, 2, 3]) ? modelSize : 1;
    for (let row = 0; row < rows; row++) {
      const base = row * 6;
      const score = output[base + 4] ?? 0;
      if (score < minScore) continue;
      const label = labels[Math.round(output[base + 5] ?? -1)];
      if (!label) continue;
      raw.push(convertDetection(
        (output[base] ?? 0) * factor,
        (output[base + 1] ?? 0) * factor,
        (output[base + 2] ?? 0) * factor,
        (output[base + 3] ?? 0) * factor,
        score,
        label,
        letterbox,
      ));
    }
    return raw;
  }

  const channels = shape[1] ?? 0;
  const anchors = shape[2] ?? 0;
  if (channels < 5) throw new RangeError(`Salida de modelo no soportada: ${shape.join(',')}`);
  const factor = looksNormalizedChannelsFirst(output, anchors) ? modelSize : 1;
  for (let anchor = 0; anchor < anchors; anchor++) {
    let bestScore = 0;
    let bestClass = -1;
    for (let channel = 4; channel < channels; channel++) {
      const score = output[channel * anchors + anchor] ?? 0;
      if (score > bestScore) {
        bestScore = score;
        bestClass = channel - 4;
      }
    }
    const label = labels[bestClass];
    if (!label || bestScore < minScore) continue;
    const centerX = (output[anchor] ?? 0) * factor;
    const centerY = (output[anchors + anchor] ?? 0) * factor;
    const width = (output[2 * anchors + anchor] ?? 0) * factor;
    const height = (output[3 * anchors + anchor] ?? 0) * factor;
    raw.push(convertDetection(
      centerX - width / 2,
      centerY - height / 2,
      centerX + width / 2,
      centerY + height / 2,
      bestScore,
      label,
      letterbox,
    ));
  }
  return nonMaxSuppression(raw, iouThreshold);
}

export function intersectionOverUnion(left: Box, right: Box): number {
  'worklet';
  const width = Math.min(left.x2, right.x2) - Math.max(left.x1, right.x1);
  const height = Math.min(left.y2, right.y2) - Math.max(left.y1, right.y1);
  if (width <= 0 || height <= 0) return 0;
  const intersection = width * height;
  const union = boxArea(left) + boxArea(right) - intersection;
  return union > 0 ? intersection / union : 0;
}

export function nonMaxSuppression(detections: Detection[], threshold = 0.5): Detection[] {
  'worklet';
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const candidate of sorted) {
    if (kept.every((item) => item.label !== candidate.label || intersectionOverUnion(item.box, candidate.box) < threshold)) {
      kept.push(candidate);
    }
  }
  return kept;
}

function convertDetection(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  score: number,
  label: Detection['label'],
  letterbox: Letterbox,
): Detection {
  'worklet';
  const [uprightX1, uprightY1] = toUpright(letterbox, x1, y1);
  const [uprightX2, uprightY2] = toUpright(letterbox, x2, y2);
  return {
    box: {
      x1: clamp(uprightX1, letterbox.uprightWidth),
      y1: clamp(uprightY1, letterbox.uprightHeight),
      x2: clamp(uprightX2, letterbox.uprightWidth),
      y2: clamp(uprightY2, letterbox.uprightHeight),
    },
    score,
    label,
  };
}

function looksNormalized(output: Float32Array, rows: number, stride: number, columns: number[]): boolean {
  'worklet';
  let max = 0;
  for (let row = 0; row < rows; row++) {
    for (const column of columns) max = Math.max(max, Math.abs(output[row * stride + column] ?? 0));
  }
  return max <= 1.5;
}

function looksNormalizedChannelsFirst(output: Float32Array, anchors: number): boolean {
  'worklet';
  let max = 0;
  for (let index = 0; index < 4 * anchors; index++) max = Math.max(max, Math.abs(output[index] ?? 0));
  return max <= 1.5;
}

function clamp(value: number, max: number): number {
  'worklet';
  return Math.max(0, Math.min(max, value));
}

function boxArea(box: Box): number {
  'worklet';
  return Math.max(0, box.x2 - box.x1) * Math.max(0, box.y2 - box.y1);
}
