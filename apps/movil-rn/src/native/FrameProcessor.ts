import { useCallback, useMemo } from 'react';
import { useFrameOutput } from 'react-native-vision-camera';
import type { CameraFrameOutput, Frame } from 'react-native-vision-camera';
import { scheduleOnRN } from 'react-native-worklets';
import type { TfliteModel } from 'react-native-fast-tflite';
import { NitroModules } from 'react-native-nitro-modules';
import { useSharedValue } from 'react-native-reanimated';

import { decodeYolo, intersectionOverUnion } from '../edge/detections';
import { prepareCrop, prepareInput, prepareThumbnail } from '../edge/preprocess';
import type { ThumbnailPixels } from '../edge/preprocess';
import type { Box, Detection, FrameData } from '../edge/types';
import { rotationForOrientation } from './orientation';

// Module constants: VisionCamera memoizes the output on these values, so an
// inline object would rebuild the camera session on every render.
const frameResolution = { width: 640, height: 480 };
const thumbnailMinSidePx = 32;

/** A vehicle that still needs a colour vote: where its box is expected. */
export interface ColorGate {
  box: Box;
}

/** Colour crops per frame at most, so detection keeps its pace (as in Flutter). */
const maxColorCropsPerFrame = 3;
const colorMinSidePx = 24;
const gateMatchIou = 0.3;

/** Where a recorte is still wanted: a track's box and the area it must reach. */
export interface ThumbnailGate {
  box: Box;
  minArea: number;
}

/** Milliseconds spent in each step of one frame, to find what limits the pace. */
export interface StageTimings {
  /** Reading the frame and building the 320×320 model input. */
  prepare: number;
  /** Vehicle detector (TFLite). */
  detect: number;
  /** Turning the detector output into boxes. */
  decode: number;
  /** Colour crops plus colour model, for every crop of the frame. */
  color: number;
  colorCrops: number;
  /** Recorte pixels for the admin's confirmation. */
  thumbnail: number;
  /** Whole frame, from reading it to handing the result over. */
  total: number;
  /** Wall clock when the worklet finished, to measure the hand-over to JS. */
  finishedAt: number;
}

export interface FrameProcessingResult {
  detections: Detection[];
  colorVotes: (Record<string, number> | null)[];
  colorFailureCount: number;
  elapsedMs: number;
  timings?: StageTimings;
  frameNumber: number;
  /** Upright frame size (after every rotation), the space of the boxes. */
  frameSize: { width: number; height: number };
  /** Recorte of one detection (by index), when its view improved. */
  thumbnail: (ThumbnailPixels & { detectionIndex: number }) | null;
}

export function useVehicleFrameOutput(input: {
  detector: TfliteModel | null;
  colorModel: TfliteModel | null;
  inputSize: number;
  detectorShape: number[];
  detectorLabels: Readonly<Record<number, Detection['label']>>;
  colorLabels: Readonly<Record<number, string>>;
  fps: number;
  extraRotation: number;
  onFrameResult: (result: FrameProcessingResult) => void;
  onFrameError: (message: string) => void;
}): {
  output: CameraFrameOutput;
  setThumbnailGates: (gates: ThumbnailGate[] | null) => void;
  setColorGates: (gates: ColorGate[]) => void;
} {
  const lastFrameTimestamp = useSharedValue(0);
  // null: the central keeps no recortes (or none wanted yet), so none are made.
  const thumbnailGates = useSharedValue<ThumbnailGate[] | null>(null);
  // Empty until the engine confirms a vehicle: no colour work before that.
  const colorGates = useSharedValue<ColorGate[]>([]);
  // TfliteModel is a Nitro HybridObject (jsi::NativeState): captured as-is, the
  // worklet runtime sees an object without methods ("undefined is not a
  // function" on runSync). Boxing makes it a HostObject the worklet can unbox.
  const boxedDetector = useMemo(() => (input.detector ? NitroModules.box(input.detector) : null), [input.detector]);
  const boxedColorModel = useMemo(() => (input.colorModel ? NitroModules.box(input.colorModel) : null), [input.colorModel]);
  const output = useFrameOutput({
    targetResolution: frameResolution,
    pixelFormat: 'rgb',
    dropFramesWhileBusy: true,
    enablePreviewSizedOutputBuffers: true,
    onFrame(frame) {
      'worklet';
      const startedAt = Date.now();
      const t0 = performance.now();
      const minimumInterval = 1000 / input.fps;
      if (lastFrameTimestamp.value !== 0 && startedAt - lastFrameTimestamp.value < minimumInterval) {
        frame.dispose();
        return;
      }
      lastFrameTimestamp.value = startedAt;
      try {
        if (!boxedDetector) {
          return;
        }
        const detector = boxedDetector.unbox();
        const colorModel = boxedColorModel ? boxedColorModel.unbox() : null;
        const frameData = readFrame(frame, input.extraRotation);
        const modelInput = prepareInput(frameData, input.inputSize, true);
        const tPrepared = performance.now();
        const rawOutput = detector.runSync([modelInput.pixels.buffer as ArrayBuffer])[0];
        const tDetected = performance.now();
        if (!rawOutput) throw new Error('El detector no devolvió tensores de salida.');
        const detections = decodeYolo(
          new Float32Array(rawOutput),
          input.detectorShape,
          modelInput.letterbox,
          input.detectorLabels,
          0.1,
        );
        const tDecoded = performance.now();
        let colorCrops = 0;
        const colorVotes: (Record<string, number> | null)[] = detections.map(() => null);
        let colorFailureCount = 0;
        if (colorModel) {
          const wanted = pickColorDetections(detections, colorGates.value);
          for (const index of wanted) {
            const detection = detections[index];
            if (!detection) continue;
            colorCrops++;
            try {
              const crop = prepareCrop(frameData, detection.box, 128, true);
              const output = colorModel.runSync([crop.buffer as ArrayBuffer])[0];
              if (!output) continue;
              const probabilities = new Float32Array(output);
              const votes: Record<string, number> = {};
              for (let classId = 0; classId < probabilities.length; classId++) {
                const label = input.colorLabels[classId];
                const probability = probabilities[classId];
                if (label && probability !== undefined) votes[label] = probability;
              }
              colorVotes[index] = votes;
            } catch {
              colorVotes[index] = null;
              colorFailureCount++;
            }
          }
        }
        const tColored = performance.now();
        const gates = thumbnailGates.value;
        const thumbnail = gates ? pickThumbnail(frameData, detections, gates) : null;
        const tDone = performance.now();
        const elapsedMs = Date.now() - startedAt;
        const timings: StageTimings = {
          prepare: tPrepared - t0,
          detect: tDetected - tPrepared,
          decode: tDecoded - tDetected,
          color: tColored - tDecoded,
          colorCrops,
          thumbnail: tDone - tColored,
          total: tDone - t0,
          finishedAt: Date.now(),
        };
        if (elapsedMs > 10_000) {
          scheduleOnRN(input.onFrameError, 'La inferencia tardó más de 10 segundos; se descartó este frame.');
        } else {
          scheduleOnRN(input.onFrameResult, {
            detections,
            colorVotes,
            colorFailureCount,
            elapsedMs,
            timings,
            frameNumber: startedAt,
            frameSize: {
              width: modelInput.letterbox.uprightWidth,
              height: modelInput.letterbox.uprightHeight,
            },
            thumbnail,
          });
        }
      } catch (error) {
        scheduleOnRN(
          input.onFrameError,
          error instanceof Error ? error.message : 'No fue posible procesar el frame de cámara.',
        );
      } finally {
        frame.dispose();
      }
    },
  });
  const setThumbnailGates = useCallback((gates: ThumbnailGate[] | null) => {
    thumbnailGates.set(gates);
  }, [thumbnailGates]);
  const setColorGates = useCallback((gates: ColorGate[]) => {
    colorGates.set(gates);
  }, [colorGates]);
  return { output, setThumbnailGates, setColorGates };
}

