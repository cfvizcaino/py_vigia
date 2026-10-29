import type { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../theme/colors';
import { bogotaDateTime } from '../time/bogota';

export function Screen({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) {
  const content = scroll ? (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, { flex: 1 }]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      {content}
      <SafetyBanner />
    </SafeAreaView>
  );
}

export function SafetyBanner() {
  return (
    <View accessibilityRole="text" style={styles.banner}>
      <Text style={styles.bannerText}>ⓘ  Trayectorias estimadas; no constituyen una identificación confirmada</Text>
    </View>
  );
}

export function DemoBadge() {
  return (
    <View accessibilityLabel="Modo demostración" style={styles.demoBadge}>
      <Text style={styles.demoText}>DEMOSTRACIÓN</Text>
    </View>
  );
}

export function Card({ children, title, action }: PropsWithChildren<{ title?: string; action?: ReactNode }>) {
  return (
    <View style={styles.card}>
      {(title || action) && (
        <View style={styles.cardHeader}>
          {title ? <Text style={styles.cardTitle}>{title}</Text> : <View />}
          {action}
        </View>
      )}
      {children}
    </View>
  );
}

export function PrimaryButton({ title, onPress, loading = false, disabled = false, accessibilityLabel }: {
  title: string; onPress: () => void; loading?: boolean; disabled?: boolean; accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, (pressed || disabled || loading) && styles.buttonMuted]}
    >
      {loading ? <ActivityIndicator color={colors.background} /> : <Text style={styles.primaryText}>{title}</Text>}
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress, accessibilityLabel, disabled = false }: {
  title: string; onPress: () => void; accessibilityLabel?: string; disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.secondaryButton, disabled && styles.buttonMuted]}>
      <Text style={styles.secondaryText}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, value, onChangeText, placeholder, keyboardType, secureTextEntry, multiline, autoCapitalize }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'url';
  secureTextEntry?: boolean;
  multiline?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize={autoCapitalize ?? (keyboardType === 'email-address' || keyboardType === 'url' ? 'none' : 'sentences')}
        autoCorrect={keyboardType !== 'url'}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.subtle}
        secureTextEntry={secureTextEntry}
        style={[styles.input, multiline && { minHeight: 100, textAlignVertical: 'top' }]}
        value={value}
      />
    </View>
  );
}

export function ChoiceRow({ label, choices, value, onChange }: {
  label: string;
  choices: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.choiceRow}>
        {choices.map((choice) => {
          const selected = choice.value === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={choice.value}
              onPress={() => onChange(choice.value)}
              style={[styles.choice, selected && styles.choiceSelected]}
            >
              <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{choice.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ErrorMessage({ children }: PropsWithChildren) {
  return <Text accessibilityRole="alert" style={styles.error}>{children}</Text>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.body}>{description}</Text>
    </View>
  );
}

export function formatDate(value: unknown): string {
  const date = typeof value === 'string' ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : bogotaDateTime(date);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 14, paddingBottom: 24 },
  banner: { backgroundColor: colors.warningBackground, paddingHorizontal: 16, paddingVertical: 12 },
  bannerText: { color: colors.warning, fontSize: 13, lineHeight: 18 },
  demoBadge: { alignSelf: 'flex-start', borderRadius: 4, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#4B3718' },
  demoText: { color: colors.warning, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  card: { backgroundColor: colors.surface, borderRadius: 8, padding: 14, gap: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  field: { gap: 6 },
  fieldLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, backgroundColor: colors.surfaceRaised, color: colors.text, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  primaryButton: { backgroundColor: colors.accent, minHeight: 50, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primaryText: { color: colors.background, fontSize: 15, fontWeight: '800' },
  buttonMuted: { opacity: 0.58 },
  secondaryButton: { minHeight: 48, borderRadius: 6, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  secondaryText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderColor: colors.border, borderWidth: 1, borderRadius: 20, minHeight: 38, justifyContent: 'center', paddingHorizontal: 14 },
  choiceSelected: { backgroundColor: '#294A40', borderColor: colors.accent },
  choiceText: { color: colors.muted, fontSize: 13 },
  choiceTextSelected: { color: colors.text, fontWeight: '700' },
  error: { color: '#FFB4AB', fontSize: 14, lineHeight: 20 },
  emptyState: { flex: 1, gap: 8, justifyContent: 'center', alignItems: 'center', padding: 24 },
});
