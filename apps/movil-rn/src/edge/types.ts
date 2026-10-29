export interface FramePlane {
  bytes: Uint8Array;
  bytesPerRow: number;
  bytesPerPixel?: number;
}

export interface FrameData {
  format: 'yuv420' | 'bgra8888' | 'rgba8888' | 'rgb888';
  width: number;
  height: number;
  planes: FramePlane[];
  rotationDegrees?: 0 | 90 | 180 | 270;
}

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Detection {
  box: Box;
  score: number;
  label: 'car' | 'motorcycle';
}

export interface Letterbox {
  size: number;
  scale: number;
  padX: number;
  padY: number;
  uprightWidth: number;
  uprightHeight: number;
}

export interface ModelInput {
  pixels: Float32Array;
  letterbox: Letterbox;
}
