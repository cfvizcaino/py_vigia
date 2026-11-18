import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';

import { colors } from '../theme/colors';
import { SelectField } from './ui';

type PickerMode = 'date' | 'time';

interface BogotaDateTimeFieldProps {
  label: string;
  error?: boolean | undefined;
  date: string;
  time?: string;
  mode: PickerMode;
  onChange: (value: string) => void;
}

export function BogotaDateTimeField({ label, date, time, mode, onChange, error }: BogotaDateTimeFieldProps) {
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState(() => pickerValue(date, time));
  const value = mode === 'date' ? date : time ?? '';

  const commit = () => {
    onChange(formatPickerValue(selected, mode));
    setVisible(false);
  };

  return (
    <>
      <View style={{ flex: 1 }}>
        <SelectField
          label={label}
          value={value}
          icon={mode === 'date' ? 'ms_calendar_month' : 'ms_schedule'}
          trailing={null}
          error={error}
          onPress={() => {
            setSelected(pickerValue(date, time));
            setVisible(true);
          }}
        />
      </View>
      {Platform.OS === 'android' ? (
        visible ? (
          <DateTimePicker
            display="default"
            mode={mode}
            onChange={(event, nextDate) => {
              setVisible(false);
              if (event.type === 'set' && nextDate) onChange(formatPickerValue(nextDate, mode));
            }}
            value={selected}
          />
        ) : null
      ) : (
      <Modal animationType="fade" onRequestClose={() => setVisible(false)} transparent visible={visible}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 22, backgroundColor: '#000B' }}>
          <View style={{ backgroundColor: '#2b0a52', borderRadius: 28, padding: 16, gap: 12 }}>
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
      )}
    </>
  );
}

function formatPickerValue(selected: Date, mode: PickerMode): string {
  return mode === 'date'
    ? `${selected.getFullYear()}-${pad(selected.getMonth() + 1)}-${pad(selected.getDate())}`
    : `${pad(selected.getHours())}:${pad(selected.getMinutes())}`;
}

function pickerValue(date: string, time?: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour = 0, minute = 0] = (time ?? '00:00').split(':').map(Number);
  return new Date(year ?? 2020, (month ?? 1) - 1, day ?? 1, hour, minute);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
