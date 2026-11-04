import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';

import { colors } from '../theme/colors';

type PickerMode = 'date' | 'time';

interface BogotaDateTimeFieldProps {
  label: string;
  date: string;
  time?: string;
  mode: PickerMode;
  onChange: (value: string) => void;
}

export function BogotaDateTimeField({ label, date, time, mode, onChange }: BogotaDateTimeFieldProps) {
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState(() => pickerValue(date, time));
  const value = mode === 'date' ? date : time ?? '';

  const commit = () => {
    const formatted = mode === 'date'
      ? `${selected.getFullYear()}-${pad(selected.getMonth() + 1)}-${pad(selected.getDate())}`
      : `${pad(selected.getHours())}:${pad(selected.getMinutes())}`;
    onChange(formatted);
    setVisible(false);
  };

  return (
    <>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '600' }}>{label}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value}`}
          onPress={() => {
            setSelected(pickerValue(date, time));
            setVisible(true);
          }}
          style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 6, backgroundColor: colors.surfaceRaised }}
        >
          <Text style={{ color: colors.text, fontSize: 16 }}>{value}</Text>
        </Pressable>
      </View>
      <Modal animationType="fade" onRequestClose={() => setVisible(false)} transparent visible={visible}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 22, backgroundColor: '#000B' }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 16, gap: 12 }}>
            <DateTimePicker
              display={Platform.OS === 'ios' ? 'spinner' : mode === 'date' ? 'calendar' : 'clock'}
              mode={mode}
              onChange={(_, nextDate) => {
                if (nextDate) setSelected(nextDate);
              }}
              value={selected}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18 }}>
              <Pressable accessibilityRole="button" onPress={() => setVisible(false)}>
                <Text style={{ color: colors.muted }}>Cancelar</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={commit}>
                <Text style={{ color: colors.accent, fontWeight: '700' }}>Aceptar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function pickerValue(date: string, time?: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour = 0, minute = 0] = (time ?? '00:00').split(':').map(Number);
  return new Date(year ?? 2020, (month ?? 1) - 1, day ?? 1, hour, minute);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
