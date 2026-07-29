/** Conceptos precargados del Calendario de Pagos por empresa. */

export const PERIODIC_SUBGROUPS = [
  { id: '2.1', name: 'Personal y Cargas Sociales' },
  { id: '2.2', name: 'Estructura y Gestión' },
  { id: '2.3', name: 'Servicios' },
  { id: '2.4', name: 'Impuestos y Tasas' },
  { id: '2.5', name: 'Seguros' },
  { id: '2.6', name: 'Gastos Bancarios' },
  { id: '2.7', name: 'Financiación' },
];

/**
 * @typedef {Object} PeriodicConceptDefault
 * @property {string} sg
 * @property {string} nombre
 * @property {'Sin factura'|'Factura'} tipo_factura - Factura = A o B según condición fiscal
 * @property {number} [dia_vencimiento]
 * @property {string} [periodicidad]
 * @property {string} [observaciones]
 * @property {number} [iva_alicuota]
 * @property {string} [medio_pago]
 */

/** @type {PeriodicConceptDefault[]} */
export const DEFAULT_PERIODIC_CONCEPTS = [
  // 2.1 — sin factura, día 10, mensual
  { sg: '2.1', nombre: 'Sueldos', tipo_factura: 'Sin factura', dia_vencimiento: 10, periodicidad: 'Mensual' },
  {
    sg: '2.1',
    nombre: 'Aguinaldos',
    tipo_factura: 'Sin factura',
    dia_vencimiento: 10,
    periodicidad: 'Semestral',
    observaciones: 'Junio y Diciembre',
  },
  { sg: '2.1', nombre: 'Aportes', tipo_factura: 'Sin factura', dia_vencimiento: 10, periodicidad: 'Mensual' },
  { sg: '2.1', nombre: 'Sindicato', tipo_factura: 'Sin factura', dia_vencimiento: 10, periodicidad: 'Mensual' },

  // 2.2 — factura, día 10, mensual
  { sg: '2.2', nombre: 'Alquiler', tipo_factura: 'Factura', dia_vencimiento: 10, periodicidad: 'Mensual' },
  { sg: '2.2', nombre: 'Contador', tipo_factura: 'Factura', dia_vencimiento: 10, periodicidad: 'Mensual' },
  { sg: '2.2', nombre: 'Desinfección', tipo_factura: 'Factura', dia_vencimiento: 10, periodicidad: 'Mensual' },

  // 2.3 — factura, día 10, mensual
  { sg: '2.3', nombre: 'Electricidad', tipo_factura: 'Factura', dia_vencimiento: 10, periodicidad: 'Mensual' },
  { sg: '2.3', nombre: 'Gas', tipo_factura: 'Factura', dia_vencimiento: 10, periodicidad: 'Mensual' },
  { sg: '2.3', nombre: 'Internet', tipo_factura: 'Factura', dia_vencimiento: 10, periodicidad: 'Mensual' },
  { sg: '2.3', nombre: 'Telefonía', tipo_factura: 'Factura', dia_vencimiento: 10, periodicidad: 'Mensual' },

  // 2.4 — sin factura, día 10, mensual
  { sg: '2.4', nombre: 'Autónomo', tipo_factura: 'Sin factura', dia_vencimiento: 10, periodicidad: 'Mensual' },
  { sg: '2.4', nombre: 'Monotributo', tipo_factura: 'Sin factura', dia_vencimiento: 10, periodicidad: 'Mensual' },
  { sg: '2.4', nombre: 'Ganancias', tipo_factura: 'Sin factura', dia_vencimiento: 10, periodicidad: 'Mensual' },
  { sg: '2.4', nombre: 'IIBB', tipo_factura: 'Sin factura', dia_vencimiento: 10, periodicidad: 'Mensual' },
  { sg: '2.4', nombre: 'IVA', tipo_factura: 'Sin factura', dia_vencimiento: 10, periodicidad: 'Mensual' },
  { sg: '2.4', nombre: 'Licencia municipal', tipo_factura: 'Sin factura', dia_vencimiento: 10, periodicidad: 'Mensual' },
  { sg: '2.4', nombre: 'Patente vehículo xxxx', tipo_factura: 'Sin factura', dia_vencimiento: 10, periodicidad: 'Mensual' },

  // 2.5 — factura, día 10, mensual
  { sg: '2.5', nombre: 'Seguro local', tipo_factura: 'Factura', dia_vencimiento: 10, periodicidad: 'Mensual' },
  { sg: '2.5', nombre: 'Seguro vehículo xxxx', tipo_factura: 'Factura', dia_vencimiento: 10, periodicidad: 'Mensual' },

  // 2.6 — sin factura (comisiones), día 10, mensual
  { sg: '2.6', nombre: 'Comisión Banco xxxx', tipo_factura: 'Sin factura', dia_vencimiento: 10, periodicidad: 'Mensual' },
  { sg: '2.6', nombre: 'Comisión Mercado Pago', tipo_factura: 'Sin factura', dia_vencimiento: 10, periodicidad: 'Mensual' },

  // 2.7 — vacío (sin conceptos precargados)
];

