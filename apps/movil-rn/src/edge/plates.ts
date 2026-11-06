/**
 * License plates on the phone, same rules as the PC node
 * (apps/vision/vigia_vision/plate_ocr.py, docs/modeling/license-plates.md):
 *
 * - the plate is searched only inside a confirmed vehicle, in the camera's
 *   full-resolution frame, and read only when it is at least 45 px wide
 *   (below that, fewer than 40 % of the plates were read whole);
 * - a read counts only with every character at probability ≥ 0.5 and a
 *   Colombian format (ABC123; motorcycles ABC12 or ABC12D);
 * - a track reports a plate when one text appears at least twice and does not
 *   tie with another. Otherwise it stays null: unknown beats a wrong plate,
 *   which would point at another vehicle.
 */
import { toUpright } from './preprocess';
import type { Box, Letterbox } from './types';

export const minPlateWidthPx = 45;
export const minCharConfidence = 0.5;
export const minPlateVotes = 2;
export const maxPlateReads = 6;
/** Plate detector score, as PLATE_CONFIDENCE on the PC node. */
export const plateDetectorMinScore = 0.45;
/** Margin added around the vehicle before searching its plate (PC node: 4 %). */
export const vehicleMargin = 0.04;

const colombianPlate = /^(?:[A-Z]{3}[0-9]{3}|[A-Z]{3}[0-9]{2}[A-Z]?)$/;

export function validPlate(text: string): boolean {
  return colombianPlate.test(text);
}

/** What one plate attempt on a vehicle gave. */
export type PlateAttempt =
  | { status: 'none' }
  | { status: 'small'; widthPx: number }
  | { status: 'read'; widthPx: number; text: string; confidence: number }
  | { status: 'error'; message: string };

export class PlateReads {
  private readonly texts = new Map<string, number>();
  /** Attempts that reached the OCR (big enough plates), legible or not. */
  reads = 0;
  /** Every attempt, to stop searching a vehicle whose plate never shows. */
  attempts = 0;
  /** Vehicle box area at the last attempt: a new one waits for a better view. */
  lastArea = 0;
  lastAt: number | null = null;

  add(attempt: PlateAttempt, area: number, now: number): void {
    this.attempts++;
    this.lastArea = Math.max(this.lastArea, area);
    this.lastAt = now;
    if (attempt.status !== 'read') return;
    this.reads++;
    if (attempt.confidence >= minCharConfidence && validPlate(attempt.text)) {
      this.texts.set(attempt.text, (this.texts.get(attempt.text) ?? 0) + 1);
    }
  }

  get plate(): string | null {
    const ranked = [...this.texts.entries()].sort((left, right) => right[1] - left[1]);
    const first = ranked[0];
    if (!first || first[1] < minPlateVotes) return null;
    const second = ranked[1];
    if (second && second[1] === first[1]) return null; // A tie: neither is trustworthy.
    return first[0];
  }

  wantsRead(): boolean {
    return this.reads < maxPlateReads && this.attempts < maxPlateReads * 3;
  }
}

/**
 * Best plate of a [1, 300, 6] end-to-end YOLO output (x1, y1, x2, y2, score,
 * class in model-input pixels or normalized), mapped back to region pixels.
 */
export function decodeBestPlate(output: Float32Array, letterbox: Letterbox, minScore: number): (Box & { score: number }) | null {
  // No default value from a module constant here: the worklets plugin does not
  // capture identifiers used only in default parameters ("Property
  // 'plateDetectorMinScore' doesn't exist" on the phone).
  'worklet';
  const rows = Math.floor(output.length / 6);
  let maxCoordinate = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < 4; column++) maxCoordinate = Math.max(maxCoordinate, Math.abs(output[row * 6 + column] ?? 0));
  }
  const factor = maxCoordinate <= 1.5 ? letterbox.size : 1;
  let best: (Box & { score: number }) | null = null;
  for (let row = 0; row < rows; row++) {
    const score = output[row * 6 + 4] ?? 0;
    if (score < minScore || (best && score <= best.score)) continue;
    const [x1, y1] = toUpright(letterbox, (output[row * 6] ?? 0) * factor, (output[row * 6 + 1] ?? 0) * factor);
    const [x2, y2] = toUpright(letterbox, (output[row * 6 + 2] ?? 0) * factor, (output[row * 6 + 3] ?? 0) * factor);
    best = {
      x1: Math.max(0, Math.min(letterbox.uprightWidth, x1)),
      y1: Math.max(0, Math.min(letterbox.uprightHeight, y1)),
      x2: Math.max(0, Math.min(letterbox.uprightWidth, x2)),
      y2: Math.max(0, Math.min(letterbox.uprightHeight, y2)),
      score,
    };
  }
  return best && best.x2 > best.x1 && best.y2 > best.y1 ? best : null;
}

/**
 * Most likely character per slot, padding removed; the confidence is the one
 * of the least sure character kept (as fast-plate-ocr and the PC node).
 */
export function decodePlateText(
  probabilities: Float32Array,
  alphabet: string,
  slots: number,
  padChar: string,
): { text: string; confidence: number } {
  'worklet';
  const classes = alphabet.length;
  let text = '';
  const confidences: number[] = [];
  for (let slot = 0; slot < slots; slot++) {
    let best = 0;
    let bestIndex = 0;
    for (let index = 0; index < classes; index++) {
      const value = probabilities[slot * classes + index] ?? 0;
      if (value > best) {
        best = value;
        bestIndex = index;
      }
    }
    text += alphabet[bestIndex] ?? padChar;
    confidences.push(best);
  }
  let end = text.length;
  while (end > 0 && text[end - 1] === padChar) end--;
  const kept = confidences.slice(0, end);
  return { text: text.slice(0, end), confidence: kept.length ? Math.min(...kept) : 0 };
}
