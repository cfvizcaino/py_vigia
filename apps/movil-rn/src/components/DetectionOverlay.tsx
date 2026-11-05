import { StyleSheet, Text, View } from 'react-native';

import { colorNamesEs } from '../edge/colors';
import type { EdgeOverlay } from '../edge/engine';
import type { Box } from '../edge/types';

const boxColor = '#69D4A8';

/**
 * Boxes over the camera preview, as in the Flutter app: type, colour and
 * confidence of each vehicle seen in the latest frame. The boxes live in the
 * frame turned by the extra rotation; the preview is not, so they are turned
 * back. Positions are percentages of the preview, which has the frame's shape.
 */
export function DetectionOverlay({ overlay, extraRotation }: { overlay: EdgeOverlay | null; extraRotation: number }) {
  if (!overlay?.tracks.length) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {overlay.tracks.map((track) => {
        const box = toPreview(track.box, overlay.frameWidth, overlay.frameHeight, extraRotation);
        const color = track.color ? colorNamesEs[track.color] ?? track.color : null;
        return (
          <View
            key={track.id}
            style={[
              styles.box,
              { left: `${box.x1 * 100}%`, top: `${box.y1 * 100}%`, width: `${(box.x2 - box.x1) * 100}%`, height: `${(box.y2 - box.y1) * 100}%` },
            ]}
          >
            <Text style={styles.label} numberOfLines={1}>
              {track.label}{color ? ` ${color}` : ''} {Math.round(track.score * 100)}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Preview shape (width / height) for a frame turned by the extra rotation. */
export function previewAspectRatio(frameWidth: number, frameHeight: number, extraRotation: number): number {
  const turned = extraRotation === 90 || extraRotation === 270;
  return turned ? frameHeight / frameWidth : frameWidth / frameHeight;
}

/** Box in the turned frame → fractions (0–1) of the preview, undoing the extra rotation. */
export function toPreview(box: Box, width: number, height: number, extraRotation: number): Box {
  const corners = [
    unturn(box.x1, box.y1, width, height, extraRotation),
    unturn(box.x2, box.y2, width, height, extraRotation),
  ];
  const turned = extraRotation === 90 || extraRotation === 270;
  const previewWidth = turned ? height : width;
  const previewHeight = turned ? width : height;
  const xs = corners.map(([x]) => x / previewWidth);
  const ys = corners.map(([, y]) => y / previewHeight);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

function unturn(x: number, y: number, width: number, height: number, rotation: number): [number, number] {
  // (x, y) lives in a frame of width × height that is the preview turned clockwise by `rotation`.
  if (rotation === 90) return [y, width - x];
  if (rotation === 180) return [width - x, height - y];
  if (rotation === 270) return [height - y, x];
  return [x, y];
}

const styles = StyleSheet.create({
  box: { position: 'absolute', borderWidth: 2, borderColor: boxColor },
  label: {
    position: 'absolute',
    top: -16,
    left: -2,
    backgroundColor: boxColor,
    color: '#000',
    fontSize: 11,
    paddingHorizontal: 2,
  },
});
