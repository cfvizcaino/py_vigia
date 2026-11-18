import {Composition} from 'remotion';
import {
  OPENING_DURATION_IN_FRAMES,
  OPENING_FPS,
  VigiaOpening,
} from './VigiaOpening';

export const RemotionRoot = () => (
  <Composition
    id="VigiaOpening"
    component={VigiaOpening}
    durationInFrames={OPENING_DURATION_IN_FRAMES}
    fps={OPENING_FPS}
    width={412}
    height={917}
  />
);
