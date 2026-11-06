import { useCallback, useMemo } from 'react';
import { useFrameOutput } from 'react-native-vision-camera';
import type { CameraFrameOutput, Frame } from 'react-native-vision-camera';
import { scheduleOnRN } from 'react-native-worklets';
import type { TfliteModel } from 'react-native-fast-tflite';
import { NitroModules } from 'react-native-nitro-modules';
import { useSharedValue } from 'react-native-reanimated';

import { decodeYolo, intersectionOverUnion } from '../edge/detections';
import { decodeBestPlate, decodePlateText, minPlateWidthPx, vehicleMargin } from '../edge/plates';
import type { PlateAttempt } from '../edge/plates';
import { prepareCrop, prepareInput, preparePlate, prepareRegion, prepareThumbnail } from '../edge/preprocess';
import type { ThumbnailPixels } from '../edge/preprocess';
import type { Box, Detection, FrameData } from '../edge/types';
import { rotationForOrientation } from './orientation';

// Module constants: VisionCamera memoizes the output on these values, so an
// inline object would rebuild the camera session on every render.
const frameResolution = { width: 640, height: 480 };
/**
 * With the plate models loaded the camera delivers 1920×1440: the detector
 * still samples only its 320×320 input, but a plate gets ~3× more pixels
 * (the OCR needs ≥ 45 px; at 640 px a plate a few metres away is 8–15 px).
 */
const plateFrameResolution = { width: 1920, height: 1440 };
/**
 * Boxes, tracks and every pixel threshold (colour 24 px, recorte 32 px, the
 * 25 px direction dead zone) live in a 640 px "analysis space", whatever the
 * camera resolution; crops are scaled back to the full frame.
 */
const analysisLongSide = 640;
const thumbnailMinSidePx = 32;

/** At most one plate attempt this often, so vehicle detection keeps its pace. */
const plateIntervalMs = 400;
/** A plate of ≥ 45 px needs a vehicle about this wide (a plate is ~22 % of it). */
const plateMinVehicleWidthPx = 200;

/** A confirmed vehicle whose plate is still wanted: where its box is expected. */
export interface PlateGate {
  box: Box;
}

/** Plate model output names, from the OCR manifest. */
export interface PlateOcrConfig {
  alphabet: string;
  padChar: string;
  slots: number;
}

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
  /** Plate search + OCR on one vehicle (0 on frames without an attempt). */
  plate: number;
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
  /** Plate attempt on one detection (by index), at most one per frame. */
  plate?: { detectionIndex: number; areaPx: number; attempt: PlateAttempt } | null;
  /** Camera frame size, upright (before scaling to the analysis space). */
  cameraSize?: { width: number; height: number };
}

