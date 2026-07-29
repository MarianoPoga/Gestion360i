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
  const raw = String(value || '').trim();
  if (!raw) return 'Consumidor Final';
  const lower = raw.toLowerCase();
  if (lower.includes('inscripto') || lower === 'ri') return 'Responsable Inscripto';
  if (lower.includes('monotrib')) return 'Monotributista';
  if (lower.includes('exento')) return 'Exento';
  return 'Consumidor Final';
};

const normalizeCuit = (value) => {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits || 'N/A';
};

const normalizePhone = (value) => String(value || '').replace(/[^0-9]/g, '');

export const mapCsvRowsToClientes = (rows) => {
  if (!rows?.length) return { clients: [], errors: ['El archivo está vacío.'] };

  const headers = rows[0].map(normalizeHeader);
  const indexes = {
    nombre: findColumnKey(headers, 'nombre'),
    razon_social: findColumnKey(headers, 'razon_social'),
    cuit: findColumnKey(headers, 'cuit'),
    telefono: findColumnKey(headers, 'telefono'),
    direccion: findColumnKey(headers, 'direccion'),
    condicion_iva: findColumnKey(headers, 'condicion_iva'),
    saldo: findColumnKey(headers, 'saldo'),
  };

  if (indexes.nombre < 0) {
    return {
      clients: [],
      errors: [
        'No se encontró columna "nombre". Usá encabezados como: nombre, razon_social, cuit, telefono, direccion',
      ],
    };
  }

  const clients = [];
  const errors = [];

  rows.slice(1).forEach((row, rowIndex) => {
    const line = rowIndex + 2;
    const get = (key) => {
      const idx = indexes[key];
      return idx >= 0 ? String(row[idx] ?? '').trim() : '';
    };

    const nombre = get('nombre');
    if (!nombre) return;

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
    errors.unshift('No hay filas con nombre para importar.');
  }

  return { clients, errors, headers };
};

export const CSV_IMPORT_HELP = [
  'En Google Sheets: Archivo → Descargar → Valores separados por comas (.csv)',
  'La primera fila debe ser encabezados.',
  'Columnas reconocidas: nombre, razon_social, cuit, telefono, direccion, condicion_iva, saldo',
  'Obligatorio: nombre. Recomendado: direccion (calle, número, ciudad).',
  'Clientes con el mismo nombre se omiten (no se duplican).',
];
