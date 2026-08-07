import { getTodayLocalDateString } from '../dateUtils';
import { PERIOD_PRESETS } from './resultadosTypes';

const pad = (n) => String(n).padStart(2, '0');

export const toDateString = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const parseDateString = (str) => {
  const [y, m, d] = String(str || '').split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
};

export const startOfDayIso = (dateStr) => {
  const d = parseDateString(dateStr);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

export const endOfDayIso = (dateStr) => {
  const d = parseDateString(dateStr);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
};

export const resolvePeriodRange = (preset, customDesde, customHasta) => {
  const today = new Date();
  const todayStr = getTodayLocalDateString();

  if (preset === PERIOD_PRESETS.TODAY) {
    return { desde: todayStr, hasta: todayStr };
  }

  if (preset === PERIOD_PRESETS.WEEK) {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { desde: toDateString(start), hasta: todayStr };
  }

  if (preset === PERIOD_PRESETS.PREV_MONTH) {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { desde: toDateString(start), hasta: toDateString(end) };
  }

  if (preset === PERIOD_PRESETS.CUSTOM && customDesde && customHasta) {
    return {
      desde: customDesde > customHasta ? customHasta : customDesde,
      hasta: customDesde > customHasta ? customDesde : customHasta,
    };
  }

  // Default: mes en curso
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return { desde: toDateString(start), hasta: todayStr };
};

export const resolvePreviousPeriodRange = ({ desde, hasta }) => {
  const start = parseDateString(desde);
  const end = parseDateString(hasta);
  const days = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  return { desde: toDateString(prevStart), hasta: toDateString(prevEnd) };
};

export const isDateInRange = (isoDate, desde, hasta) => {
  if (!isoDate) return false;
  const day = toDateString(isoDate);
  return day >= desde && day <= hasta;
};

export const formatPeriodLabel = (desde, hasta) => {
  if (desde === hasta) return desde.split('-').reverse().join('/');
  return `${desde.split('-').reverse().join('/')} – ${hasta.split('-').reverse().join('/')}`;
};
