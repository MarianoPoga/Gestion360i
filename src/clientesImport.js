const normalizeHeader = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');

const COLUMN_ALIASES = {
  nombre: ['nombre', 'name', 'cliente', 'nombre_comercial', 'comercial'],
  razon_social: ['razon_social', 'razon', 'razonsocial'],
  cuit: ['cuit', 'documento', 'dni_cuit'],
  telefono: ['telefono', 'whatsapp', 'celular', 'phone', 'tel'],
  direccion: ['direccion', 'direccion_envio', 'address', 'domicilio', 'envio'],
  condicion_iva: ['condicion_iva', 'condicioniva', 'iva', 'condicion_frente_al_iva'],
  saldo: ['saldo', 'deuda', 'cuenta_corriente', 'cc'],
};

const findColumnKey = (headers, field) => {
  const aliases = COLUMN_ALIASES[field] || [field];
  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    if (aliases.includes(header)) return i;
  }
  return -1;
};

export const parseCsvText = (text) => {
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

    if (char === ',' && !inQuotes) {
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

const normalizeIva = (value) => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return 'Consumidor Final';
  if (raw === 'CF' || raw.includes('CONSUMIDOR')) return 'Consumidor Final';
  if (raw === 'RI' || raw.includes('INSCRIPT')) return 'Responsable Inscripto';
  if (raw === 'EX' || raw.includes('EXENT')) return 'Exento';
  if (raw.includes('MONOTRIB')) return 'Monotributista';
  return 'Consumidor Final';
};

const normalizeCuit = (value) => {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits || 'N/A';
};

const normalizePhone = (value) => String(value || '').replace(/[^0-9]/g, '');

const buildRowGetter = (row, indexes) => (key) => {
  const idx = indexes[key];
  if (idx < 0) return '';
  return String(row[idx] ?? '').trim();
};

const resolveNombre = (row, indexes, line) => {
  const get = buildRowGetter(row, indexes);
  const nombreColA = String(row[0] ?? '').trim();
  if (nombreColA) return { nombre: nombreColA, inferred: false };

  const razonSocial = get('razon_social');
  if (razonSocial) return { nombre: razonSocial, inferred: true };

  const telefono = get('telefono');
  if (telefono) return { nombre: `Cliente ${telefono}`, inferred: true };

  const cuit = get('cuit');
  if (cuit) return { nombre: `Cliente CUIT ${cuit}`, inferred: true };

  const direccion = get('direccion');
  if (direccion) return { nombre: direccion.slice(0, 80), inferred: true };

  for (let i = 0; i < row.length; i += 1) {
    const value = String(row[i] ?? '').trim();
    if (value) return { nombre: value.slice(0, 80), inferred: true };
  }

  return null;
};

export const mapCsvRowsToClientes = (rows) => {
  if (!rows?.length) return { clients: [], errors: ['El archivo está vacío.'], skippedEmpty: 0, inferredNames: 0 };

  const headers = rows[0].map(normalizeHeader);
  const hasHeaderRow =
    headers[0] === 'nombre' ||
    findColumnKey(headers, 'nombre') >= 0;
  const dataRows = hasHeaderRow ? rows.slice(1) : rows;

  const indexes = hasHeaderRow
    ? {
        nombre: 0,
        razon_social: findColumnKey(headers, 'razon_social'),
        cuit: findColumnKey(headers, 'cuit'),
        telefono: findColumnKey(headers, 'telefono'),
        direccion: findColumnKey(headers, 'direccion'),
        condicion_iva: findColumnKey(headers, 'condicion_iva'),
        saldo: findColumnKey(headers, 'saldo'),
      }
    : {
        nombre: 0,
        razon_social: 1,
        cuit: 2,
        telefono: 3,
        direccion: 4,
        condicion_iva: 5,
        saldo: 6,
      };

  const clients = [];
  const errors = [];
  let skippedEmpty = 0;
  let inferredNames = 0;

  dataRows.forEach((row, rowIndex) => {
    const line = hasHeaderRow ? rowIndex + 2 : rowIndex + 1;
    const resolved = resolveNombre(row, indexes, line);

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
      condicion_iva: normalizeIva(get('condicion_iva')),
      direccion: direccion || null,
      saldo: Number.isFinite(saldo) ? saldo : 0,
      sourceLine: line,
    });
  });

  if (!clients.length) {
    errors.unshift('No hay filas con datos para importar.');
  }

  return { clients, errors, headers, skippedEmpty, inferredNames };
};

export const CSV_IMPORT_HELP = [
  'En Google Sheets: Archivo → Descargar → Valores separados por comas (.csv)',
  'La primera fila debe ser encabezados. Columna A = nombre (si está vacía, usa razón social u otros datos).',
  'Columnas: nombre, razon_social, cuit, telefono, direccion, condicion_iva, saldo',
  'IVA: CF = Consumidor Final, RI = Responsable Inscripto, EX = Exento',
  'Podés borrar todos los clientes antes de importar.',
];
