export const CIERRE_MEDIOS_SLOTS = 15;

export const MEDIO_EFECTIVO_ID = 'medio_01';

export const slotId = (slot) => `medio_${String(slot).padStart(2, '0')}`;

export const MEDIO_ICONS = {
  medio_01: 'bi-cash-coin',
  medio_02: 'bi-bank2',
  medio_03: 'bi-credit-card-2-front-fill',
  medio_04: 'bi-qr-code',
  medio_05: 'bi-link-45deg',
  medio_06: 'bi-journal-text',
};

export const getMedioIcon = (id) => MEDIO_ICONS[id] || 'bi-currency-dollar';

const DEFAULT_LABELS = [
  'Efectivo',
  'Transferencia Bancaria',
  'Tarjeta (Crédito/Débito)',
  'QR / Mercado Pago',
  'Link de Pago',
  'Cuenta Corriente (Deuda)',
];

const LEGACY_ID_TO_SLOT = {
  transferencia: 2,
  tarjeta: 3,
  qrPago: 4,
  linkPago: 5,
  ctaCte: 6,
};

export const createDefaultCierreMedios = () =>
  Array.from({ length: CIERRE_MEDIOS_SLOTS }, (_, index) => {
    const slot = index + 1;
    const label = DEFAULT_LABELS[index] || '';
    return {
      slot,
      id: slotId(slot),
      label,
      enabled: slot === 1 ? true : !!label,
      used: false,
      locked: slot === 1,
    };
  });

const isNewFormat = (stored) =>
  Array.isArray(stored) && stored.some((item) => String(item?.id || '').startsWith('medio_'));

const mergeStoredMedios = (base, stored) => {
  const byId = Object.fromEntries(stored.map((item) => [item.id, item]));
  return base.map((slot) => {
    const saved = byId[slot.id];
    if (!saved) return slot;
    return {
      ...slot,
      label: saved.label ?? slot.label,
      enabled: saved.enabled !== false,
      used: saved.used === true,
      locked: slot.slot === 1,
    };
  });
};

export const normalizeCierreMedios = (stored) => {
  const base = createDefaultCierreMedios();
  if (!stored || !Array.isArray(stored) || stored.length === 0) return base;

  if (isNewFormat(stored)) return mergeStoredMedios(base, stored);

  const migrated = base.map((slot) => ({ ...slot }));
  const customItems = [];

  stored.forEach((item) => {
    if (!item?.label) return;
    const legacySlot = LEGACY_ID_TO_SLOT[item.id];
    if (legacySlot) {
      const target = migrated[legacySlot - 1];
      target.label = item.label;
      target.enabled = item.enabled !== false;
      target.used = item.used === true;
      return;
    }
    if (String(item.id || '').startsWith('concept_')) {
      customItems.push(item);
    }
  });

  customItems.forEach((item) => {
    const empty = migrated.find((slot) => slot.slot > 1 && !slot.label?.trim());
    if (!empty) return;
    empty.label = item.label;
    empty.enabled = item.enabled !== false;
    empty.used = item.used === true;
  });

  return migrated;
};

export const getConfiguredMedios = (medios = []) =>
  medios.filter((medio) => medio.label?.trim());

export const getActiveMedios = (medios = []) =>
  medios.filter((medio) => medio.label?.trim() && medio.enabled !== false);

export const getNextEmptyMedioSlot = (medios = []) =>
  medios.find((medio) => medio.slot > 1 && !medio.label?.trim()) || null;

export const canDeleteMedio = (medio) =>
  medio?.slot > 1 && !!medio.label?.trim() && !medio.used;

export const canToggleMedio = (medio) => medio?.slot > 1 && !!medio.label?.trim();

export const applyUsedMedioFlags = (medios = [], medioValues = {}) =>
  medios.map((medio) => {
    const monto = parseFloat(medioValues[medio.id] || 0) || 0;
    if (monto <= 0) return medio;
    return { ...medio, used: true };
  });

export const buildCierreSlotRow = (medioValues = {}) => {
  const row = {};
  for (let slot = 1; slot <= CIERRE_MEDIOS_SLOTS; slot += 1) {
    const id = slotId(slot);
    row[id] = parseFloat(medioValues[id] || 0) || 0;
  }
  return row;
};

export const getEfectivoFromCierre = (record = {}) =>
  parseFloat(record.medio_01 ?? record.efectivo ?? 0) || 0;

export const buildMedioValuesFromCierre = (record = {}) => {
  const values = {};
  for (let slot = 1; slot <= CIERRE_MEDIOS_SLOTS; slot += 1) {
    const id = slotId(slot);
    if (record[id] != null) values[id] = parseFloat(record[id]) || 0;
  }
  if (values.medio_01 == null) {
    values.medio_01 = getEfectivoFromCierre(record);
  }
  return values;
};
