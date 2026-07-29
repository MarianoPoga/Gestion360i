export const ADELANTO_EFECTIVO = 'Adelanto Efectivo';
export const ADELANTO_MERCADERIA = 'Adelanto Mercaderia';
export const ADELANTO_RENDICION = 'Adelanto Rendición';

export const ADELANTO_CONCEPT_OPTIONS = [
  { value: ADELANTO_EFECTIVO, label: ADELANTO_EFECTIVO, configKey: 'allow_dinero' },
  { value: ADELANTO_MERCADERIA, label: ADELANTO_MERCADERIA, configKey: 'allow_mercaderia' },
];

export const getAdelantoConceptOptions = (config = {}) => {
  const enabled = ADELANTO_CONCEPT_OPTIONS.filter((option) => config[option.configKey] !== false);
  return enabled.length > 0 ? enabled : ADELANTO_CONCEPT_OPTIONS;
};

export const resolveAdelantoConceptSelection = (value, config = {}) => {
  const normalized = normalizeConceptoSelection(value);
  const options = getAdelantoConceptOptions(config);
  if (options.some((option) => option.value === normalized)) return normalized;
  return options[0]?.value || ADELANTO_EFECTIVO;
};

const EFECTIVO_PREFIXES = [ADELANTO_EFECTIVO, 'Adelanto Dinero', 'Adelanto $'];
const MERCADERIA_PREFIXES = [ADELANTO_MERCADERIA, 'Adelanto Merc'];

const extractDetail = (concepto, prefixes) => {
  const value = String(concepto || '');
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) {
      return value.slice(prefix.length).replace(/^ - /, '').trim();
    }
  }
  return '';
};

export const isAdelantoEfectivoConcept = (concepto) =>
  EFECTIVO_PREFIXES.some((prefix) => String(concepto || '').startsWith(prefix));

export const isAdelantoMercaderiaConcept = (concepto) =>
  MERCADERIA_PREFIXES.some((prefix) => String(concepto || '').startsWith(prefix));

export const extractAdelantoEfectivoDetail = (concepto) => extractDetail(concepto, EFECTIVO_PREFIXES);

export const extractAdelantoMercaderiaDetail = (concepto) => extractDetail(concepto, MERCADERIA_PREFIXES);

export const formatAdelantoConceptLabel = (concepto) => {
  if (isAdelantoEfectivoConcept(concepto)) return ADELANTO_EFECTIVO;
  if (isAdelantoMercaderiaConcept(concepto)) return ADELANTO_MERCADERIA;
  return String(concepto || '');
};

export const normalizeConceptoSelection = (value) => {
  if (isAdelantoEfectivoConcept(value)) return ADELANTO_EFECTIVO;
  if (isAdelantoMercaderiaConcept(value)) return ADELANTO_MERCADERIA;
  return ADELANTO_EFECTIVO;
};