/**
 * Detections to classify for colour: for each gate in order (fewest votes
 * first), the unused detection that overlaps it most, if big enough.
 */
export function pickColorDetections(detections: Detection[], gates: ColorGate[]): number[] {
  'worklet';
  const chosen: number[] = [];
  for (const gate of gates) {
    if (chosen.length >= maxColorCropsPerFrame) break;
    let bestIndex = -1;
    let bestOverlap = gateMatchIou;
    for (let index = 0; index < detections.length; index++) {
      const detection = detections[index];
      if (!detection || chosen.includes(index)) continue;
      if (detection.box.x2 - detection.box.x1 < colorMinSidePx || detection.box.y2 - detection.box.y1 < colorMinSidePx) continue;
      const overlap = intersectionOverUnion(gate.box, detection.box);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) chosen.push(bestIndex);
  }
  return chosen;
}

/**
 * One recorte per frame at most, as in Flutter: the biggest detection whose
 * confirmed track still wants a better view (a first one, or its box grew).
 */
export function pickThumbnail(
  frame: FrameData,
  detections: Detection[],
  gates: ThumbnailGate[],
): (ThumbnailPixels & { detectionIndex: number }) | null {
  'worklet';
  let bestIndex = -1;
  let bestArea = 0;
  for (let index = 0; index < detections.length; index++) {
    const detection = detections[index];
    if (!detection) continue;
    const width = detection.box.x2 - detection.box.x1;
    const height = detection.box.y2 - detection.box.y1;
    if (width < thumbnailMinSidePx || height < thumbnailMinSidePx) continue;
    const area = width * height;
    // Only confirmed tracks have a gate: a detection matching none would be a
    // one-frame flicker or a track the engine is not ready to keep a view of.
    let minArea = -1;
    for (const gate of gates) {
      if (intersectionOverUnion(gate.box, detection.box) > gateMatchIou) minArea = Math.max(minArea, gate.minArea);
    }
    if (minArea >= 0 && area >= minArea && area > bestArea) {
      bestArea = area;
      bestIndex = index;
    }
  }
  const chosen = detections[bestIndex];
  if (!chosen) return null;
  return { ...prepareThumbnail(frame, chosen.box), detectionIndex: bestIndex };
}

function readFrame(frame: Frame, extraRotation: number): FrameData {
  'worklet';
  const rotation = rotationForOrientation(frame.orientation, extraRotation);
  if (frame.isPlanar) {
    return {
      format: 'yuv420',
      width: frame.width,
      height: frame.height,
      rotationDegrees: rotation,
      planes: frame.getPlanes().map((plane) => ({
        bytes: new Uint8Array(plane.getPixelBuffer()),
        bytesPerRow: plane.bytesPerRow,
      })),
    };
  }
  const pixelFormat = frame.pixelFormat;
  const format = pixelFormat === 'rgb-bgra-8-bit'
    ? 'bgra8888'
    : pixelFormat === 'rgb-rgba-8-bit'
      ? 'rgba8888'
      : pixelFormat === 'rgb-rgb-8-bit'
        ? 'rgb888'
        : null;
  if (!format) throw new Error(`Formato de frame no compatible: ${pixelFormat}.`);
  const bytesPerPixel = format === 'rgb888' ? 3 : 4;
  return {
    format,
    width: frame.width,
    height: frame.height,
    rotationDegrees: rotation,
    planes: [{
      bytes: new Uint8Array(frame.getPixelBuffer()),
      bytesPerRow: frame.bytesPerRow,
      bytesPerPixel,
    }],
  };
}
