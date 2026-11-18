import { NavigationContext } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useContext, useState } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { StyleProp, TextInputProps, TextStyle, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, Ellipse, LinearGradient as SvgLinearGradient, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';

import { colors, gradients } from '../theme/colors';
import { fonts, type } from '../theme/fonts';
import { bogotaDateTime } from '../time/bogota';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { AnimatedPressable, PulseDot, Reveal, tapFeedback, useFocusEntrance, usePressScale } from './motion';

// ------------------------------------------------------------------ fondo

/** Fondo de todas las pantallas: degradado #090119 → #57038f y el resplandor «Ellipse 14». */
export function Backdrop({ glow = true }: { glow?: boolean }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={gradients.screen} style={StyleSheet.absoluteFill} />
      {glow ? (
        <Svg style={{ position: 'absolute', left: 0, right: 0, top: '39%', height: 520 }} width="100%" height={520}>
          <Defs>
            <RadialGradient id="vigia-glow" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor="#ffffff" stopOpacity={0.2} />
              <Stop offset="0.55" stopColor="#9d76f8" stopOpacity={0.14} />
              <Stop offset="1" stopColor="#9d76f8" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx="50%" cy="50%" rx="50%" ry="50%" fill="url(#vigia-glow)" />
        </Svg>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ texto con degradado

/** Títulos Poppins con el degradado blanco → #9d76f8 (80 %) del Figma. */
export function GradientText({ text, size = 30, family = fonts.poppins, align = 'center', lineHeight }: {
  text: string; size?: number | undefined; family?: string | undefined; align?: 'center' | 'left'; lineHeight?: number | undefined;
}) {
  const [width, setWidth] = useState(0);
  const lines = text.split('\n');
  const lh = lineHeight ?? size * 1.2;
  const height = Math.ceil(lh * lines.length + size * 0.1);
  const id = `g-${text.length}-${size}`;
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={text.replace(/\n/g, ' ')} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ height, alignSelf: 'stretch' }}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <SvgLinearGradient id={id} x1="0" y1="0" x2="0" y2={height} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#ffffff" />
              <Stop offset="1" stopColor="#9d76f8" stopOpacity={0.8} />
            </SvgLinearGradient>
          </Defs>
          {lines.map((line, index) => (
            <SvgText
              key={index}
              x={align === 'center' ? width / 2 : 0}
              y={lh * index + lh * 0.5 + size * 0.36}
              fill={`url(#${id})`}
              fontFamily={family}
              fontSize={size}
              letterSpacing={-size * 0.02}
              textAnchor={align === 'center' ? 'middle' : 'start'}
            >
              {line}
            </SvgText>
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ pantalla

interface ScreenProps {
  /** Título grande (Poppins 30, dos líneas con \n). */
  title?: string | undefined;
  /** Título pequeño de encabezado (Poppins 16) junto a la flecha. */
  header?: string | undefined;
  back?: boolean | (() => void);
  right?: ReactNode | undefined;
  scroll?: boolean | undefined;
  glow?: boolean | undefined;
  /** Pantalla dentro de las pestañas: la barra inferior ocupa el borde de abajo. */
  tabs?: boolean | undefined;
  topInset?: boolean | undefined;
  contentStyle?: StyleProp<ViewStyle> | undefined;
  overlay?: ReactNode | undefined;
}

export function Screen({ children, title, header, back, right, scroll = true, glow = true, tabs = false, contentStyle, overlay }: PropsWithChildren<ScreenProps>) {
  // Contexto opcional: la pantalla también se monta sola en pruebas, fuera del navegador.
  const navigation = useContext(NavigationContext);
  const onBack = typeof back === 'function' ? back : back && navigation ? () => navigation.goBack() : null;
  const hasBar = Boolean(onBack || header || right);
  const subscribe = useCallback(
    (listener: () => void) => navigation?.addListener('focus', listener) ?? (() => undefined),
    [navigation],
  );
  const entrance = useFocusEntrance(navigation ? subscribe : null);
  const body = (
    <>
      {title ? <View style={styles.titleBox}><GradientText text={title} /></View> : null}
      {children}
    </>
  );
  return (
    <View style={styles.root}>
      <Backdrop glow={glow} />
      <SafeAreaView style={{ flex: 1 }} edges={tabs ? ['top', 'left', 'right'] : ['top', 'left', 'right', 'bottom']}>
        {hasBar ? (
          <View style={styles.bar}>
            <View style={styles.barSide}>
              {onBack ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Volver" hitSlop={12} onPress={onBack}>
                  <Icon name="arrowBack" size={20} color="#ffffff" />
                </Pressable>
              ) : null}
            </View>
            <View style={{ flex: 1 }}>{header ? <GradientText text={header} size={16} /> : null}</View>
            <View style={[styles.barSide, { alignItems: 'flex-end' }]}>{right}</View>
          </View>
        ) : null}
        <Animated.View style={[{ flex: 1 }, entrance]}>
          {scroll ? (
            <ScrollView contentContainerStyle={[styles.content, !hasBar && { paddingTop: 52 }, contentStyle]} keyboardShouldPersistTaps="handled">
              {body}
            </ScrollView>
          ) : (
            <View style={[styles.content, { flex: 1 }, !hasBar && { paddingTop: 52 }, contentStyle]}>{body}</View>
          )}
        </Animated.View>
      </SafeAreaView>
      {overlay}
    </View>
  );
}

// ------------------------------------------------------------------ vidrio y tarjetas

type GlassVariant = 'panel' | 'tile' | 'field' | 'strong';
const glassFill: Record<GlassVariant, string> = {
  panel: 'rgba(255,255,255,0.10)',
  tile: 'rgba(217,217,217,0.10)',
  field: 'rgba(217,217,217,0.10)',
  strong: 'rgba(217,217,217,0.20)',
};

/** Rectángulos con efecto GLASS del Figma: relleno translúcido y un filo claro. */
export function Glass({ children, style, radius = 19, variant = 'panel' }: PropsWithChildren<{ style?: StyleProp<ViewStyle> | undefined; radius?: number | undefined; variant?: GlassVariant }>) {
  return (
    <View style={[{ backgroundColor: glassFill[variant], borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' }, style]}>
      {children}
    </View>
  );
}

export function Card({ children, title, icon, action, style }: PropsWithChildren<{ title?: string | undefined; icon?: IconName | undefined; action?: ReactNode | undefined; style?: StyleProp<ViewStyle> }>) {
  return (
    <Glass style={[styles.card, style]}>
      {title || action ? (
        <View style={styles.cardHeader}>
          {icon ? <Icon name={icon} size={20} /> : null}
          {title ? <Text style={[styles.cardTitle, { flex: 1 }]}>{title}</Text> : <View style={{ flex: 1 }} />}
          {action}
        </View>
      ) : null}
      {children}
    </Glass>
  );
}

/** Tarjeta con degradado (casilla seleccionada, tarjeta de ruta, panel de fuente de video). */
export function GradientCard({ children, colors: stops, locations, style, radius = 24, horizontal = false, diagonal = false }: PropsWithChildren<{
  colors: readonly [string, string, ...string[]]; locations?: readonly [number, number, ...number[]] | undefined; style?: StyleProp<ViewStyle> | undefined;
  radius?: number | undefined; horizontal?: boolean | undefined; diagonal?: boolean | undefined;
}>) {
  return (
    <LinearGradient
      colors={stops}
      locations={locations ?? null}
      start={diagonal ? { x: 1, y: 0 } : horizontal ? { x: 0, y: 0.5 } : { x: 0.5, y: 0 }}
      end={diagonal ? { x: 0, y: 1 } : horizontal ? { x: 1, y: 0.5 } : { x: 0.5, y: 1 }}
      style={[{ borderRadius: radius, overflow: 'hidden' }, style]}
    >
      {children}
    </LinearGradient>
  );
}

// ------------------------------------------------------------------ botones

export function PrimaryButton({ title, onPress, loading = false, disabled = false, accessibilityLabel, icon, style }: {
  title: string; onPress: () => void; loading?: boolean | undefined; disabled?: boolean | undefined; accessibilityLabel?: string | undefined; icon?: IconName | undefined; style?: StyleProp<ViewStyle> | undefined;
}) {
  const press = usePressScale();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      hitSlop={8}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={[styles.primaryButton, (press.pressed || disabled || loading) && styles.buttonMuted, style, press.animatedStyle]}
    >
      {loading ? <ActivityIndicator color={colors.ink} size="small" /> : (
        <>
          {icon ? <Icon name={icon} size={18} color={colors.ink} /> : null}
          <Text style={styles.primaryText}>{title}</Text>
        </>
      )}
    </AnimatedPressable>
  );
}

export function SecondaryButton({ title, onPress, accessibilityLabel, disabled = false, icon, tone = 'light', loading = false, style }: {
  title: string; onPress: () => void; accessibilityLabel?: string | undefined; disabled?: boolean | undefined; icon?: IconName | undefined; tone?: 'light' | 'danger'; loading?: boolean | undefined; style?: StyleProp<ViewStyle> | undefined;
}) {
  const color = tone === 'danger' ? colors.danger : colors.text;
  const press = usePressScale();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      hitSlop={8}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={onPress}
      style={[styles.secondaryButton, { borderColor: tone === 'danger' ? colors.danger : 'rgba(255,255,255,0.8)' }, (press.pressed || disabled) && styles.buttonMuted, style, press.animatedStyle]}
    >
      {loading ? <ActivityIndicator color={color} size="small" /> : (
        <>
          {icon ? <Icon name={icon} size={18} color={color} /> : null}
          <Text style={[styles.secondaryText, { color }]}>{title}</Text>
        </>
      )}
    </AnimatedPressable>
  );
}

/** Botones grandes de bienvenida y diálogos (Poppins, radio 34). */
export function PillButton({ title, onPress, variant = 'light', loading = false, disabled = false, accessibilityLabel, height = 45, fontSize = 18, style }: {
  title: string; onPress: () => void; variant?: 'light' | 'outline' | 'accent' | 'gradient' | 'white'; loading?: boolean | undefined; disabled?: boolean | undefined;
  accessibilityLabel?: string | undefined; height?: number | undefined; fontSize?: number | undefined; style?: StyleProp<ViewStyle> | undefined;
}) {
  const dark = variant === 'light' || variant === 'white';
  const label: TextStyle = {
    ...type(variant === 'outline' ? fonts.poppins : fonts.poppinsMedium, fontSize),
    color: dark ? colors.ink : colors.text,
  };
  const content = loading ? <ActivityIndicator color={dark ? colors.ink : colors.text} /> : <Text style={label}>{title}</Text>;
  const base: ViewStyle = { height, borderRadius: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 };
  const press = usePressScale(0.97);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={[(press.pressed || disabled) && styles.buttonMuted, style, press.animatedStyle]}
    >
      {variant === 'gradient' ? (
        <LinearGradient colors={gradients.loginButton} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={base}>{content}</LinearGradient>
      ) : (
        <View style={[base, variant === 'light' && { backgroundColor: colors.pill }, variant === 'white' && { backgroundColor: 'rgba(255,255,255,0.8)' },
          variant === 'accent' && { backgroundColor: 'rgba(157,118,248,0.8)' }, variant === 'outline' && { borderWidth: 2, borderColor: '#ffffff' }]}
        >
          {content}
        </View>
      )}
    </AnimatedPressable>
  );
}

export function TextLink({ title, onPress, icon, color = colors.text, style }: { title: string; onPress: () => void; icon?: IconName | undefined; color?: string | undefined; style?: StyleProp<TextStyle> }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={title} hitSlop={10} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {icon ? <Icon name={icon} size={20} color={color} /> : null}
      <Text style={[type(fonts.light, 12), { color, textDecorationLine: 'underline' }, style]}>{title}</Text>
    </Pressable>
  );
}

// ------------------------------------------------------------------ campos

export function Field({ label, value, onChangeText, placeholder, keyboardType, secureTextEntry, multiline, autoCapitalize, icon, trailing, error, suffix, editable = true }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string | undefined;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'url';
  secureTextEntry?: boolean | undefined;
  multiline?: boolean | undefined;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  icon?: IconName | undefined;
  trailing?: ReactNode | undefined;
  error?: boolean | undefined;
  suffix?: string | undefined;
  editable?: boolean | undefined;
}) {
  const [focused, setFocused] = useState(false);
  const compact = focused || value.length > 0;
  return (
    <View style={[styles.field, multiline && { minHeight: 96, alignItems: 'flex-start', paddingTop: 10 }, focused && { borderColor: 'rgba(255,255,255,0.55)' }, error && { borderColor: colors.danger, borderWidth: 1.5 }]}>
      {icon ? <Icon name={icon} size={18} color={colors.icon} /> : null}
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {compact ? <Text style={[styles.fieldLabel, error && { color: colors.danger, opacity: 1 }]}>{label}</Text> : null}
        <TextInput
          accessibilityLabel={label}
          autoCapitalize={autoCapitalize ?? (keyboardType === 'email-address' || keyboardType === 'url' ? 'none' : 'sentences')}
          autoCorrect={keyboardType !== 'url'}
          editable={editable}
          keyboardType={keyboardType}
          multiline={multiline}
          onBlur={() => setFocused(false)}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          placeholder={compact ? placeholder : label}
          placeholderTextColor="rgba(255,255,255,0.65)"
          secureTextEntry={secureTextEntry}
          style={[compact ? styles.input : styles.inputEmpty, multiline && { textAlignVertical: 'top' }]}
          value={value}
        />
      </View>
      {suffix ? <Text style={[type(fonts.light, 12), { opacity: 0.6 }]}>{suffix}</Text> : null}
      {trailing}
    </View>
  );
}

/** Campo de solo lectura que abre un selector (cámara, fecha, hora, fuente…). */
export function SelectField({ label, value, onPress, icon, trailing = 'ms_keyboard_arrow_down', error, accessibilityLabel }: {
  label: string; value: string; onPress: () => void; icon?: IconName | undefined; trailing?: IconName | null | undefined; error?: boolean | undefined; accessibilityLabel?: string | undefined;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`} onPress={onPress} style={[styles.field, error && { borderColor: colors.danger, borderWidth: 1.5 }]}>
      {icon ? <Icon name={icon} size={18} color={colors.icon} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.fieldLabel, error && { color: colors.danger, opacity: 1 }]}>{label}</Text>
        <Text numberOfLines={1} style={styles.input}>{value}</Text>
      </View>
      {trailing ? <Icon name={trailing} size={20} color={colors.icon} /> : null}
    </Pressable>
  );
}

export function SearchPill({ value, onChangeText, placeholder }: { value: string; onChangeText: (value: string) => void; placeholder: string }) {
  return (
    <Glass radius={34} style={styles.search}>
      <Icon name="search" size={21} />
      <TextInput
        accessibilityLabel={placeholder}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.5)"
        style={[type(fonts.light, 11, 14.3, 0), { flex: 1, padding: 0 }]}
        value={value}
      />
    </Glass>
  );
}

export function ChoiceRow({ label, choices, value, onChange, grow = false }: {
  label: string;
  choices: { label: string; value: string; icon?: IconName | undefined; dot?: string }[];
  value: string;
  onChange: (value: string) => void;
  grow?: boolean | undefined;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.smallLabel}>{label}</Text>
      <View style={styles.choiceRow}>
        {choices.map((choice) => (
          <Chip key={choice.value} label={choice.label} selected={choice.value === value} icon={choice.icon} dot={choice.dot} grow={grow} onPress={() => onChange(choice.value)} />
        ))}
      </View>
    </View>
  );
}

export function Chip({ label, selected, onPress, icon, dot, grow }: { label: string; selected: boolean; onPress: () => void; icon?: IconName | undefined; dot?: string | undefined; grow?: boolean }) {
  const inner = (
    <>
      {icon ? <Icon name={icon} size={18} color="#ffffff" /> : null}
      {dot ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: dot, borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' }} /> : null}
      <Text style={type(selected ? fonts.medium : fonts.regular, 12.5)}>{label}</Text>
    </>
  );
  const press = usePressScale(0.94);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => {
        if (!selected) tapFeedback('selection');
        onPress();
      }}
      style={[grow ? { flexGrow: 1 } : null, press.animatedStyle]}
    >
      {selected ? (
        <LinearGradient colors={gradients.tileOn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.chip, grow && { justifyContent: 'center' }]}>{inner}</LinearGradient>
      ) : (
        <View style={[styles.chip, styles.chipOff, grow && { justifyContent: 'center' }]}>{inner}</View>
      )}
    </AnimatedPressable>
  );
}

// ------------------------------------------------------------------ mensajes

export function ErrorMessage({ children }: PropsWithChildren) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
      <Icon name="ms_error" size={16} color={colors.danger} style={{ marginTop: 1 }} />
      <Text accessibilityRole="alert" style={[type(fonts.regular, 12.5, 17, 0), { color: colors.danger, flex: 1 }]}>{children}</Text>
    </View>
  );
}

export function Notice({ children, icon = 'ms_info', tone = 'plain' }: PropsWithChildren<{ icon?: IconName | undefined; tone?: 'plain' | 'accent' | 'ok' | 'warn' | 'danger' }>) {
  const color = tone === 'ok' ? colors.success : tone === 'warn' ? colors.warning : tone === 'danger' ? colors.danger : colors.text;
  const box: ViewStyle = tone === 'accent'
    ? { backgroundColor: 'rgba(157,118,248,0.18)', borderColor: 'rgba(157,118,248,0.7)' }
    : tone === 'warn' ? { backgroundColor: 'rgba(255,212,121,0.12)', borderColor: 'rgba(255,212,121,0.7)' }
      : tone === 'danger' ? { backgroundColor: 'rgba(255,138,154,0.14)', borderColor: 'rgba(255,138,154,0.8)' }
        : { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.15)' };
  return (
    <View style={[styles.notice, box]}>
      <Icon name={icon} size={18} color={color} />
      <Text style={[type(fonts.regular, 11.5, 16, 0), { color, flex: 1, opacity: tone === 'plain' ? 0.85 : 1 }]}>{children}</Text>
    </View>
  );
}

/** Aviso legal de las consultas (antes era una franja fija abajo). */
export function SafetyBanner() {
  return <Notice>Trayectorias estimadas; no constituyen una identificación confirmada.</Notice>;
}

export function StatusPill({ text, tone = 'ok' }: { text: string; tone?: 'ok' | 'warn' }) {
  const color = tone === 'ok' ? colors.success : colors.warning;
  return (
    <View style={[styles.pill, { borderColor: color, backgroundColor: tone === 'ok' ? 'rgba(126,226,184,0.16)' : 'rgba(255,212,121,0.16)' }]}>
      <PulseDot color={color} live={tone === 'ok'} />
      <Text style={type(fonts.medium, 11.5, 14, 0)}>{text}</Text>
    </View>
  );
}

export function DemoBadge() {
  return (
    <View accessibilityLabel="Modo demostración" style={styles.demoBadge}>
      <Icon name="ms_science" size={14} color="#ffffff" />
      <Text style={[type(fonts.medium, 10, 12, 0.6)]}>DEMOSTRACIÓN</Text>
    </View>
  );
}

export function EmptyState({ title, description, icon }: { title: string; description: string; icon?: IconName }) {
  return (
    <View style={styles.emptyState}>
      {icon ? <Icon name={icon} size={50} /> : null}
      <Text style={[type(fonts.regular, 16), { textAlign: 'center' }]}>{title}</Text>
      <Text style={[type(fonts.light, 12), { textAlign: 'center' }]}>{description}</Text>
    </View>
  );
}

export function Body({ children, center = false, style }: PropsWithChildren<{ center?: boolean | undefined; style?: StyleProp<TextStyle> }>) {
  return <Text style={[type(fonts.light, 14, 18), center && { textAlign: 'center' }, { opacity: 0.85 }, style]}>{children}</Text>;
}

export function Code({ children }: PropsWithChildren) {
  return (
    <View style={styles.code}>
      <Text selectable style={[type(fonts.mono, 11, 16, 0), { color: '#d9ccff' }]}>{children}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ diálogo

/** Diálogos del Figma («Revocar credencial», «Nueva versión disponible»): panel degradado de radio 34. */
export function Dialog({ visible, title, body, icon, onRequestClose, children }: PropsWithChildren<{
  visible: boolean; title: string; body?: string | undefined; icon?: IconName | undefined; onRequestClose: () => void;
}>) {
  return (
    <Modal animationType="fade" onRequestClose={onRequestClose} transparent visible={visible} statusBarTranslucent>
      <View style={styles.dim}>
        <Reveal style={{ alignSelf: 'stretch', alignItems: 'center' }}>
          <GradientCard colors={gradients.dialog} radius={34} style={styles.dialog}>
            {icon ? <Icon name={icon} size={38} style={{ alignSelf: 'center' }} /> : null}
            <Text style={[type(fonts.poppinsMedium, 24), { textAlign: 'center' }]}>{title}</Text>
            {body ? <Text style={[type(fonts.poppinsLight, 14), { textAlign: 'center' }]}>{body}</Text> : null}
            {children}
          </GradientCard>
        </Reveal>
      </View>
    </Modal>
  );
}

export interface Option {
  value: string;
  label: string;
  detail?: string | undefined;
  icon?: IconName | undefined;
}

/** Lista desplegable (C04 · elegir cámara, vigencia y fuente del edge): vidrio sobre un velo oscuro. */
export function OptionSheet({ visible, title, options, value, onSelect, onClose }: {
  visible: boolean; title: string; options: Option[]; value: string; onSelect: (value: string) => void; onClose: () => void;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible} statusBarTranslucent>
      <Pressable accessibilityLabel="Cerrar lista" onPress={onClose} style={[styles.dim, { backgroundColor: 'rgba(9,1,25,0.62)' }]}>
        <Pressable onPress={() => undefined} style={styles.sheetPanel}>
          <Text style={[styles.smallLabel, { marginLeft: 4, marginBottom: 2 }]}>{title}</Text>
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 6 }}>
            {options.map((option, index) => {
              const selected = option.value === value;
              const inner = (
                <>
                  {option.icon ? <Icon name={option.icon} size={20} color="#ffffff" /> : null}
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={type(fonts.regular, 13.5, 17)}>{option.label}</Text>
                    {option.detail ? <Text style={[type(fonts.light, 10, 12, 0), { opacity: 0.7 }]}>{option.detail}</Text> : null}
                  </View>
                  {selected ? <Icon name="ms_check" size={18} color="#ffffff" /> : null}
                </>
              );
              return (
                <Reveal key={option.value} index={index}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={option.label}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      tapFeedback('selection');
                      onSelect(option.value);
                      onClose();
                    }}
                  >
                    {selected ? (
                      <LinearGradient colors={gradients.tileOn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.option}>{inner}</LinearGradient>
                    ) : (
                      <View style={[styles.option, { backgroundColor: 'rgba(255,255,255,0.10)' }]}>{inner}</View>
                    )}
                  </Pressable>
                </Reveal>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ------------------------------------------------------------------ utilidades

export function formatDate(value: unknown): string {
  const date = typeof value === 'string' ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : bogotaDateTime(date);
}

export function vehicleTypeName(value: string): string {
  const names: Record<string, string> = {
    car: 'Automóvil',
    motorcycle: 'Motocicleta',
    bus: 'Autobús',
    truck: 'Camión',
  };
  return names[value] ?? value;
}

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  bar: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  barSide: { width: 124, justifyContent: 'center' },
  titleBox: { marginTop: 4, marginBottom: 10, alignItems: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 28, gap: 16 },
  card: { padding: 18, gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { ...type(fonts.regular, 15) },
  smallLabel: { ...type(fonts.light, 11, 14, 0), opacity: 0.7 },
  field: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, borderRadius: 19, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', backgroundColor: 'rgba(217,217,217,0.10)' },
  fieldLabel: { ...type(fonts.light, 10, 12, 0), opacity: 0.6 },
  input: { ...type(fonts.regular, 14, 18), padding: 0 },
  inputEmpty: { ...type(fonts.light, 16, 19.2), padding: 0 },
  primaryButton: { minHeight: 32, borderRadius: 24, backgroundColor: colors.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18, elevation: 4, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 4 } },
  primaryText: { ...type(fonts.medium, 14), color: colors.ink },
  buttonMuted: { opacity: 0.58 },
  secondaryButton: { minHeight: 32, borderRadius: 24, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  secondaryText: { ...type(fonts.regular, 14) },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 34, paddingHorizontal: 14, borderRadius: 18 },
  chipOff: { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingVertical: 6, paddingLeft: 10, paddingRight: 12, borderRadius: 14, borderWidth: 1 },
  demoBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', paddingVertical: 5, paddingLeft: 10, paddingRight: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(157,118,248,0.9)', backgroundColor: 'rgba(157,118,248,0.18)' },
  emptyState: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 32, paddingHorizontal: 24 },
  search: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 59, paddingRight: 16 },
  code: { padding: 12, borderRadius: 10, backgroundColor: 'rgba(9,1,25,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  dim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheetPanel: { width: '100%', maxWidth: 360, padding: 10, gap: 6, borderRadius: 19, backgroundColor: 'rgba(43,10,82,0.96)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
  option: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 19 },
  dialog: { width: 308, maxWidth: '100%', minHeight: 300, paddingHorizontal: 32, paddingVertical: 40, gap: 18, justifyContent: 'center' },
});