export function useVehicleFrameOutput(input: {
  detector: TfliteModel | null;
  colorModel: TfliteModel | null;
  /** Both null: no plates, and the camera stays at 640×480. */
  plateModel: TfliteModel | null;
  plateOcrModel: TfliteModel | null;
  plateOcr: PlateOcrConfig | null;
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
  setPlateGates: (gates: PlateGate[]) => void;
} {
  const lastFrameTimestamp = useSharedValue(0);
  // null: the central keeps no recortes (or none wanted yet), so none are made.
  const thumbnailGates = useSharedValue<ThumbnailGate[] | null>(null);
  // Empty until the engine confirms a vehicle: no colour work before that.
  const colorGates = useSharedValue<ColorGate[]>([]);
  const plateGates = useSharedValue<PlateGate[]>([]);
  const lastPlateAt = useSharedValue(0);
  // TfliteModel is a Nitro HybridObject (jsi::NativeState): captured as-is, the
  // worklet runtime sees an object without methods ("undefined is not a
  // function" on runSync). Boxing makes it a HostObject the worklet can unbox.
  const boxedDetector = useMemo(() => (input.detector ? NitroModules.box(input.detector) : null), [input.detector]);
  const boxedColorModel = useMemo(() => (input.colorModel ? NitroModules.box(input.colorModel) : null), [input.colorModel]);
  const boxedPlateModel = useMemo(() => (input.plateModel ? NitroModules.box(input.plateModel) : null), [input.plateModel]);
  const boxedOcrModel = useMemo(() => (input.plateOcrModel ? NitroModules.box(input.plateOcrModel) : null), [input.plateOcrModel]);
  const readsPlates = !!(input.plateModel && input.plateOcrModel && input.plateOcr);
  const output = useFrameOutput({
    targetResolution: readsPlates ? plateFrameResolution : frameResolution,
    pixelFormat: 'rgb',
    dropFramesWhileBusy: true,
    enablePreviewSizedOutputBuffers: !readsPlates,
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
        const cameraDetections = decodeYolo(
          new Float32Array(rawOutput),
          input.detectorShape,
          modelInput.letterbox,
          input.detectorLabels,
          0.1,
        );
        const cameraWidth = modelInput.letterbox.uprightWidth;
        const cameraHeight = modelInput.letterbox.uprightHeight;
        const analysisScale = Math.max(1, Math.max(cameraWidth, cameraHeight) / analysisLongSide);
        const detections = analysisScale === 1
          ? cameraDetections
          : cameraDetections.map((detection) => ({ ...detection, box: scaleBox(detection.box, 1 / analysisScale) }));
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
              const crop = prepareCrop(frameData, scaleBox(detection.box, analysisScale), 128, true);
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
        const thumbnail = gates ? pickThumbnail(frameData, detections, gates, analysisScale) : null;
        const tThumbnail = performance.now();
        let plate: FrameProcessingResult['plate'] = null;
        const plateOcr = input.plateOcr;
        if (boxedPlateModel && boxedOcrModel && plateOcr && startedAt - lastPlateAt.value >= plateIntervalMs) {
          const index = pickPlateDetection(detections, plateGates.value, analysisScale);
          const detection = detections[index];
          if (detection) {
            lastPlateAt.value = startedAt;
            const vehicle = scaleBox(detection.box, analysisScale);
            plate = {
              detectionIndex: index,
              areaPx: (detection.box.x2 - detection.box.x1) * (detection.box.y2 - detection.box.y1),
              attempt: readPlate(frameData, vehicle, cameraWidth, cameraHeight, boxedPlateModel.unbox(), boxedOcrModel.unbox(), plateOcr),
            };
          }
        }
        const tDone = performance.now();
        const elapsedMs = Date.now() - startedAt;
        const timings: StageTimings = {
          prepare: tPrepared - t0,
          detect: tDetected - tPrepared,
          decode: tDecoded - tDetected,
          color: tColored - tDecoded,
          colorCrops,
          thumbnail: tThumbnail - tColored,
          plate: tDone - tThumbnail,
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
            frameSize: { width: cameraWidth / analysisScale, height: cameraHeight / analysisScale },
            cameraSize: { width: cameraWidth, height: cameraHeight },
            thumbnail,
            plate,
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
  const setPlateGates = useCallback((gates: PlateGate[]) => {
    plateGates.set(gates);
  }, [plateGates]);
  return { output, setThumbnailGates, setColorGates, setPlateGates };
}

function scaleBox(box: Box, factor: number): Box {
  'worklet';
  return { x1: box.x1 * factor, y1: box.y1 * factor, x2: box.x2 * factor, y2: box.y2 * factor };
}

/**
 * The detection to search a plate in: the first gate (fewest reads first) that
 * matches a detection wide enough, in camera pixels, to hold a 45 px plate.
 */
export function pickPlateDetection(detections: Detection[], gates: PlateGate[], analysisScale: number): number {
  'worklet';
  for (const gate of gates) {
    let bestIndex = -1;
    let bestOverlap = gateMatchIou;
    for (let index = 0; index < detections.length; index++) {
      const detection = detections[index];
      if (!detection || (detection.box.x2 - detection.box.x1) * analysisScale < plateMinVehicleWidthPx) continue;
      const overlap = intersectionOverUnion(gate.box, detection.box);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) return bestIndex;
  }
  return -1;
}

/**
 * The PC node's cascade on one vehicle (apps/vision/vigia_vision/plates.py and
 * plate_ocr.py): the vehicle plus a 4 % margin into the plate detector, its best
 * plate back to camera pixels and, if at least 45 px wide, into the OCR.
 */
function readPlate(
  frame: FrameData,
  vehicle: Box,
  cameraWidth: number,
  cameraHeight: number,
  plateModel: TfliteModel,
  ocrModel: TfliteModel,
  ocr: PlateOcrConfig,
): PlateAttempt {
  'worklet';
  const marginX = (vehicle.x2 - vehicle.x1) * vehicleMargin;
  const marginY = (vehicle.y2 - vehicle.y1) * vehicleMargin;
  const left = Math.max(0, Math.round(vehicle.x1 - marginX));
  const top = Math.max(0, Math.round(vehicle.y1 - marginY));
  const right = Math.min(cameraWidth, Math.round(vehicle.x2 + marginX));
  const bottom = Math.min(cameraHeight, Math.round(vehicle.y2 + marginY));
  if (right - left < 40 || bottom - top < 25) return { status: 'none' };
  const input = prepareRegion(frame, { left, top, width: right - left, height: bottom - top }, 320, true);
  const raw = plateModel.runSync([input.pixels.buffer as ArrayBuffer])[0];
  if (!raw) return { status: 'none' };
  const found = decodeBestPlate(new Float32Array(raw), input.letterbox);
  if (!found) return { status: 'none' };
  const plateBox = { x1: left + found.x1, y1: top + found.y1, x2: left + found.x2, y2: top + found.y2 };
  const widthPx = Math.round(plateBox.x2 - plateBox.x1);
  if (widthPx < minPlateWidthPx) return { status: 'small', widthPx };
  const pixels = preparePlate(frame, plateBox, 128, 64);
  const out = ocrModel.runSync([pixels.buffer as ArrayBuffer])[0];
  if (!out) return { status: 'none' };
  const { text, confidence } = decodePlateText(new Float32Array(out), ocr.alphabet, ocr.slots, ocr.padChar);
  return { status: 'read', widthPx, text, confidence };
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
  analysisScale = 1,
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
  return { ...prepareThumbnail(frame, scaleBox(chosen.box, analysisScale)), detectionIndex: bestIndex };
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