export const BUSINESS_FISCAL_CONFIG_KEY = 'business_fiscal';

export const buildFullSubgroup = (groupId) => {
  const group = PERIODIC_SUBGROUPS.find((item) => item.id === groupId);
  return group ? `${group.id}. ${group.name}` : groupId;
};

export const resolveDefaultInvoiceType = (concept, isMonotributo) => {
  if (concept.tipo_factura === 'Sin factura') return 'Sin factura';
  return isMonotributo ? 'Factura B' : 'Factura A';
};

export const buildPeriodicPaymentFromConcept = (concept, isMonotributo, orden = 0) => ({
  subgrupo: buildFullSubgroup(concept.sg),
  nombre: concept.nombre,
  monto_mensual: 0,
  dia_vencimiento: concept.dia_vencimiento ?? 10,
  tipo_factura: resolveDefaultInvoiceType(concept, isMonotributo),
  iva_alicuota: concept.iva_alicuota ?? 21,
  medio_pago: concept.medio_pago ?? 'Banco',
  observaciones: concept.observaciones ?? '',
  periodicidad: concept.periodicidad ?? 'Mensual',
  estado_valor: 'VALOR ESTIMADO',
  orden,
  activo: true,
});

export const PERIODIC_NAME_ALIASES = {
  'sueldos netos': '2.1',
  sueldos: '2.1',
  aguinaldos: '2.1',
  aportes: '2.1',
  'aportes y contribuciones': '2.1',
  sindicato: '2.1',
  art: '2.1',
};

DEFAULT_PERIODIC_CONCEPTS.forEach((concept) => {
  PERIODIC_NAME_ALIASES[concept.nombre.toLowerCase()] = concept.sg;
});

export const findExistingPeriodicItem = (existing, groupId, itemName) => {
  const target = String(itemName || '').trim().toLowerCase();
  return (existing || []).find((payment) => {
    const paymentGroupId = resolvePaymentSubgroupId(payment);
    const paymentName = String(payment?.nombre || '').trim().toLowerCase();
    if (paymentGroupId !== groupId) return false;
    if (paymentName === target) return true;
    if (target === 'sueldos' && paymentName.includes('sueldo')) return true;
    if (target === 'aportes' && paymentName.includes('aporte')) return true;
    if (target === 'sindicato' && paymentName.includes('sindicato')) return true;
    if (target === 'aguinaldos' && paymentName.includes('aguinaldo')) return true;
    return false;
  });
};

export const extractSubgroupPrefix = (text) => {
  if (!text) return '';
  const match = String(text).trim().match(/^(\d+\.\d+)/);
  return match ? match[1] : '';
};

export const inferSubgroupFromName = (nombre) => {
  const normalized = String(nombre || '').trim().toLowerCase();
  if (!normalized) return '';
  if (PERIODIC_NAME_ALIASES[normalized]) return PERIODIC_NAME_ALIASES[normalized];
  if (normalized.includes('sueldo')) return '2.1';
  if (normalized.includes('aguinaldo')) return '2.1';
  if (normalized.includes('aporte')) return '2.1';
  if (normalized.includes('sindicato')) return '2.1';
  return '';
};

export const inferSubgroupFromText = (text) => {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) return '';
  const fromPrefix = extractSubgroupPrefix(text);
  if (fromPrefix) return fromPrefix;
  const matchedGroup = PERIODIC_SUBGROUPS.find((group) => normalized.includes(group.name.toLowerCase()));
  return matchedGroup?.id || '';
};

export const resolvePaymentSubgroupId = (payment) => {
  const fromSubgrupo = inferSubgroupFromText(payment?.subgrupo);
  if (fromSubgrupo) return fromSubgrupo;
  return inferSubgroupFromName(payment?.nombre);
};

export const normalizePeriodicPayment = (payment) => {
  const subgroupId = resolvePaymentSubgroupId(payment);
  return {
    ...payment,
    nombre: String(payment?.nombre || '').trim(),
    subgrupo: subgroupId ? buildFullSubgroup(subgroupId) : String(payment?.subgrupo || '').trim(),
    orden: payment?.orden ?? 0,
  };
};

export const sortPeriodicPayments = (payments) =>
  [...payments].sort(
    (a, b) =>
      resolvePaymentSubgroupId(a).localeCompare(resolvePaymentSubgroupId(b)) ||
      (a.orden || 0) - (b.orden || 0) ||
      (a.nombre || '').localeCompare(b.nombre || '', 'es')
  );
