import { useFrameOutput } from 'react-native-vision-camera';
import type { CameraFrameOutput, Frame } from 'react-native-vision-camera';
import { scheduleOnRN } from 'react-native-worklets';
import type { TfliteModel } from 'react-native-fast-tflite';
import { useSharedValue } from 'react-native-reanimated';

import { decodeYolo } from '../edge/detections';
import { prepareCrop, prepareInput } from '../edge/preprocess';
import type { Detection, FrameData } from '../edge/types';

export interface FrameProcessingResult {
  detections: Detection[];
  colorVotes: (Record<string, number> | null)[];
  colorFailureCount: number;
  elapsedMs: number;
  frameNumber: number;
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
}): CameraFrameOutput {
  const lastFrameTimestamp = useSharedValue(0);
  return useFrameOutput({
    targetResolution: { width: 640, height: 480 },
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
