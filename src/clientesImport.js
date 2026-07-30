const normalizeHeader = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

const COLUMN_ALIASES = {
  nombre: ['nombre', 'name', 'cliente', 'nombre_comercial', 'comercial'],
  razon_social: ['razon_social', 'razon', 'razonsocial'],
  cuit: ['cuit', 'documento', 'dni_cuit'],
  telefono: ['telefono', 'whatsapp', 'celular', 'phone', 'tel'],
  direccion: ['direccion', 'direccion_envio', 'address', 'domicilio', 'envio'],
  condicion_iva: [
    'condicion_iva',
    'cond_iva',
    'condicioniva',
    'condicion',
    'iva',
    'condicion_frente_al_iva',
    'frente_al_iva',
    'tipo_iva',
  ],
  saldo: ['saldo', 'deuda', 'cuenta_corriente', 'cc'],
};

export const IMPORT_FIELDS = [
  { key: 'nombre', label: 'Nombre' },
  { key: 'razon_social', label: 'Razón social' },
  { key: 'cuit', label: 'CUIT' },
  { key: 'telefono', label: 'Teléfono / WhatsApp' },
  { key: 'direccion', label: 'Dirección' },
  { key: 'condicion_iva', label: 'Cond. IVA' },
  { key: 'saldo', label: 'Saldo' },
];

const findColumnKey = (headers, field) => {
  const aliases = COLUMN_ALIASES[field] || [field];
  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    if (aliases.includes(header)) return i;
    if (field === 'condicion_iva' && header.includes('iva')) return i;
  }
  return -1;
};

const detectDelimiter = (text) => {
  const firstLine = (text.split(/\r?\n/).find((line) => line.trim()) || '');
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;

  for (let i = 0; i < firstLine.length; i += 1) {
    const char = firstLine[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes) {
      if (char === ',') commas += 1;
      if (char === ';') semicolons += 1;
    }
  }

  return semicolons > commas ? ';' : ',';
};

export const parseCsvText = (text, delimiter) => {
  const delim = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delim && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => String(value || '').trim() !== '')) {
        rows.push(row);
      }
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => String(value || '').trim() !== '')) {
      rows.push(row);
    }
  }

  return rows;
};

export const normalizeIva = (value) => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return 'Consumidor Final';
  if (raw === 'CF' || raw.includes('CONSUMIDOR')) return 'Consumidor Final';
  if (raw === 'RI' || raw.includes('INSCRIPT')) return 'Responsable Inscripto';
  if (raw === 'EX' || raw.includes('EXENT')) return 'Exento';
  if (raw.includes('MONOTRIB')) return 'Monotributista';
  return 'Consumidor Final';
};

const isIvaToken = (value) => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return false;
  return (
    raw === 'CF' ||
    raw === 'RI' ||
    raw === 'EX' ||
    raw.includes('CONSUMIDOR') ||
    raw.includes('INSCRIPT') ||
    raw.includes('EXENT') ||
    raw.includes('MONOTRIB')
  );
};

const normalizeCuit = (value) => {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits || 'N/A';
};

const normalizePhone = (value) => String(value || '').replace(/[^0-9]/g, '');

const buildRowGetter = (row, indexes) => (key) => {
  const idx = indexes[key];
  if (idx == null || idx < 0) return '';
  return String(row[idx] ?? '').trim();
};

const resolveIvaFromRow = (row, indexes, get) => {
  const fromColumn = get('condicion_iva');
  if (fromColumn) return normalizeIva(fromColumn);

  for (let i = 0; i < row.length; i += 1) {
    const cell = String(row[i] ?? '').trim();
    if (isIvaToken(cell)) {
      return normalizeIva(cell);
    }
  }

  return 'Consumidor Final';
};

const resolveNombre = (row, indexes) => {
  const get = buildRowGetter(row, indexes);
  const mappedNombre = indexes.nombre >= 0 ? get('nombre') : '';
  if (mappedNombre && !isIvaToken(mappedNombre)) {
    return { nombre: mappedNombre, inferred: false };
  }

  const razonSocial = get('razon_social');
  if (razonSocial && !isIvaToken(razonSocial)) return { nombre: razonSocial, inferred: true };

  const telefono = get('telefono');
  if (telefono) return { nombre: `Cliente ${telefono}`, inferred: true };

  const cuit = get('cuit');
  if (cuit) return { nombre: `Cliente CUIT ${cuit}`, inferred: true };

  const direccion = get('direccion');
  if (direccion) return { nombre: direccion.slice(0, 80), inferred: true };

  for (let i = 0; i < row.length; i += 1) {
    const value = String(row[i] ?? '').trim();
    if (value && !isIvaToken(value)) return { nombre: value.slice(0, 80), inferred: true };
  }

  return null;
};

