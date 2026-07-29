/** Taxonomía de gastos — irregular vs regular y dónde se registran. */

export const EXPENSE_IRREGULAR_TYPES = [
  {
    name: 'Mercadería',
    description: 'Gastos para producir o revender.',
    examples: 'Insumos, materia prima, bebidas, packaging.',
    viaCompras: true,
    viaPagos: false,
    viaCalendario: false,
    requiresProveedorFactura: true,
  },
  {
    name: 'Mantenimiento',
    description: 'Gasto para conservar o mejorar activos.',
    examples: 'Repuestos, reparaciones, service de equipos.',
    viaCompras: true,
    viaPagos: false,
    viaCalendario: false,
    requiresProveedorFactura: true,
  },
  {
    name: 'Inversión',
    description: 'Gasto para adquirir activos.',
    examples: 'Maquinaria, mobiliario, equipamiento nuevo.',
    viaCompras: true,
    viaPagos: false,
    viaCalendario: false,
    requiresProveedorFactura: true,
  },
];

/** Regulares con proveedor y factura — Compras y/o Calendario de Pagos */
export const EXPENSE_REGULAR_WITH_INVOICE = [
  {
    name: 'Estructura y Gestión',
    description: 'Gastos fijos de funcionamiento y administración del negocio.',
    examples: 'Alquiler, contador, software, publicidad, gestoría.',
    comprasWhen: 'Cuando recibís la factura del proveedor (alquiler mensual, honorarios, suscripciones).',
    calendarioWhen: 'Para programar vencimientos recurrentes del mismo concepto.',
    viaCompras: true,
    viaPagos: true,
    viaCalendario: true,
    requiresProveedorFactura: true,
  },
  {
    name: 'Servicios',
    description: 'Servicios operativos necesarios para abrir y funcionar.',
    examples: 'Electricidad, gas, internet, telefonía, limpieza, seguridad.',
    comprasWhen: 'Cuando llega la factura del servicio (EDESUR, Metrogas, ISP, etc.).',
    calendarioWhen: 'Para anticipar vencimientos mensuales de servicios.',
    viaCompras: true,
    viaPagos: true,
    viaCalendario: true,
    requiresProveedorFactura: true,
  },
  {
    name: 'Seguros',
    description: 'Primas y coberturas de prevención de riesgos.',
    examples: 'Seguro de local, vehículos, incendio, responsabilidad civil.',
    comprasWhen: 'Cuando recibís la póliza o factura de la aseguradora.',
    calendarioWhen: 'Para cuotas o renovaciones periódicas de pólizas.',
    viaCompras: true,
    viaPagos: true,
    viaCalendario: true,
    requiresProveedorFactura: true,
  },
];

/** Regulares sin factura de proveedor — solo Calendario de Pagos / Pagos */
export const EXPENSE_REGULAR_WITHOUT_INVOICE = [
  {
    name: 'Personal y Cargas',
    description: 'Gasto en personal y cargas sociales.',
    examples: 'Sueldos, aportes, sindicato, ART.',
    viaCompras: false,
    viaPagos: true,
    viaCalendario: true,
    requiresProveedorFactura: false,
  },
  {
    name: 'Impuestos y Tasas',
    description: 'Obligaciones gubernamentales y municipales.',
    examples: 'IVA, IIBB, ganancias, autónomos, patentes, tasas.',
    viaCompras: false,
    viaPagos: true,
    viaCalendario: true,
    requiresProveedorFactura: false,
  },
  {
    name: 'Gastos Bancarios',
    description: 'Comisiones y cargos de entidades financieras.',
    examples: 'Mantenimiento de cuenta, POS, Mercado Pago, transferencias.',
    viaCompras: false,
    viaPagos: true,
    viaCalendario: true,
    requiresProveedorFactura: false,
  },
  {
    name: 'Financiación',
    description: 'Costos de financiación y préstamos.',
    examples: 'Intereses, descuentos de cheques, líneas de crédito.',
    viaCompras: false,
    viaPagos: true,
    viaCalendario: true,
    requiresProveedorFactura: false,
  },
];

export const EXPENSE_REGULAR_TYPES = [
  ...EXPENSE_REGULAR_WITH_INVOICE,
  ...EXPENSE_REGULAR_WITHOUT_INVOICE,
];

export const ALL_EXPENSE_TYPES = [
  ...EXPENSE_IRREGULAR_TYPES,
  ...EXPENSE_REGULAR_TYPES,
];

export const REMOVED_PROVIDER_CATEGORIES = ['Gasto', 'Impuesto', 'Impuestos'];

const LEGACY_CATEGORY_ALIASES = {
  Servicio: 'Servicios',
  'Personal y Cargas Sociales': 'Personal y Cargas',
};

