export const ARCA_CONFIG_KEY = 'arca';

export const emptyArcaConfig = () => ({
  cuit: '',
  razon_social: '',
  nombre_comercial: '',
  direccion: '',
  punto_venta: '0001',
  ambiente: 'homologacion',
  cert: '',
  private_key: '',
  token: '',
});

const LEGACY_ARCA_KEYS = [
  'arca_cuit',
  'arca_razon_social',
  'arca_nombre_comercial',
  'arca_direccion',
  'arca_punto_venta',
  'arca_ambiente',
  'arca_cert',
  'arca_key',
  'arca_token',
];

export const isValidBusinessId = (businessId) => {
  if (!businessId) return false;
  const invalid = ['', 'null', 'undefined', '00000000-0000-0000-0000-000000000000'];
  return !invalid.includes(String(businessId));
};

const cacheStorageKey = (businessId) =>
  isValidBusinessId(businessId) ? `arca_config_${businessId}` : 'arca_config_demo';

export const normalizeArcaConfig = (raw = {}) => ({
  cuit: String(raw.cuit || '').replace(/[^0-9]/g, ''),
  razon_social: raw.razon_social || '',
  nombre_comercial: raw.nombre_comercial || '',
  direccion: raw.direccion || '',
  punto_venta: raw.punto_venta || '0001',
  ambiente: raw.ambiente || 'homologacion',
  cert: raw.cert || raw.certificate || '',
  private_key: raw.private_key || raw.key || '',
  token: raw.token || raw.accessToken || '',
});

export const readLegacyArcaFromLocalStorage = () =>
  normalizeArcaConfig({
    cuit: localStorage.getItem('arca_cuit'),
    razon_social: localStorage.getItem('arca_razon_social'),
    nombre_comercial: localStorage.getItem('arca_nombre_comercial'),
    direccion: localStorage.getItem('arca_direccion'),
    punto_venta: localStorage.getItem('arca_punto_venta'),
    ambiente: localStorage.getItem('arca_ambiente'),
    cert: localStorage.getItem('arca_cert'),
    private_key: localStorage.getItem('arca_key'),
    token: localStorage.getItem('arca_token'),
  });

export const applyArcaToCache = (businessId, config) => {
  const normalized = normalizeArcaConfig(config);
  localStorage.setItem(cacheStorageKey(businessId), JSON.stringify(normalized));

  // Compatibilidad con Clientes.jsx y facturación (lectura rápida)
  localStorage.setItem('arca_cuit', normalized.cuit);
  localStorage.setItem('arca_razon_social', normalized.razon_social);
  localStorage.setItem('arca_nombre_comercial', normalized.nombre_comercial);
  localStorage.setItem('arca_direccion', normalized.direccion);
  localStorage.setItem('arca_punto_venta', normalized.punto_venta);
  localStorage.setItem('arca_ambiente', normalized.ambiente);
  localStorage.setItem('arca_cert', normalized.cert);
  localStorage.setItem('arca_key', normalized.private_key);
  localStorage.setItem('arca_token', normalized.token);

  return normalized;
};

export const readArcaFromCache = (businessId) => {
  const stored = localStorage.getItem(cacheStorageKey(businessId));
  if (stored) {
    try {
      return normalizeArcaConfig(JSON.parse(stored));
    } catch {
      /* fall through */
    }
  }

  const legacy = readLegacyArcaFromLocalStorage();
  if (legacy.cuit || legacy.cert || legacy.private_key) {
    return legacy;
  }

  return emptyArcaConfig();
};

export const clearArcaLegacyCache = () => {
  LEGACY_ARCA_KEYS.forEach((key) => localStorage.removeItem(key));
};

export const clearArcaCacheForBusiness = (businessId) => {
  if (isValidBusinessId(businessId)) {
    localStorage.removeItem(cacheStorageKey(businessId));
  }
  clearArcaLegacyCache();
};

export const buildArcaConfigFromForm = ({
  cuit,
  razonSocial,
  nombreComercial,
  direccion,
  puntoVenta,
  ambiente,
  cert,
  privateKey,
  token,
}) =>
  normalizeArcaConfig({
    cuit,
    razon_social: razonSocial,
    nombre_comercial: nombreComercial,
    direccion,
    punto_venta: puntoVenta,
    ambiente,
    cert,
    private_key: privateKey,
    token,
  });
