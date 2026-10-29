import { useCallback } from 'react';
import { useFrameOutput } from 'react-native-vision-camera';
import type { CameraFrameOutput, Frame } from 'react-native-vision-camera';
import { scheduleOnRN } from 'react-native-worklets';
import type { TfliteModel } from 'react-native-fast-tflite';
import { useSharedValue } from 'react-native-reanimated';

import { decodeYolo, intersectionOverUnion } from '../edge/detections';
import { prepareCrop, prepareInput, prepareThumbnail } from '../edge/preprocess';
import type { ThumbnailPixels } from '../edge/preprocess';
import type { Box, Detection, FrameData } from '../edge/types';

// Module constants: VisionCamera memoizes the output on these values, so an
// inline object would rebuild the camera session on every render.
const frameResolution = { width: 640, height: 480 };
const thumbnailMinSidePx = 32;

/** Where a recorte is still wanted: a track's box and the area it must reach. */
export interface ThumbnailGate {
  box: Box;
  minArea: number;
}

export interface FrameProcessingResult {
  detections: Detection[];
  colorVotes: (Record<string, number> | null)[];
  colorFailureCount: number;
  elapsedMs: number;
  frameNumber: number;
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
}): { output: CameraFrameOutput; setThumbnailGates: (gates: ThumbnailGate[] | null) => void } {
  const lastFrameTimestamp = useSharedValue(0);
  // null: the central keeps no recortes (or none wanted yet), so none are made.
  const thumbnailGates = useSharedValue<ThumbnailGate[] | null>(null);
  const output = useFrameOutput({
    targetResolution: frameResolution,
    pixelFormat: 'rgb',
    dropFramesWhileBusy: true,
    enablePreviewSizedOutputBuffers: true,
    onFrame(frame) {
      'worklet';
      const startedAt = Date.now();
      const minimumInterval = 1000 / input.fps;
      if (lastFrameTimestamp.value !== 0 && startedAt - lastFrameTimestamp.value < minimumInterval) {
        frame.dispose();
        return;
      }
      lastFrameTimestamp.value = startedAt;
      try {
        if (!input.detector) {
          return;
        }
        const frameData = readFrame(frame, input.extraRotation);
        const modelInput = prepareInput(frameData, input.inputSize, true);
        const rawOutput = input.detector.runSync([modelInput.pixels.buffer as ArrayBuffer])[0];
        if (!rawOutput) throw new Error('El detector no devolvió tensores de salida.');
        const detections = decodeYolo(
          new Float32Array(rawOutput),
          input.detectorShape,
          modelInput.letterbox,
          input.detectorLabels,
          0.1,
        );
        const colorVotes: (Record<string, number> | null)[] = detections.map(() => null);
        let colorFailureCount = 0;
        if (input.colorModel) {
          let selected = 0;
          for (let index = 0; index < detections.length && selected < 3; index++) {
            const detection = detections[index];
            if (!detection || detection.box.x2 - detection.box.x1 < 24 || detection.box.y2 - detection.box.y1 < 24) continue;
            try {
              const crop = prepareCrop(frameData, detection.box, 128, true);
              const output = input.colorModel.runSync([crop.buffer as ArrayBuffer])[0];
              if (!output) continue;
              const probabilities = new Float32Array(output);
              const votes: Record<string, number> = {};
              for (let classId = 0; classId < probabilities.length; classId++) {
                const label = input.colorLabels[classId];
                const probability = probabilities[classId];
                if (label && probability !== undefined) votes[label] = probability;
              }
              colorVotes[index] = votes;
              selected++;
            } catch {
              colorVotes[index] = null;
              colorFailureCount++;
            }
          }
        }
        const gates = thumbnailGates.value;
        const thumbnail = gates ? pickThumbnail(frameData, detections, gates) : null;
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs > 10_000) {
          scheduleOnRN(input.onFrameError, 'La inferencia tardó más de 10 segundos; se descartó este frame.');
        } else {
          scheduleOnRN(input.onFrameResult, {
            detections,
            colorVotes,
            colorFailureCount,
            elapsedMs,
            frameNumber: startedAt,
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
  return { output, setThumbnailGates };
}

/**
 * One recorte per frame at most, as in Flutter: the biggest detection whose
 * track still wants a better view (a new vehicle, or one whose box grew).
 */
function pickThumbnail(
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
    let minArea = 0;
    for (const gate of gates) {
      if (intersectionOverUnion(gate.box, detection.box) > 0.3) minArea = Math.max(minArea, gate.minArea);
    }
    if (area >= minArea && area > bestArea) {
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
  const orientationRotation = frame.orientation === 'right'
    ? 90
    : frame.orientation === 'down'
      ? 180
      : frame.orientation === 'left'
        ? 270
        : 0;
  const rotation = (((orientationRotation + extraRotation) % 360 + 360) % 360) as 0 | 90 | 180 | 270;
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
