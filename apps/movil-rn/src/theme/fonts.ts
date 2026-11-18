import type { TextStyle } from 'react-native';

/** Familias embebidas con expo-font (app.json); el nombre es el del archivo .ttf. */
export const fonts = {
  poppinsLight: 'Poppins_300Light',
  poppins: 'Poppins_400Regular',
  poppinsMedium: 'Poppins_500Medium',
  light: 'DMSans_300Light',
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  semibold: 'DMSans_600SemiBold',
  mono: 'DMMono_400Regular',
} as const;

/** Tamaño, interlineado y espaciado tal como en Figma (ls = -2 % del tamaño). */
export function type(family: string, size: number, lineHeight = size * 1.2, letterSpacing = -size * 0.02): TextStyle {
  return { fontFamily: family, fontSize: size, lineHeight, letterSpacing, color: '#ffffff' };
}
