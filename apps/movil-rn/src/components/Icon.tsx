import Svg, { Path } from 'react-native-svg';
import type { StyleProp, ViewStyle } from 'react-native';

import { ICONS } from '../theme/iconData';
import type { IconName } from '../theme/iconData';
import { colors } from '../theme/colors';

export type { IconName };

/** Iconos exportados del Figma (y Material Symbols para las vistas del plugin). */
export function Icon({ name, size = 24, width, height, color = colors.icon, style }: {
  name: IconName; size?: number; width?: number; height?: number; color?: string; style?: StyleProp<ViewStyle>;
}) {
  const icon = ICONS[name];
  // Los iconos del Figma no siempre son cuadrados (p. ej. 20 × 28): «size» es el lado mayor.
  const [, , vw = 1, vh = 1] = icon.viewBox.split(' ').map(Number);
  const scale = size / Math.max(vw, vh);
  return (
    <Svg width={width ?? vw * scale} height={height ?? vh * scale} viewBox={icon.viewBox} style={style}>
      {icon.paths.map((path, index) => (
        <Path key={index} d={path.d} fill={color} {...('fillRule' in path ? { fillRule: path.fillRule as 'evenodd' | 'nonzero' } : {})} />
      ))}
    </Svg>
  );
}
