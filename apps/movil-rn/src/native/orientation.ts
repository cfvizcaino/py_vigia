export type FrameOrientation = 'up' | 'right' | 'down' | 'left';

/**
 * Clockwise degrees that turn the frame's pixels upright (the meaning of
 * `rotationDegrees` in `FrameData`).
 *
 * VisionCamera 5 reports how the pixels are already turned: `'right'` means
 * the content is rotated 90° clockwise, so it is straightened by 270°
 * clockwise (90° counter-clockwise). Flutter's sensor orientation has the
 * opposite meaning; copying its 90 for `'right'` left every frame upside
 * down, with the boxes mirrored and far fewer vehicles detected.
 */
export function rotationForOrientation(orientation: FrameOrientation, extraRotation = 0): 0 | 90 | 180 | 270 {
  'worklet';
  const base = orientation === 'right' ? 270 : orientation === 'down' ? 180 : orientation === 'left' ? 90 : 0;
  return ((((base + extraRotation) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}