export const DEFAULT_COMPRAS_CATEGORIES = [
  {
    name: 'Mercadería',
    details: [
      { label: 'NO CONSIDERAR 21%', iva: 21 },
      { label: 'NO CONSIDERAR 10,5%', iva: 10.5 },
    ],
  },
  { name: 'Mantenimiento', details: [] },
  { name: 'Inversión', details: [] },
  { name: 'Servicios', details: [] },
  { name: 'Estructura y Gestión', details: [] },
  { name: 'Seguros', details: [] },
];

export const COMPRAS_PROVIDER_CATEGORY_NAMES = [
  ...EXPENSE_IRREGULAR_TYPES.map((item) => item.name),
  ...EXPENSE_REGULAR_WITH_INVOICE.map((item) => item.name),
];

export const normalizeCategoryName = (name) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return trimmed;
  if (LEGACY_CATEGORY_ALIASES[trimmed]) return LEGACY_CATEGORY_ALIASES[trimmed];
  if (REMOVED_PROVIDER_CATEGORIES.includes(trimmed)) return null;
  return trimmed;
};

export const normalizeComprasCategories = (categories = []) => {
  const source = categories.length > 0 ? categories : DEFAULT_COMPRAS_CATEGORIES;
  const mapped = source
    .map((cat) => {
      if (typeof cat === 'string') {
        const name = normalizeCategoryName(cat);
        return name ? { name, details: [] } : null;
      }
      const name = normalizeCategoryName(cat?.name);
      if (!name) return null;
      return { ...cat, name };
    })
    .filter(Boolean);

  const byName = new Map();
  mapped.forEach((cat) => {
    if (!byName.has(cat.name)) byName.set(cat.name, cat);
  });

  DEFAULT_COMPRAS_CATEGORIES.forEach((defaultCat) => {
    if (!byName.has(defaultCat.name)) {
      byName.set(defaultCat.name, defaultCat);
    }
  });

  return COMPRAS_PROVIDER_CATEGORY_NAMES.map((name) => byName.get(name)).filter(Boolean);
};

export const getProviderCategories = (categories = []) =>
  normalizeComprasCategories(categories).filter((cat) =>
    COMPRAS_PROVIDER_CATEGORY_NAMES.includes(cat.name)
  );

export const isProviderCategory = (name) =>
  COMPRAS_PROVIDER_CATEGORY_NAMES.includes(normalizeCategoryName(name));

export const COMPRAS_OCR_CATEGORY_OPTIONS = COMPRAS_PROVIDER_CATEGORY_NAMES;

export const EXPENSE_GUIDE_TREES = {
  naturaleza: {
    title: 'Por naturaleza del gasto',
    root: 'Gastos',
    branches: [
      {
        label: 'Irregulares',
        hint: 'Compras puntuales',
        children: EXPENSE_IRREGULAR_TYPES.map((t) => t.name),
      },
      {
        label: 'Regulares',
        hint: 'Funcionamiento recurrente',
        children: [
          {
            label: 'Con proveedor y factura',
            children: EXPENSE_REGULAR_WITH_INVOICE.map((t) => t.name),
          },
          {
            label: 'Sin factura de proveedor',
            children: EXPENSE_REGULAR_WITHOUT_INVOICE.map((t) => t.name),
          },
        ],
      },
    ],
  },
  factura: {
    title: 'Por factura',
    root: 'Gastos',
    branches: [
      {
        label: 'Con proveedor y factura',
        hint: 'Comprobante del proveedor',
        children: [
          ...EXPENSE_IRREGULAR_TYPES.map((t) => t.name),
          ...EXPENSE_REGULAR_WITH_INVOICE.map((t) => t.name),
        ],
      },
      {
        label: 'Sin factura de proveedor',
        hint: 'Pagos directos, impuestos, banco',
        children: EXPENSE_REGULAR_WITHOUT_INVOICE.map((t) => t.name),
      },
    ],
  },
  registro: {
    title: 'Por dónde se registra',
    root: 'Gastos',
    branches: [
      {
        label: 'Desde Compras',
        hint: 'Proveedor + factura obligatorios',
        children: [
          ...EXPENSE_IRREGULAR_TYPES.map((t) => t.name),
          ...EXPENSE_REGULAR_WITH_INVOICE.map((t) => t.name),
        ],
      },
      {
        label: 'Desde Pagos / Calendario',
        hint: 'Vencimientos y pagos sin factura',
        children: [
          {
            label: 'También pueden ir por Compras si hay factura',
            children: EXPENSE_REGULAR_WITH_INVOICE.map((t) => t.name),
          },
          {
            label: 'Solo Pagos / Calendario',
            children: EXPENSE_REGULAR_WITHOUT_INVOICE.map((t) => t.name),
          },
        ],
      },
    ],
  },
};