export const buildSuggestedMapping = (normalizedHeaders, hasHeaderRow = true) => {
  if (!hasHeaderRow) {
    return {
      nombre: 0,
      razon_social: 1,
      cuit: 2,
      telefono: 3,
      direccion: 4,
      condicion_iva: 5,
      saldo: 6,
    };
  }

  const nombreIdx = findColumnKey(normalizedHeaders, 'nombre');
  return {
    nombre: nombreIdx >= 0 ? nombreIdx : 0,
    razon_social: findColumnKey(normalizedHeaders, 'razon_social'),
    cuit: findColumnKey(normalizedHeaders, 'cuit'),
    telefono: findColumnKey(normalizedHeaders, 'telefono'),
    direccion: findColumnKey(normalizedHeaders, 'direccion'),
    condicion_iva: findColumnKey(normalizedHeaders, 'condicion_iva'),
    saldo: findColumnKey(normalizedHeaders, 'saldo'),
  };
};

export const detectHeaderRow = (normalizedHeaders, rawHeaders) => {
  const hasKnownHeader = IMPORT_FIELDS.some(
    (field) => findColumnKey(normalizedHeaders, field.key) >= 0
  );
  if (hasKnownHeader) return true;

  return rawHeaders.some((header) =>
    /nombre|raz[oó]n|cuit|tel|dire|iva|saldo|whatsapp/i.test(String(header || ''))
  );
};

export const analyzeCsvImport = (csvText, options = {}) => {
  const rows = parseCsvText(csvText);
  if (!rows.length) {
    return { error: 'El archivo está vacío.' };
  }

  const autoHeaderRow = detectHeaderRow(
    rows[0].map(normalizeHeader),
    rows[0].map((cell) => String(cell ?? '').trim())
  );
  const hasHeaderRow = options.hasHeaderRow ?? autoHeaderRow;
  const rawHeaders = hasHeaderRow
    ? rows[0].map((cell) => String(cell ?? '').trim())
    : rows[0].map((_, index) => `Columna ${index + 1}`);
  const normalizedHeaders = hasHeaderRow ? rawHeaders.map(normalizeHeader) : [];
  const suggestedMapping = buildSuggestedMapping(normalizedHeaders, hasHeaderRow);
  const dataRows = hasHeaderRow ? rows.slice(1) : rows;

  return {
    rows,
    rawHeaders,
    normalizedHeaders,
    hasHeaderRow,
    suggestedMapping,
    previewRows: dataRows.slice(0, 3),
    rowCount: dataRows.length,
    delimiter: detectDelimiter(csvText),
  };
};

export const mapCsvRowsToClientes = (rows, options = {}) => {
  const hasHeaderRow = options.hasHeaderRow ?? true;
  const columnMapping = options.columnMapping || buildSuggestedMapping(
    (hasHeaderRow ? rows[0] : []).map(normalizeHeader),
    hasHeaderRow
  );

  if (!rows?.length) {
    return { clients: [], errors: ['El archivo está vacío.'], skippedEmpty: 0, inferredNames: 0 };
  }

  const dataRows = hasHeaderRow ? rows.slice(1) : rows;
  const indexes = { ...columnMapping };

  const clients = [];
  const errors = [];
  let skippedEmpty = 0;
  let inferredNames = 0;

  dataRows.forEach((row, rowIndex) => {
    const line = hasHeaderRow ? rowIndex + 2 : rowIndex + 1;
    const resolved = resolveNombre(row, indexes);

    if (!resolved) {
      skippedEmpty += 1;
      return;
    }

    const { nombre, inferred } = resolved;
    if (inferred) inferredNames += 1;

    const get = buildRowGetter(row, indexes);
    const direccion = get('direccion');
    if (!direccion) {
      errors.push(`Fila ${line} (${nombre}): sin dirección — se importará sin domicilio.`);
    }

    const saldoRaw = get('saldo').replace(/\./g, '').replace(',', '.');
    const saldo = saldoRaw ? parseFloat(saldoRaw) : 0;

    clients.push({
      nombre,
      razon_social: get('razon_social') || nombre,
      cuit: normalizeCuit(get('cuit')),
      telefono: normalizePhone(get('telefono')),
      condicion_iva: resolveIvaFromRow(row, indexes, get),
      direccion: direccion || null,
      saldo: Number.isFinite(saldo) ? saldo : 0,
      sourceLine: line,
    });
  });

  if (!clients.length) {
    errors.unshift('No hay filas con datos para importar.');
  }

  return { clients, errors, skippedEmpty, inferredNames };
};

export const getColumnLabel = (index, rawHeaders) => {
  if (index == null || index < 0) return '(No importar)';
  const letter = String.fromCharCode(65 + index);
  const header = rawHeaders?.[index];
  return header ? `${letter} — ${header}` : `${letter} — (columna ${index + 1})`;
};

export const CSV_IMPORT_HELP = [
  'En Google Sheets: Archivo → Descargar → CSV (.csv). Acepta separador , o ;',
  'Subí el archivo y revisá/corregí la asignación de columnas antes de importar.',
  'IVA: CF = Consumidor Final, RI = Responsable Inscripto, EX = Exento',
  'Podés borrar todos los clientes actuales antes de importar.',
];
