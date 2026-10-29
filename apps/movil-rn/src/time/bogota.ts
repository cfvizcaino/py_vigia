export function parseApiDate(value: string): Date {
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const parsed = new Date(hasOffset ? value : `${value}Z`);
  if (!Number.isFinite(parsed.getTime())) throw new RangeError('Fecha API inválida.');
  return parsed;
}

export function bogotaDateTime(date: Date): string {
  const bogota = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  return `${bogota.getUTCFullYear()}-${pad(bogota.getUTCMonth() + 1)}-${pad(bogota.getUTCDate())} ${pad(bogota.getUTCHours())}:${pad(bogota.getUTCMinutes())}`;
}

export function bogotaToUtc(date: string, time: string): string {
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeParts = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateParts || !timeParts) throw new RangeError('Fecha u hora de Bogotá inválida.');
  const [, yearText, monthText, dayText] = dateParts;
  const [, hourText, minuteText] = timeParts;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new RangeError('Fecha u hora de Bogotá inválida.');
  }
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  calendarDate.setUTCHours(0, 0, 0, 0);
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    throw new RangeError('Fecha u hora de Bogotá inválida.');
  }
  return new Date(Date.UTC(year, month - 1, day, hour + 5, minute)).toISOString();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
