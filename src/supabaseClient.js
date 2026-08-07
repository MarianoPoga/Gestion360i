import { createClient } from '@supabase/supabase-js'
import {
  ARCA_CONFIG_KEY,
  applyArcaToCache,
  clearArcaLegacyCache,
  emptyArcaConfig,
  isValidBusinessId,
  normalizeArcaConfig,
  readArcaFromCache,
  readLegacyArcaFromLocalStorage,
} from './arcaConfig'
import {
  normalizeCierreMedios,
  createDefaultCierreMedios,
  buildCierreSlotRow,
  applyUsedMedioFlags,
} from './cierreMedios'
import { normalizeRoleKey } from './rolePermissions'
import {
  DEFAULT_COMPRAS_CATEGORIES,
  createDefaultComprasConceptos,
  flattenComprasConceptosFromCategories,
  normalizeComprasCategories,
} from './expenseTypes'
import {
  DEFAULT_PRICE_LIST_NAMES,
  LEGACY_PRICE_LIST_NAMES,
  buildPriceListItemKey,
} from './priceLists'
import {
  DEFAULT_CIERRE_TURNOS,
  normalizeCierreTurnos,
  getCierreTurnoNames,
  getTurnoName,
  buildCajaCierreLabel,
  aggregatePedidosMediosForCierre,
  isFinalizedPedidoEstado,
  orderMatchesCajaTurno,
  getUnclosedTurnosForDate,
} from './cierreTurnos'
import {
  normalizePedidosCajasConfig,
} from './pedidosCajas'
import {
  NOTIFICATION_EVENTS,
  normalizeNotificationsConfig,
  buildCierreCajaNotification,
  buildCierreMedioLines,
} from './notificationConfig'
import {
  buildOrderCCFlags,
  computeClientSaldoFromMovements,
  dedupePedidoChargeMovements,
  extractMedioFromPaymentConcept,
  findOrderPaymentMovement,
  getOrderMovementRef,
  getOrderRelatedMovements,
  isCCCashInflowConcept,
  isCobroPedidoConcept,
  isCreditoPedidoConcept,
  isInvalidCtaCteCobroConcept,
  isCobroSaldoFavorImputation,
  isRefundConcept,
  isUnlinkedClientPaymentConcept,
  movementConcept,
  planSaldoFavorCobros,
  roundCcMoney,
  syncOrderPaymentOnTotalChange,
} from './ccMovements'

const resolveLegacyShippingEstadoUpdate = (order, updates) => {
  if (updates.estado !== undefined || updates.medio_pago === undefined) return updates;
  const est = (order.estado || '').toLowerCase();
  if (est !== 'pagado') return updates;
  const shippingEstado = !order.con_envio
    ? 'Pendiente'
    : (order.repartidor ? 'Entregado' : 'Pendiente');
  return { ...updates, estado: shippingEstado };
};
import { mapCsvRowsToClientes, parseCsvText, analyzeCsvImport } from './clientesImport'
import {
  buildNewBusinessDefaults,
  DEFAULT_COMPRAS_FORMAS_PAGO,
} from './businessDefaults'
import {
  BUSINESS_FISCAL_CONFIG_KEY,
  DEFAULT_PERIODIC_CONCEPTS,
  buildPeriodicPaymentFromConcept,
  findExistingPeriodicItem,
  normalizePeriodicPayment,
} from './periodicPaymentsDefaults'

// Credentials: localStorage first, then Vite env vars (for local dev)
export const getSupabaseCredentials = () => {
  const url = localStorage.getItem('supabase_url') || import.meta.env.VITE_SUPABASE_URL || '';
  const key = localStorage.getItem('supabase_anon_key') || import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  return { url, key };
};

const getCredentials = getSupabaseCredentials;

const { url, key } = getCredentials();

export const isSupabaseConfigured = () => {
  const { url, key } = getCredentials();
  return !!(url && key && key !== 'tu_anon_key_aqui');
};

export const hasEnvSupabaseCredentials = () =>
  !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

export const testSupabaseConnection = async (url, key) => {
  if (!url?.trim() || !key?.trim()) {
    return { success: false, error: 'Faltan la URL o la Anon Key.' };
  }

  try {
    const client = createClient(url.trim(), key.trim());
    const { error } = await client.from('gst_businesses').select('id').limit(1);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || 'No se pudo conectar a Supabase.' };
  }
};

const hasPaymentMedio = (medio) => !!medio && String(medio).trim() !== '';

const isMedioCtaCte = (medio) => {
  const normalized = String(medio || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized === 'cta cte'
    || normalized === 'cuenta corriente (deuda)'
    || normalized === 'cuenta corriente';
};

const isMedioPagadoEnCaja = (medio) => {
  const normalized = String(medio || '').trim().toLowerCase();
  return normalized === 'pagado en caja' || normalized === 'cobro en caja';
};

const isPaidMedioForOrder = (medio) =>
  hasPaymentMedio(medio) && !isMedioCtaCte(medio);

const isFinalizadoEstadoValue = (estado) => {
  const est = (estado || '').toLowerCase();
  return est === 'finalizado' || est === 'cobrado';
};

const isCancelledEstadoValue = (estado) => {
  const est = (estado || '').toLowerCase();
  return est === 'cancelado' || est === 'cancelada' || est === 'cancelled';
};

/** Cambios de envío (estado, repartidor, con_envio) no deben tocar cuenta corriente. */
const isShippingOnlyStatusUpdate = (updates) => {
  if (updates.medio_pago !== undefined || updates.turno_caja !== undefined) return false;
  if (updates.estado !== undefined && isCancelledEstadoValue(updates.estado)) return false;
  return (
    updates.estado !== undefined
    || updates.repartidor !== undefined
    || updates.con_envio !== undefined
  );
};

const isFinalizedOrderCCComplete = (order, relatedMovements) => {
  const medio = order.medio_pago || '';
  const ccFlags = buildOrderCCFlags(relatedMovements, getOrderMovementRef(order.id));

  if (!ccFlags.hasPedido) return false;
  if (isMedioCtaCte(medio)) {
    const pending = getOrderPendingCCAmount(relatedMovements, order.total);
    if (pending <= 0.005) return true;
    const hasSaldoFavorCobro = (relatedMovements || []).some(
      (m) => isCobroSaldoFavorImputation(m.concepto)
    );
    return hasSaldoFavorCobro;
  }
  if (!isPaidMedioForOrder(medio) || isMedioPagadoEnCaja(medio)) return true;
  return ccFlags.hasCobro;
};

const buildMissingFinalizeMovements = (order, relatedMovements) => {
  const orderRef = getOrderMovementRef(order.id);
  const total = parseFloat(order.total || 0);
  const medio = order.medio_pago || '';
  const fecha = order.fecha || order.created_at || new Date().toISOString();
  const ccFlags = buildOrderCCFlags(relatedMovements, orderRef);

  const inserts = [];

  if (!ccFlags.hasPedido) {
    inserts.push({ concepto: movementConcept.pedido(orderRef), debe: total, haber: 0, fecha });
  }
  if (
    !ccFlags.hasCredit
    && !ccFlags.hasCobro
    && isPaidMedioForOrder(medio)
    && !isMedioCtaCte(medio)
    && !isMedioPagadoEnCaja(medio)
  ) {
    inserts.push({ concepto: movementConcept.cobro(orderRef, medio), debe: 0, haber: total, fecha });
  }

  return inserts;
};

const computeFavorBeforeOrderCompra = (clientMovements, orderRef) => {
  const excluding = (clientMovements || []).filter(
    (m) => !String(m.concepto || '').includes(`#${orderRef}`)
  );
  return roundCcMoney(Math.max(0, -computeClientSaldoFromMovements(excluding)));
};

const buildSaldoFavorCobroInserts = (order, relatedMovements, clientMovements = []) => {
  const orderRef = getOrderMovementRef(order.id);
  const total = parseFloat(order.total || 0);
  const medio = order.medio_pago || '';
  const fecha = order.fecha || order.created_at || new Date().toISOString();

  if (!isMedioCtaCte(medio)) return [];

  const hasSaldoFavorCobro = (relatedMovements || []).some(
    (m) => isCobroSaldoFavorImputation(m.concepto)
  );
  const hasRealCobro = (relatedMovements || []).some(
    (m) =>
      isCobroPedidoConcept(m.concepto, orderRef)
      && !isInvalidCtaCteCobroConcept(m.concepto)
      && !isCobroSaldoFavorImputation(m.concepto)
  );
  const hasCredit = (relatedMovements || []).some(
    (m) => isCreditoPedidoConcept(m.concepto, orderRef)
  );
  if (hasSaldoFavorCobro || hasRealCobro || hasCredit) return [];

  const favorAvailable = computeFavorBeforeOrderCompra(clientMovements, orderRef);
  const alreadyCobrado = (relatedMovements || [])
    .filter(
      (m) =>
        isCobroPedidoConcept(m.concepto, orderRef)
        && !isInvalidCtaCteCobroConcept(m.concepto)
    )
    .reduce((sum, m) => sum + roundCcMoney(m.haber), 0);

  return planSaldoFavorCobros({
    orderRef,
    orderTotal: total,
    favorAvailable,
    alreadyCobrado,
    isCtaCte: true,
  }).map((item) => ({ ...item, fecha }));
};

const findUnwantedCobrosOnCtaCteOrder = (order, relatedMovements) => {
  if (!isMedioCtaCte(order.medio_pago || '')) return [];
  return (relatedMovements || []).filter((m) => isInvalidCtaCteCobroConcept(m.concepto));
};

const roundMoney = (value) =>
  Math.round((parseFloat(value || 0) + Number.EPSILON) * 100) / 100;

const getOrderPendingCCAmount = (relatedMovements, orderTotal) => {
  const orderRefMatch = relatedMovements?.[0]?.concepto?.match(/#([A-Za-z0-9_]+)/);
  const orderRef = orderRefMatch ? orderRefMatch[1] : null;
  const normalized = dedupePedidoChargeMovements(relatedMovements, orderRef);
  if (!normalized?.length) {
    return Math.max(0, roundMoney(orderTotal));
  }
  const net = normalized.reduce(
    (sum, m) => sum + parseFloat(m.debe || 0) - parseFloat(m.haber || 0),
    0
  );
  return Math.max(0, roundMoney(net));
};

/** Pagos viejos sin compra en el concepto — se imputan FIFO en pantalla y al calcular deuda. */
const applyUnlinkedClientPaymentsFifo = (pendingRows, movements) => {
  const rows = pendingRows.map((row) => ({
    ...row,
    pending: roundMoney(row.pending),
  }));

  const unlinkedPayments = (movements || [])
    .filter((m) => isUnlinkedClientPaymentConcept(m.concepto))
    .sort((a, b) => new Date(a.fecha || 0) - new Date(b.fecha || 0));

  for (const payment of unlinkedPayments) {
    let remaining = roundMoney(parseFloat(payment.haber || 0));
    if (remaining <= 0) continue;

    for (const row of rows) {
      if (remaining <= 0) break;
      if (row.pending <= 0) continue;
      const apply = roundMoney(Math.min(remaining, row.pending));
      row.pending = roundMoney(row.pending - apply);
      remaining = roundMoney(remaining - apply);
    }
  }

  return rows;
};

const buildClientOrderPendingRows = ({ orders, movements, orderIdsFilter = null }) => {
  const idSet = Array.isArray(orderIdsFilter) && orderIdsFilter.length > 0
    ? new Set(orderIdsFilter)
    : null;

  const rows = (orders || [])
    .filter((order) => isFinalizadoEstadoValue(order.estado) && !isCancelledEstadoValue(order.estado))
    .map((order) => {
      const orderRef = getOrderMovementRef(order.id);
      const relatedMovements = getOrderRelatedMovements(movements, orderRef);
      const pending = getOrderPendingCCAmount(relatedMovements, order.total);
      return {
        orderId: order.id,
        orderRef,
        pending,
        total: roundMoney(order.total),
        fecha: order.fecha || order.created_at,
        cliente_nombre: order.cliente_nombre,
        order,
      };
    })
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  const withFifo = applyUnlinkedClientPaymentsFifo(rows, movements);

  return idSet
    ? withFifo.filter((row) => idSet.has(row.orderId))
    : withFifo;
};

const buildClientPaymentAllocations = ({ orders, movements, amount, orderIds, allClientOrders = null }) => {
  const idSet = new Set(orderIds || []);
  const fifoSourceOrders = allClientOrders || orders;
  const effectiveRows = buildClientOrderPendingRows({
    orders: fifoSourceOrders,
    movements,
  });
  const effectivePendingByOrderId = new Map(
    effectiveRows.map((row) => [row.orderId, row.pending])
  );

  const selectedOrders = (orders || [])
    .filter((order) => idSet.has(order.id))
    .filter((order) => isFinalizadoEstadoValue(order.estado) && !isCancelledEstadoValue(order.estado))
    .sort((a, b) => new Date(a.fecha || a.created_at) - new Date(b.fecha || b.created_at));

  let remaining = roundMoney(amount);
  const orderAllocations = [];
  let totalPendingSelected = 0;

  for (const order of selectedOrders) {
    const orderRef = getOrderMovementRef(order.id);
    const pending = roundMoney(effectivePendingByOrderId.get(order.id) || 0);
    totalPendingSelected = roundMoney(totalPendingSelected + pending);
    if (pending <= 0 || remaining <= 0) continue;

    const apply = roundMoney(Math.min(remaining, pending));
    if (apply > 0) {
      orderAllocations.push({ order, orderRef, amount: apply, pending });
      remaining = roundMoney(remaining - apply);
    }
  }

  return {
    orderAllocations,
    depositAmount: remaining,
    totalPendingSelected,
  };
};

const getArgentinaDayBounds = (dateInput) => {
  let dayStr;
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    dayStr = dateInput.trim();
  } else {
    const date = dateInput ? new Date(dateInput) : new Date();
    dayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
  const startUtc = new Date(`${dayStr}T03:00:00.000Z`);
  const endUtc = new Date(startUtc);
  endUtc.setUTCDate(endUtc.getUTCDate() + 1);
  return { dayStr, startIso: startUtc.toISOString(), endIso: endUtc.toISOString() };
};

const isOrderWithinBounds = (order, startIso, endIso) => {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const timestamps = [order.fecha, order.created_at].filter(Boolean);
  return timestamps.some((ts) => {
    const t = new Date(ts).getTime();
    return t >= start && t < end;
  });
};

const applyCuentaCorrienteSyncForOrders = async ({
  finalizedOrders,
  businessId,
  movementsByClient,
  insertMovement,
  deleteMovement,
}) => {
  let processed = 0;
  let fixed = 0;
  let alreadyOk = 0;
  const details = [];

  const ordersByClient = {};
  for (const order of finalizedOrders) {
    if (!ordersByClient[order.cliente_id]) ordersByClient[order.cliente_id] = [];
    ordersByClient[order.cliente_id].push(order);
  }

  for (const clienteId of Object.keys(ordersByClient)) {
    const sortedOrders = [...ordersByClient[clienteId]].sort(
      (a, b) => new Date(a.fecha || a.created_at || 0) - new Date(b.fecha || b.created_at || 0)
    );
    let clientMovements = [...(movementsByClient[clienteId] || [])];

    for (const order of sortedOrders) {
      processed += 1;
      const orderRef = getOrderMovementRef(order.id);
      let relatedMovements = getOrderRelatedMovements(clientMovements, orderRef);

      const invalidCobros = findUnwantedCobrosOnCtaCteOrder(order, relatedMovements);
      if (invalidCobros.length > 0) {
        for (const mov of invalidCobros) {
          await deleteMovement(mov.id);
          clientMovements = clientMovements.filter((m) => m.id !== mov.id);
        }
        movementsByClient[clienteId] = clientMovements;
        relatedMovements = getOrderRelatedMovements(clientMovements, orderRef);
        fixed += 1;
        details.push({
          orderId: order.id,
          orderRef,
          clienteId: order.cliente_id,
          total: order.total,
          removed: invalidCobros.map((m) => m.concepto),
        });
      }

      if (isFinalizedOrderCCComplete(order, relatedMovements)) {
        alreadyOk += 1;
        continue;
      }

      const inserts = [
        ...buildMissingFinalizeMovements(order, relatedMovements),
        ...buildSaldoFavorCobroInserts(order, relatedMovements, clientMovements),
      ];
      if (!inserts.length) {
        alreadyOk += 1;
        continue;
      }

      for (const mov of inserts) {
        await insertMovement(order, mov);
        const stored = { ...mov, cliente_id: order.cliente_id };
        clientMovements.push(stored);
        movementsByClient[clienteId] = clientMovements;
      }

      fixed += 1;
      details.push({
        orderId: order.id,
        orderRef,
        clienteId: order.cliente_id,
        total: order.total,
        inserts: inserts.map((m) => m.concepto),
      });
    }
  }

  return { processed, fixed, alreadyOk, details };
};

// --- IDENTITY HELPERS (For Multi-tenancy) ---
let cachedBusinessId = localStorage.getItem('gst_business_id') || localStorage.getItem('gst_business_id') || '00000000-0000-0000-0000-000000000000';
let cachedTerminalId = localStorage.getItem('gst_terminal_id') || null;

async function resolveTerminalIdForInsert(businessId) {
  const terminalId = getTerminalId();
  if (!isSupabaseConfigured() || !supabase || !terminalId) return null;
  try {
    const { data } = await supabase
      .from('gst_terminals')
      .select('id')
      .eq('id', terminalId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (!data?.id) {
      setTerminalId(null);
      return null;
    }
    return data.id;
  } catch {
    return null;
  }
}

export const getBusinessId = () => {
  const invalid = ['', 'null', 'undefined', '00000000-0000-0000-0000-000000000000'];
  if (!cachedBusinessId || invalid.includes(String(cachedBusinessId))) {
    const stored = localStorage.getItem('gst_business_id');
    if (stored && !invalid.includes(stored)) cachedBusinessId = stored;
  }
  return cachedBusinessId;
};
export const getTerminalId = () => cachedTerminalId;

export const setBusinessId = (id) => {
  if (!id || id === 'null' || id === 'undefined') return;
  cachedBusinessId = id;
  localStorage.setItem('gst_business_id', id);
};

export const setTerminalId = (id) => {
  cachedTerminalId = id || null;
  if (id) localStorage.setItem('gst_terminal_id', id);
  else localStorage.removeItem('gst_terminal_id');
};
// Caching variables for dynamic initialization
let cachedUrl = null;
let cachedKey = null;
let supabaseInstance = null;

const getSupabaseInstance = () => {
  const { url, key } = getCredentials();

  if (!url || !key) return null;

  if (supabaseInstance && cachedUrl === url && cachedKey === key) {
    return supabaseInstance;
  }

  try {
    cachedUrl = url;
    cachedKey = key;
    supabaseInstance = createClient(url, key);
    console.log("Supabase Client Initialized for:", url);
    return supabaseInstance;
  } catch (e) {
    console.error("Failed to initialize Supabase:", e);
    return null;
  }
};

// Proxy to make the supabase export dynamic
export const supabase = new Proxy({}, {
  get: (target, prop) => {
    const instance = getSupabaseInstance();
    if (!instance) {
      console.warn("Supabase access attempted but not configured.");
      return null;
    }
    const value = instance[prop];
    if (typeof value === 'function') {
      return (...args) => {
        if (prop === 'from') {
          console.log(`Accessing table: ${args[0]}`);
        }
        return value.apply(instance, args);
      };
    }
    return value;
  }
});

const INVALID_BUSINESS_ID = ['', 'null', 'undefined', '00000000-0000-0000-0000-000000000000'];

const ensureBusinessContext = async () => {
  const current = getBusinessId();
  if (current && !INVALID_BUSINESS_ID.includes(String(current))) return current;
  if (!isSupabaseConfigured()) return current;

  const instance = getSupabaseInstance();
  if (!instance) return current;

  const { data: { session } } = await instance.auth.getSession();
  if (!session?.user) return current;

  const { data: profile } = await instance
    .from('gst_profiles')
    .select('business_id')
    .eq('id', session.user.id)
    .single();

  if (profile?.business_id) {
    setBusinessId(profile.business_id);
    return profile.business_id;
  }

  console.warn('[Gestion360i] Usuario sin business_id en gst_profiles:', session.user.id);
  return current;
};

const queryGstTable = async (table, businessId, options = {}) => {
  const { orderBy = null, mapRow = null } = options;
  const instance = getSupabaseInstance();
  if (!instance) return [];

  let query = instance.from(table).select('*').eq('business_id', businessId);
  if (orderBy) query = query.order(orderBy.field, { ascending: orderBy.ascending ?? true });

  const { data, error } = await query;
  if (error) {
    console.error(`[Gestion360i] Error en ${table}:`, error.message, { businessId });
    return [];
  }

  const rows = data || [];
  return mapRow ? rows.map(mapRow) : rows;
};

const HISTORICAL_SYNC_KEY = 'gst_historical_sync_done';

const importLegacyRows = async (instance, legacyTable, gstTable, businessId, mapRow, options = {}) => {
  const { matchByName = false } = options;
  const { data: legacyRows, error } = await instance.from(legacyTable).select('*');
  if (error) {
    if (error.code !== '42P01') {
      console.warn(`[Gestion360i] No se pudo leer ${legacyTable}:`, error.message);
    }
    return 0;
  }
  if (!legacyRows?.length) return 0;

  const { data: existing } = await instance.from(gstTable).select('id, nombre').eq('business_id', businessId);
  const existingIds = new Set((existing || []).map((r) => r.id));
  const existingNames = new Set((existing || []).map((r) => (r.nombre || '').toLowerCase()));

  let imported = 0;
  for (const row of legacyRows) {
    if (row.id && existingIds.has(row.id)) continue;
    if (matchByName && existingNames.has((row.nombre || '').toLowerCase())) continue;

    const payload = mapRow(row);
    const { error: insertError } = await instance.from(gstTable).insert([payload]);
    if (insertError) {
      console.warn(`[Gestion360i] Import ${legacyTable}→${gstTable}:`, insertError.message, row.nombre || row.id);
      continue;
    }
    imported += 1;
    if (payload.id) existingIds.add(payload.id);
    if (payload.nombre) existingNames.add(payload.nombre.toLowerCase());
  }

  return imported;
};

const syncHistoricalData = async (businessId) => {
  if (!businessId || INVALID_BUSINESS_ID.includes(String(businessId))) return businessId;
  const instance = getSupabaseInstance();
  if (!instance) return businessId;

  if (sessionStorage.getItem(HISTORICAL_SYNC_KEY) === businessId) return businessId;

  console.info('[Gestion360i] Sincronizando datos históricos...');

  let activeBusinessId = businessId;
  const { data: businesses } = await instance.from('gst_businesses').select('id');
  // Solo reasigna business_id cuando hay UNA sola empresa (migración legacy).
  // Con varias empresas en la BD no se tocan filas de otros tenants.
  if (businesses?.length === 1) {
    activeBusinessId = businesses[0].id;
    setBusinessId(activeBusinessId);
    for (const table of ['gst_clientes', 'gst_personal', 'gst_proveedores', 'gst_productos', 'gst_pedidos', 'gst_pagos_periodicos', 'gst_compras']) {
      await instance.from(table).update({ business_id: activeBusinessId }).neq('business_id', activeBusinessId);
    }
  }

  const clientesImported = await importLegacyRows(instance, 'clientes', 'gst_clientes', activeBusinessId, (row) => ({
    id: row.id,
    business_id: activeBusinessId,
    nombre: row.nombre,
    razon_social: row.razon_social,
    cuit: row.cuit,
    saldo: row.saldo ?? 0,
    telefono: row.telefono,
    condicion_iva: row.condicion_iva || 'Consumidor Final',
    direccion_predeterminada: row.direccion_predeterminada,
  }));

  const personalImported = await importLegacyRows(
    instance,
    'personal',
    'gst_personal',
    activeBusinessId,
    (row) => ({
      business_id: activeBusinessId,
      nombre: row.nombre,
      activo: row.activo ?? true,
    }),
    { matchByName: true }
  );

  const proveedoresImported = await importLegacyRows(instance, 'proveedores', 'gst_proveedores', activeBusinessId, (row) => ({
    id: row.id,
    business_id: activeBusinessId,
    nombre: row.nombre,
    cuit: row.cuit,
    alias: row.alias,
    tipo: row.tipo,
    detalle: row.detalle,
    pago: row.pago,
    factura: row.factura,
  }));

  if (clientesImported + personalImported + proveedoresImported > 0) {
    console.info(
      `[Gestion360i] Importados: ${clientesImported} clientes, ${personalImported} empleados, ${proveedoresImported} proveedores`
    );
  }

  sessionStorage.setItem(HISTORICAL_SYNC_KEY, activeBusinessId);
  return activeBusinessId;
};

const repairPagosPeriodicosBusinessId = async (businessId) => {
  const instance = getSupabaseInstance();
  if (!instance || !businessId) return businessId;

  const { data: businesses, error } = await instance.from('gst_businesses').select('id');
  if (error || !businesses || businesses.length !== 1) return businessId;

  const activeBusinessId = businesses[0].id;
  if (activeBusinessId !== businessId) {
    setBusinessId(activeBusinessId);
  }

  const { error: repairError } = await instance
    .from('gst_pagos_periodicos')
    .update({ business_id: activeBusinessId })
    .neq('business_id', activeBusinessId);

  if (repairError) {
    console.warn('[Gestion360i] repairPagosPeriodicosBusinessId:', repairError.message);
  }

  return activeBusinessId;
};

const BUSINESS_CONFIG = {
  ENABLED_MODULES: 'enabled_modules',
  ROLE_PERMISSIONS: 'role_permissions',
  CIERRE_TURNOS: 'cierre_turnos',
  CIERRE_CONCEPTOS: 'cierre_conceptos',
  CIERRE_MEDIOS_USED: 'cierre_medios_used',
  REPARTIDORES: 'repartidores',
  PEDIDOS_CAJAS: 'pedidos_cajas',
};

const NOTIFICATIONS_CONFIG_KEY = 'notifications';

const dispatchNotificationEvent = async (event, payload) => {
  const instance = getSupabaseInstance();
  if (!isSupabaseConfigured() || !instance?.functions?.invoke) {
    return { success: true, skipped: true, reason: 'no_supabase' };
  }

  try {
    const { data, error } = await instance.functions.invoke('send-notification', {
      body: {
        event,
        title: payload.title,
        message: payload.message,
        payload,
      },
    });

    if (error) {
      console.warn('[Gestion360i] dispatchNotificationEvent:', error.message || error);
      return { success: false, error: error.message || String(error) };
    }

    return data || { success: true };
  } catch (err) {
    console.warn('[Gestion360i] dispatchNotificationEvent:', err);
    return { success: false, error: err.message || String(err) };
  }
};

const notifyCierreCajaSaved = async (cierre, medioValues, medios) => {
  const medioLines = buildCierreMedioLines(medioValues, medios);
  const compras = parseFloat(cierre.compras || 0);
  const adelEfec = parseFloat(cierre.adelantos_efectivo || 0);
  const adelMerc = parseFloat(cierre.adelantos_merc || 0);

  if (compras > 0) medioLines.push({ label: 'Compras/Gastos', amount: compras });
  if (adelEfec > 0) medioLines.push({ label: 'Adelantos efectivo', amount: adelEfec });
  if (adelMerc > 0) medioLines.push({ label: 'Adelantos mercadería', amount: adelMerc });

  const { title, body } = buildCierreCajaNotification({
    fecha: cierre.fecha,
    turno: cierre.turno,
    total: cierre.total,
    medioLines,
  });

  return dispatchNotificationEvent(NOTIFICATION_EVENTS.CIERRE_CAJA, {
    title,
    message: body,
    fecha: cierre.fecha,
    turno: cierre.turno,
    total: parseFloat(cierre.total || 0),
    medios: medioLines,
  });
};

const OPERATIONAL_CONFIG_KEYS = new Set([
  BUSINESS_CONFIG.CIERRE_MEDIOS_USED,
]);

const readConfigRow = (row) => row?.value ?? row?.config_value ?? null;

const getBusinessConfig = async (key) => {
  const businessId = await ensureBusinessContext();
  if (!isSupabaseConfigured() || !supabase || !businessId || INVALID_BUSINESS_ID.includes(String(businessId))) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('gst_configs')
      .select('value, config_value')
      .eq('business_id', businessId)
      .eq('key', key)
      .maybeSingle();

    if (!error && data) {
      return readConfigRow(data);
    }
  } catch (err) {
    console.warn(`[Gestion360i] getBusinessConfig(${key}):`, err);
  }

  return null;
};

const migrateLegacyTerminalConfig = async (businessId, key) => {
  const terminalId = getTerminalId();
  if (!isSupabaseConfigured() || !supabase || !terminalId || !businessId) return null;

  try {
    const { data, error } = await supabase
      .from('gst_configs')
      .select('config_value')
      .eq('business_id', businessId)
      .eq('terminal_id', terminalId)
      .eq('config_key', key)
      .maybeSingle();

    if (error || !data?.config_value) return null;

    const adminCheck = await requireBusinessAdmin();
    if (!adminCheck.ok) return data.config_value;

    await upsertBusinessConfigRow(businessId, key, data.config_value);
    return data.config_value;
  } catch (err) {
    console.warn(`[Gestion360i] migrateLegacyTerminalConfig(${key}):`, err);
    return null;
  }
};

const saveBusinessConfig = async (key, value) => {
  const adminCheck = await requireBusinessAdmin();
  if (!adminCheck.ok) return adminCheck;

  return saveTenantConfig(key, value);
};

const buildConfigRowPayload = (businessId, key, value) => ({
  business_id: businessId,
  key,
  value,
  config_key: key,
  config_value: value,
  updated_at: new Date().toISOString(),
});

const upsertBusinessConfigRow = async (businessId, key, value) => {
  if (!isSupabaseConfigured() || !supabase || !businessId) {
    return { ok: false, error: 'Empresa no configurada' };
  }

  const payload = buildConfigRowPayload(businessId, key, value);

  try {
    const { error: upsertError } = await supabase.from('gst_configs').upsert(
      payload,
      { onConflict: 'business_id,key' }
    );
    if (!upsertError) return { ok: true };

    console.warn(`[Gestion360i] upsert gst_configs(${key}):`, upsertError.message);

    const { data: existing, error: selectError } = await supabase
      .from('gst_configs')
      .select('id')
      .eq('business_id', businessId)
      .eq('key', key)
      .maybeSingle();

    if (selectError) return { ok: false, error: selectError.message };

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from('gst_configs')
        .update({
          value,
          config_value: value,
          config_key: key,
          updated_at: payload.updated_at,
        })
        .eq('id', existing.id);
      if (updateError) return { ok: false, error: updateError.message };
      return { ok: true };
    }

    const { error: insertError } = await supabase.from('gst_configs').insert(payload);
    if (insertError) return { ok: false, error: insertError.message };
    return { ok: true };
  } catch (err) {
    console.warn(`[Gestion360i] upsertBusinessConfigRow(${key}):`, err);
    return { ok: false, error: err.message || 'Error al guardar configuración' };
  }
};

const saveTenantConfig = async (key, value) => {
  const businessId = await ensureBusinessContext();
  if (!isSupabaseConfigured() || !supabase || !businessId || INVALID_BUSINESS_ID.includes(String(businessId))) {
    return { ok: false, error: 'Empresa no configurada' };
  }

  return upsertBusinessConfigRow(businessId, key, value);
};

const saveOperationalConfig = async (key, value) => {
  if (!OPERATIONAL_CONFIG_KEYS.has(key)) {
    return { ok: false, error: 'Config operativa no permitida' };
  }
  return saveTenantConfig(key, value);
};

const mergeCierreMediosUsed = (medios, usedMap) => {
  if (!usedMap || typeof usedMap !== 'object' || Object.keys(usedMap).length === 0) {
    return medios;
  }
  return medios.map((medio) => ({
    ...medio,
    used: usedMap[medio.id] === true,
  }));
};

const stripCierreMediosUsed = (medios = []) =>
  medios.map(({ used, ...medio }) => medio);

const buildCierreMediosUsedMap = (medios = []) => {
  const usedMap = {};
  medios.forEach((medio) => {
    if (medio?.id && medio.used === true) usedMap[medio.id] = true;
  });
  return usedMap;
};

const requireBusinessAdmin = async () => {
  const instance = getSupabaseInstance();
  if (!instance) return { ok: false, error: 'Supabase no configurado' };

  const { data: { session } } = await instance.auth.getSession();
  if (!session?.user) return { ok: false, error: 'Debe iniciar sesión' };

  const { data: profile, error } = await instance
    .from('gst_profiles')
    .select('role')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (normalizeRoleKey(profile?.role) !== 'admin') {
    return { ok: false, error: 'Solo el administrador de la empresa puede modificar la configuración' };
  }

  return { ok: true };
};

const rejectAdminRoleAssignment = (role) => {
  if (normalizeRoleKey(role) === 'admin') {
    return 'Solo puede existir un administrador por empresa. El rol administrador no se asigna manualmente.';
  }
  return null;
};

const EMPLEADO_MOVIMIENTOS_SELECT = '*, gst_personal(nombre)';

const mapEmpleadoMovimientoRow = (row) => {
  if (!row) return row;
  const personalNombre = row.gst_personal?.nombre;
  return {
    ...row,
    empleado: personalNombre || row.empleado || 'Empleado',
    gst_personal: undefined,
  };
};

const mapEmpleadoMovimientoRows = (rows) => (rows || []).map(mapEmpleadoMovimientoRow);

const resolveEmpleadoMovimientoIdentity = async (mov) => {
  const businessId = await ensureBusinessContext();
  let empleadoId = mov?.empleado_id || null;
  let empleadoNombre = String(mov?.nombre_empleado || mov?.empleado || '').trim();

  const resolveFromMockPersonal = () => {
    const list = JSON.parse(localStorage.getItem('mock_personal_full') || '[]');
    if (empleadoId) {
      const emp = list.find((row) => row.id === empleadoId);
      if (emp) {
        return { empleadoId: emp.id, empleadoNombre: emp.nombre || empleadoNombre };
      }
    }
    if (empleadoNombre) {
      const emp = list.find(
        (row) => String(row.nombre || '').trim().toLowerCase() === empleadoNombre.toLowerCase()
      );
      if (emp) {
        return { empleadoId: emp.id, empleadoNombre: emp.nombre };
      }
    }
    return null;
  };

  if (!isSupabaseConfigured() || !supabase) {
    const resolved = resolveFromMockPersonal();
    if (resolved) return resolved;
    return { error: 'Seleccioná un empleado del listado.' };
  }

  if (isSupabaseConfigured() && supabase) {
    if (empleadoId && !empleadoNombre) {
      const { data } = await supabase
        .from('gst_personal')
        .select('nombre')
        .eq('business_id', businessId)
        .eq('id', empleadoId)
        .maybeSingle();
      empleadoNombre = data?.nombre || empleadoNombre;
    } else if (!empleadoId && empleadoNombre) {
      const { data } = await supabase
        .from('gst_personal')
        .select('id, nombre')
        .eq('business_id', businessId)
        .ilike('nombre', empleadoNombre)
        .limit(5);
      const exact = (data || []).find(
        (row) => String(row.nombre || '').trim().toLowerCase() === empleadoNombre.toLowerCase()
      );
      if (exact) {
        empleadoId = exact.id;
        empleadoNombre = exact.nombre;
      }
    }
  }

  if (!empleadoId) {
    return {
      error: 'Seleccioná un empleado del listado (gst_personal).',
    };
  }

  if (!empleadoNombre) {
    empleadoNombre = 'Empleado';
  }

  return { empleadoId, empleadoNombre };
};

const LEGACY_DEMO_ADELANTO_IDS = new Set(['ad1', 'ad2']);

const purgeLegacyDemoAdelantosLocal = () => {
  try {
    const raw = localStorage.getItem('mock_empleado_movimientos');
    if (!raw) return;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return;
    const filtered = list.filter((row) => !LEGACY_DEMO_ADELANTO_IDS.has(row.id));
    if (filtered.length !== list.length) {
      localStorage.setItem('mock_empleado_movimientos', JSON.stringify(filtered));
    }
  } catch {
    // ignore invalid mock storage
  }
};

const fetchAdelantosMovimientos = async (limitDays = 90) => {
  const businessId = getBusinessId();
  const limitDate = new Date();
  limitDate.setDate(limitDate.getDate() - limitDays);
  const limitIso = limitDate.toISOString();

  if (isSupabaseConfigured() && supabase) {
    try {
      const [recentRes, pendingRes] = await Promise.all([
        supabase.from('gst_empleado_movimientos').select(EMPLEADO_MOVIMIENTOS_SELECT).eq('business_id', businessId).gte('fecha', limitIso),
        supabase.from('gst_empleado_movimientos').select(EMPLEADO_MOVIMIENTOS_SELECT).eq('business_id', businessId).is('caja_cierre', null)
      ]);

      if (recentRes.error) throw recentRes.error;
      if (pendingRes.error) throw pendingRes.error;

      const combined = [...mapEmpleadoMovimientoRows(recentRes.data), ...mapEmpleadoMovimientoRows(pendingRes.data)];
      const map = {};
      combined.forEach(item => {
        map[item.id] = item;
      });
      const list = Object.values(map);
      list.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
      return list;
    } catch (err) {
      console.warn('Supabase fetchAdelantosMovimientos failed:', err);
    }
  }

  purgeLegacyDemoAdelantosLocal();
  const stored = localStorage.getItem('mock_empleado_movimientos');
  if (!stored) return [];
  const list = JSON.parse(stored);
  return list
    .filter(ad => new Date(ad.fecha) >= new Date(limitIso) || ad.caja_cierre === null)
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
};

const fetchEmpleadoMovimientosByEmployee = async (empleadoId, empleadoNombre) => {
  const businessId = getBusinessId();
  if (isSupabaseConfigured() && supabase) {
    try {
      let query = supabase
        .from('gst_empleado_movimientos')
        .select(EMPLEADO_MOVIMIENTOS_SELECT)
        .eq('business_id', businessId);

      if (empleadoId) {
        query = query.eq('empleado_id', empleadoId);
      } else if (empleadoNombre) {
        query = query.eq('empleado', empleadoNombre);
      } else {
        return [];
      }

      const { data, error } = await query.order('fecha', { ascending: false });
      if (error) throw error;
      return mapEmpleadoMovimientoRows(data);
    } catch (err) {
      console.error('Error fetching employee movements:', err);
    }
  }
  return [];
};

export const forceHistoricalSync = async () => {
  sessionStorage.removeItem(HISTORICAL_SYNC_KEY);
  const businessId = await ensureBusinessContext();
  await syncHistoricalData(businessId);
  return businessId;
};

/**
 * DATABASE INTERFACE / DATA LAYER
 * Dynamically switches between Supabase and LocalStorage (Demo Mode)
 */
export const db = {
  // --- AUTH & USER MANAGEMENT ---
  signUp: async (email, password, businessName, fullName, { isMonotributo = false } = {}) => {
    if (!isSupabaseConfigured() || !supabase) return { error: 'Supabase not configured' };
    
    try {
      // 1. Create User
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });
      if (authError) throw authError;
      if (!authData.user) throw new Error('No user returned');

      // 2. Create Business
      const { data: bizData, error: bizError } = await supabase
        .from('gst_businesses')
        .insert([{ name: businessName }])
        .select()
        .single();
      if (bizError) throw bizError;

      // 3. Create Profile (admin único — antes de la terminal para RLS)
      const { error: profError } = await supabase
        .from('gst_profiles')
        .insert([{
          id: authData.user.id,
          business_id: bizData.id,
          full_name: fullName,
          role: 'admin'
        }]);
      if (profError) throw profError;

      setBusinessId(bizData.id);

      await saveTenantConfig(BUSINESS_FISCAL_CONFIG_KEY, {
        condicion: isMonotributo ? 'monotributo' : 'responsable_inscripto',
      });

      // 4. Create Default Terminal
      const { data: termData, error: termError } = await supabase
        .from('gst_terminals')
        .insert([{
          business_id: bizData.id,
          name: 'Terminal Principal',
          terminal_type: 'owner'
        }])
        .select()
        .single();
      if (termError) throw termError;
      
      setTerminalId(termData.id);

      await db.seedBusinessDefaults({ isMonotributo });

      return { success: true, user: authData.user, business: bizData };
    } catch (err) {
      console.error('Sign up error:', err);
      return { error: err.message };
    }
  },

  signIn: async (email, password) => {
    if (!isSupabaseConfigured() || !supabase) return { error: 'Supabase not configured' };
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    
    // Refresh profile and business_id
    const profile = await db.getUserProfile(data.user.id);
    if (profile) setBusinessId(profile.business_id);
    
    return { success: true, user: data.user };
  },

  signOut: async () => {
    if (supabase) await supabase.auth.signOut();
    localStorage.removeItem('gst_business_id');
    cachedBusinessId = '00000000-0000-0000-0000-000000000000';
    clearArcaLegacyCache();
  },

  getUserProfile: async (userId) => {
    if (!isSupabaseConfigured() || !supabase) return null;
    const { data, error } = await supabase
      .from('gst_profiles')
      .select('*, gst_businesses(name)')
      .eq('id', userId)
      .single();
    if (!error && data) return data;

    const { data: fallback, error: fallbackError } = await supabase
      .from('gst_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (fallbackError) {
      console.error('[Gestion360i] getUserProfile error:', error?.message || fallbackError.message);
      return null;
    }
    return fallback;
  },

  getCurrentSession: async () => {
    if (!isSupabaseConfigured() || !supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    if (session && session.user) {
      const profile = await db.getUserProfile(session.user.id);
      if (profile) {
        setBusinessId(profile.business_id);
        
        // Also fetch a terminal if none set
        const { data: terms } = await supabase
          .from('gst_terminals')
          .select('id')
          .eq('business_id', profile.business_id)
          .limit(1);
        
        if (terms && terms.length > 0) {
          setTerminalId(terms[0].id);
        } else {
          setTerminalId(null);
        }

        return { user: session.user, profile };
      }
    }
    return null;
  },

  // --- MODULE SETTINGS (por empresa) ---
  getModules: async () => {
    const defaultModules = {
      cierre: true,
      compras: true,
      adelantos: true,
      rendiciones: true,
      clientes: true,
      tareas: true,
      proveedores: true,
      empleados: true,
      resultados: true,
      'pagos-periodicos': true,
      'pago-proveedores': true,
      'pago-impuestos': true
    };

    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase && businessId) {
      try {
        let config =
          (await getBusinessConfig(BUSINESS_CONFIG.ENABLED_MODULES)) ||
          (await migrateLegacyTerminalConfig(businessId, BUSINESS_CONFIG.ENABLED_MODULES));
        if (config) {
          return { ...defaultModules, ...config };
        }
      } catch (err) {
        console.warn('Supabase getModules error:', err);
      }
    }

    const stored = localStorage.getItem('enabled_modules');
    return stored ? { ...defaultModules, ...JSON.parse(stored) } : defaultModules;
  },

  saveModules: async (modules) => {
    const result = isSupabaseConfigured() && supabase
      ? await saveBusinessConfig(BUSINESS_CONFIG.ENABLED_MODULES, modules)
      : { ok: true };
    if (!result.ok) return { success: false, error: result.error };
    localStorage.setItem('enabled_modules', JSON.stringify(modules));
    return { success: true };
  },

  getRolePermissions: async () => {
    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase && businessId) {
      try {
        let config =
          (await getBusinessConfig(BUSINESS_CONFIG.ROLE_PERMISSIONS)) ||
          (await migrateLegacyTerminalConfig(businessId, BUSINESS_CONFIG.ROLE_PERMISSIONS));
        if (config) return config;
      } catch (err) {
        console.warn('Supabase getRolePermissions error:', err);
      }
    }

    const stored = localStorage.getItem('role_permissions');
    return stored ? JSON.parse(stored) : null;
  },

  saveRolePermissions: async (perms) => {
    const result = isSupabaseConfigured() && supabase
      ? await saveBusinessConfig(BUSINESS_CONFIG.ROLE_PERMISSIONS, perms)
      : { ok: true };
    if (!result.ok) return { success: false, error: result.error };
    localStorage.setItem('role_permissions', JSON.stringify(perms));
    return { success: true };
  },

  // --- ARCA (por empresa / business_id) ---
  getArcaConfig: async () => {
    const businessId = getBusinessId();
    let config = null;

    if (isSupabaseConfigured() && supabase && isValidBusinessId(businessId)) {
      try {
        const { data: kvRow, error: kvError } = await supabase
          .from('gst_configs')
          .select('value')
          .eq('business_id', businessId)
          .eq('key', ARCA_CONFIG_KEY)
          .maybeSingle();

        if (!kvError && kvRow?.value) {
          config = normalizeArcaConfig(kvRow.value);
        } else {
          const { data: cfgRows, error: cfgError } = await supabase
            .from('gst_configs')
            .select('config_value')
            .eq('business_id', businessId)
            .eq('config_key', ARCA_CONFIG_KEY)
            .order('updated_at', { ascending: false })
            .limit(1);

          if (!cfgError && cfgRows?.[0]?.config_value) {
            config = normalizeArcaConfig(cfgRows[0].config_value);
          }
        }
      } catch (err) {
        console.warn('Supabase getArcaConfig failed:', err);
      }
    }

    if (!config || (!config.cuit && !config.cert && !config.private_key)) {
      config = readArcaFromCache(businessId);
      const legacy = readLegacyArcaFromLocalStorage();
      if (!config.cuit && !config.cert && !config.private_key && (legacy.cuit || legacy.cert || legacy.private_key)) {
        config = legacy;
      }
    }

    applyArcaToCache(businessId, config || emptyArcaConfig());
    return config || emptyArcaConfig();
  },

  saveArcaConfig: async (config) => {
    const adminCheck = await requireBusinessAdmin();
    const businessId = getBusinessId();
    const terminalId = getTerminalId();
    const normalized = normalizeArcaConfig(config);
    applyArcaToCache(businessId, normalized);

    if (!adminCheck.ok) {
      return { success: false, stored: 'local', error: adminCheck.error };
    }

    if (!isSupabaseConfigured() || !supabase || !isValidBusinessId(businessId)) {
      return { success: true, stored: 'local' };
    }

    try {
      const kvResult = await upsertBusinessConfigRow(businessId, ARCA_CONFIG_KEY, normalized);
      if (kvResult.ok) {
        return { success: true, stored: 'cloud' };
      }

      if (terminalId) {
        const { error: cfgError } = await supabase
          .from('gst_configs')
          .upsert(
            {
              business_id: businessId,
              terminal_id: terminalId,
              config_key: ARCA_CONFIG_KEY,
              config_value: normalized,
            },
            { onConflict: 'terminal_id,config_key' }
          );

        if (!cfgError) {
          return { success: true, stored: 'cloud' };
        }
        throw new Error(cfgError.message);
      }

      throw new Error(kvResult.error || 'No se pudo guardar ARCA');
    } catch (err) {
      console.warn('Supabase saveArcaConfig failed:', err);
      return { success: true, stored: 'local', warning: err.message };
    }
  },

  // --- CIERRE CONFIGURATIONS (SHIFTS & CONCEPTS) ---
  getCierreTurnos: async () => {
    const businessId = await ensureBusinessContext();

    if (isSupabaseConfigured() && supabase && businessId) {
      try {
        let turnos =
          (await getBusinessConfig(BUSINESS_CONFIG.CIERRE_TURNOS)) ||
          (await migrateLegacyTerminalConfig(businessId, BUSINESS_CONFIG.CIERRE_TURNOS));
        if (turnos) return getCierreTurnoNames(normalizeCierreTurnos(turnos));
      } catch (err) {
        console.warn('Supabase getCierreTurnos failed:', err);
      }
    }

    const stored = localStorage.getItem('cierre_turnos');
    return getCierreTurnoNames(
      normalizeCierreTurnos(stored ? JSON.parse(stored) : DEFAULT_CIERRE_TURNOS)
    );
  },

  getCierreTurnoNames: async () => db.getCierreTurnos(),

  saveCierreTurnos: async (turnos) => {
    const names = (turnos || [])
      .map((item) => (typeof item === 'string' ? item.trim() : getTurnoName(item)))
      .filter((name) => name.length > 0);
    const payload = names.length > 0
      ? names
      : getCierreTurnoNames(DEFAULT_CIERRE_TURNOS);
    const result = isSupabaseConfigured() && supabase
      ? await saveBusinessConfig(BUSINESS_CONFIG.CIERRE_TURNOS, payload)
      : { ok: true };
    if (!result.ok) return { success: false, error: result.error };
    localStorage.setItem('cierre_turnos', JSON.stringify(payload));
    return { success: true };
  },

  getPedidosCajasConfig: async () => {
    const businessId = await ensureBusinessContext();
    const turnoNames = await db.getCierreTurnos();

    if (isSupabaseConfigured() && supabase && businessId) {
      try {
        const stored =
          (await getBusinessConfig(BUSINESS_CONFIG.PEDIDOS_CAJAS)) ||
          (await migrateLegacyTerminalConfig(businessId, BUSINESS_CONFIG.PEDIDOS_CAJAS));
        if (stored?.assignments) {
          return normalizePedidosCajasConfig(turnoNames, stored);
        }
      } catch (err) {
        console.warn('Supabase getPedidosCajasConfig failed:', err);
      }
    }

    const stored = localStorage.getItem('pedidos_cajas');
    if (stored) {
      try {
        return normalizePedidosCajasConfig(turnoNames, JSON.parse(stored));
      } catch {
        // ignore invalid cache
      }
    }

    return normalizePedidosCajasConfig(turnoNames, null);
  },

  savePedidosCajasConfig: async (config) => {
    const turnoNames = await db.getCierreTurnos();
    const normalized = normalizePedidosCajasConfig(turnoNames, config);
    const result = isSupabaseConfigured() && supabase
      ? await saveBusinessConfig(BUSINESS_CONFIG.PEDIDOS_CAJAS, normalized)
      : { ok: true };
    if (!result.ok) return { success: false, error: result.error };
    localStorage.setItem('pedidos_cajas', JSON.stringify(normalized));
    return { success: true };
  },

  getNotificationsConfig: async () => {
    const stored = await getBusinessConfig(NOTIFICATIONS_CONFIG_KEY);
    if (stored) return normalizeNotificationsConfig(stored);
    try {
      const local = localStorage.getItem('notifications_config');
      if (local) return normalizeNotificationsConfig(JSON.parse(local));
    } catch (_) {
      /* ignore */
    }
    return normalizeNotificationsConfig(null);
  },

  saveNotificationsConfig: async (config) => {
    const normalized = normalizeNotificationsConfig(config);
    const result = isSupabaseConfigured() && supabase
      ? await saveBusinessConfig(NOTIFICATIONS_CONFIG_KEY, normalized)
      : { ok: true };
    if (!result.ok) return { success: false, error: result.error };
    localStorage.setItem('notifications_config', JSON.stringify(normalized));
    return { success: true };
  },

  getRepartidores: async () => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase && businessId) {
      try {
        const list =
          (await getBusinessConfig(BUSINESS_CONFIG.REPARTIDORES)) ||
          (await migrateLegacyTerminalConfig(businessId, BUSINESS_CONFIG.REPARTIDORES));
        if (list) return Array.isArray(list) ? list : [];
      } catch (err) {
        console.warn('Supabase getRepartidores failed:', err);
      }
    }

    const stored = localStorage.getItem('repartidores_list');
    return stored ? JSON.parse(stored) : [];
  },

  saveRepartidores: async (repartidores) => {
    const cleanList = (repartidores || [])
      .map((name) => String(name || '').trim())
      .filter((name) => name.length > 0);

    const result = isSupabaseConfigured() && supabase
      ? await saveBusinessConfig(BUSINESS_CONFIG.REPARTIDORES, cleanList)
      : { ok: true };
    if (!result.ok) return { success: false, error: result.error };

    localStorage.setItem('repartidores_list', JSON.stringify(cleanList));
    return { success: true };
  },

  getCierreConceptos: async () => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_configs')
          .select('value')
          .eq('business_id', businessId)
          .eq('key', BUSINESS_CONFIG.CIERRE_CONCEPTOS)
          .maybeSingle();
        const { data: usedRow } = await supabase
          .from('gst_configs')
          .select('value')
          .eq('business_id', businessId)
          .eq('key', BUSINESS_CONFIG.CIERRE_MEDIOS_USED)
          .maybeSingle();

        if (!error && data) {
          const normalized = normalizeCierreMedios(data.value);
          return mergeCierreMediosUsed(normalized, usedRow?.value);
        }
      } catch (err) {
        console.warn("Supabase getCierreConceptos failed:", err);
      }
    }
    const stored = localStorage.getItem('cierre_conceptos');
    const storedUsed = localStorage.getItem('cierre_medios_used');
    const normalized = normalizeCierreMedios(stored ? JSON.parse(stored) : null);
    return mergeCierreMediosUsed(
      normalized,
      storedUsed ? JSON.parse(storedUsed) : null
    );
  },

  saveCierreConceptos: async (concepts) => {
    const normalized = normalizeCierreMedios(concepts);
    const adminCheck = await requireBusinessAdmin();
    if (!adminCheck.ok) return { success: false, error: adminCheck.error };

    const structure = stripCierreMediosUsed(normalized);
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      const result = await upsertBusinessConfigRow(
        businessId,
        BUSINESS_CONFIG.CIERRE_CONCEPTOS,
        structure
      );
      if (!result.ok) {
        return { success: false, error: result.error };
      }
    }
    localStorage.setItem('cierre_conceptos', JSON.stringify(structure));
    return { success: true };
  },

  saveCierreMediosUsed: async (medios) => {
    const usedMap = buildCierreMediosUsedMap(medios);
    const result = isSupabaseConfigured() && supabase
      ? await saveOperationalConfig(BUSINESS_CONFIG.CIERRE_MEDIOS_USED, usedMap)
      : { ok: true };
    if (!result.ok) return { success: false, error: result.error };
    localStorage.setItem('cierre_medios_used', JSON.stringify(usedMap));
    return { success: true };
  },

  // --- TASKS (For Dashboard display) ---
  getTasks: async () => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_tareas')
          .select('*')
          .eq('business_id', businessId)
          .order('estado', { ascending: false }) // 'Pendiente' first
          .order('created_at', { ascending: false })
          .limit(15);
        if (!error) return data;
        console.warn("Supabase tasks query failed, falling back to mock:", error);
      } catch (err) {
        console.warn("Supabase tasks error, falling back to mock:", err);
      }
    }

    // Mock Fallback
    const storedTasks = localStorage.getItem('mock_tasks');
    if (storedTasks) {
      return JSON.parse(storedTasks);
    }
    
    // Seed initial mock tasks if empty
    const initialTasks = [
      { id: 1, tarea: "Limpiar freezer y reponer helado", caracter: "Mantenimiento 🛠️", usuario: "operario", estado: "Pendiente", fecha: "24/06" },
      { id: 2, tarea: "Reponer stock de jugos exprimidos", caracter: "Normal", usuario: "cajero", estado: "Pendiente", fecha: "24/06" },
      { id: 3, tarea: "Llamar a distribuidora por faltante", caracter: "Urgente 🔴", usuario: "admin", estado: "Pendiente", fecha: "24/06" },
      { id: 4, tarea: "Barrer y trapear salón antes del cierre", caracter: "Limpieza 🧹", usuario: "operario", estado: "Realizada", fecha: "23/06" }
    ];
    localStorage.setItem('mock_tasks', JSON.stringify(initialTasks));
    return initialTasks;
  },

  saveTask: async (task) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_tareas')
          .insert([{
            business_id: businessId,
            caracter: task.caracter,
            tarea: task.tarea,
            usuario: task.rol || task.usuario || 'operario',
            estado: 'Pendiente'
          }])
          .select();
        if (!error) return { success: true, data };
        console.warn("Supabase task save failed, falling back to mock:", error);
      } catch (err) {
        console.warn("Supabase task save error, falling back to mock:", err);
      }
    }

    // Mock Saving
    const storedTasks = localStorage.getItem('mock_tasks');
    const tasks = storedTasks ? JSON.parse(storedTasks) : [];
    const newTask = {
      id: Date.now(),
      tarea: task.tarea,
      caracter: task.caracter,
      usuario: task.rol || task.usuario || 'operario',
      estado: 'Pendiente',
      fecha: new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
    };
    tasks.unshift(newTask); // Add to beginning
    localStorage.setItem('mock_tasks', JSON.stringify(tasks));
    return { success: true, data: newTask };
  },

  toggleTask: async (id) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        // First get current state to flip it
        const { data: current } = await supabase
          .from('gst_tareas')
          .select('estado')
          .eq('id', id)
          .eq('business_id', businessId)
          .single();
        
        const newState = current.estado === 'Pendiente' ? 'Realizada' : 'Pendiente';
        
        const { data, error } = await supabase
          .from('gst_tareas')
          .update({ estado: newState })
          .eq('id', id)
          .eq('business_id', businessId)
          .select();
        if (!error) return { success: true, data };
        console.warn("Supabase task toggle failed, falling back to mock:", error);
      } catch (err) {
        console.warn("Supabase task toggle error, falling back to mock:", err);
      }
    }

    // Mock Toggle
    const storedTasks = localStorage.getItem('mock_tasks');
    if (storedTasks) {
      const tasks = JSON.parse(storedTasks);
      const updated = tasks.map(t => {
        if (t.id === id) {
          return { ...t, estado: t.estado === 'Pendiente' ? 'Realizada' : 'Pendiente' };
        }
        return t;
      });
      localStorage.setItem('mock_tasks', JSON.stringify(updated));
    }
    return { success: true };
  },

  // --- CLIENTS & ORDERS MODULE ---
  getClientes: async () => {
    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase) {
      try {
        await syncHistoricalData(businessId);
        const activeBusinessId = getBusinessId();
        const rows = await queryGstTable('gst_clientes', activeBusinessId, {
          orderBy: { field: 'nombre', ascending: true }
        });
        return rows;
      } catch (err) {
        console.warn("Supabase getClientes error:", err);
      }
    }

    // Mock Fallback
    const stored = localStorage.getItem('mock_clientes');
    if (stored) {
      return JSON.parse(stored);
    }

    // Seed mock clients
    const initialClientes = [
      { id: "c1", nombre: "Distribuidora Dietética S.A.", razon_social: "Dietética Distribuidora S.A.", cuit: "30-71112223-9", saldo: 15400.00, telefono: "5491123456789", condicion_iva: "Responsable Inscripto" },
      { id: "c2", nombre: "Almacén de Juana", razon_social: "Juana María Gomez", cuit: "27-25123456-2", saldo: 0.00, telefono: "5491198765432", condicion_iva: "Consumidor Final" },
      { id: "c3", nombre: "Rincón Gourmet", razon_social: "Rincón Gourmet S.R.L.", cuit: "30-55443322-1", saldo: 24500.00, telefono: "", condicion_iva: "Responsable Inscripto" }
    ];
    localStorage.setItem('mock_clientes', JSON.stringify(initialClientes));
    return initialClientes;
  },
 
  saveCliente: async (cliente) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const insertData = {
          business_id: businessId,
          nombre: cliente.nombre,
          razon_social: cliente.razon_social,
          cuit: cliente.cuit,
          condicion_iva: cliente.condicion_iva || 'Consumidor Final',
          saldo: cliente.saldo ?? 0,
        };
        if (cliente.telefono) {
          insertData.telefono = cliente.telefono;
        }
        if (cliente.direccion_predeterminada) {
          insertData.direccion_predeterminada = cliente.direccion_predeterminada;
        }
        if (cliente.lista_precio_id) {
          insertData.lista_precio_id = cliente.lista_precio_id;
        }
        const { data, error } = await supabase
          .from('gst_clientes')
          .insert([insertData])
          .select()
          .single();
        if (!error) return { success: true, data };
        
        console.warn("Supabase saveCliente failed, falling back to mock:", error);
      } catch (err) {
        console.warn("Supabase saveCliente error, falling back to mock:", err);
      }
    }
 
    // Mock Saving
    const stored = localStorage.getItem('mock_clientes');
    const clientes = stored ? JSON.parse(stored) : [];
    const newCliente = {
      id: "c_" + Date.now(),
      nombre: cliente.nombre,
      razon_social: cliente.razon_social,
      cuit: cliente.cuit,
      condicion_iva: cliente.condicion_iva || 'Consumidor Final',
      telefono: cliente.telefono || '',
      saldo: cliente.saldo ?? 0,
      direccion_predeterminada: cliente.direccion_predeterminada || null,
      lista_precio_id: cliente.lista_precio_id || null,
    };
    clientes.push(newCliente);
    localStorage.setItem('mock_clientes', JSON.stringify(clientes));
    return { success: true, data: newCliente };
  },

  clearAllClientes: async () => {
    const adminCheck = await requireBusinessAdmin();
    if (!adminCheck.ok) throw new Error(adminCheck.error);

    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase) {
      const { error: itemsErr } = await supabase
        .from('gst_pedido_items')
        .delete()
        .eq('business_id', businessId);
      if (itemsErr) throw itemsErr;

      const { error: ordersErr } = await supabase
        .from('gst_pedidos')
        .delete()
        .eq('business_id', businessId);
      if (ordersErr) throw ordersErr;

      const { error: movsErr } = await supabase
        .from('gst_cliente_movimientos')
        .delete()
        .eq('business_id', businessId);
      if (movsErr) throw movsErr;

      const { error: dirsErr } = await supabase
        .from('gst_cliente_direcciones')
        .delete()
        .eq('business_id', businessId);
      if (dirsErr) throw dirsErr;

      const { error: clientsErr } = await supabase
        .from('gst_clientes')
        .delete()
        .eq('business_id', businessId);
      if (clientsErr) throw clientsErr;

      return { success: true };
    }

    localStorage.setItem('mock_clientes', JSON.stringify([]));
    localStorage.setItem('mock_direcciones', JSON.stringify([]));
    localStorage.setItem('mock_movimientos', JSON.stringify([]));
    localStorage.setItem('mock_pedidos', JSON.stringify([]));
    return { success: true };
  },

  importClientesFromCsv: async (csvText, { replaceAll = false, columnMapping, hasHeaderRow } = {}) => {
    const rows = parseCsvText(csvText);
    const analysis = analyzeCsvImport(csvText);
    if (analysis.error) {
      return {
        success: false,
        imported: 0,
        skipped: 0,
        skippedEmpty: 0,
        inferredNames: 0,
        failed: 0,
        deleted: 0,
        errors: [analysis.error],
      };
    }

    const mapping = columnMapping || analysis.suggestedMapping;
    const useHeaderRow = hasHeaderRow ?? analysis.hasHeaderRow;
    const { clients, errors: parseErrors, skippedEmpty = 0, inferredNames = 0 } = mapCsvRowsToClientes(rows, {
      columnMapping: mapping,
      hasHeaderRow: useHeaderRow,
    });
    if (!clients.length) {
      return {
        success: false,
        imported: 0,
        skipped: 0,
        skippedEmpty,
        inferredNames,
        failed: 0,
        deleted: 0,
        errors: parseErrors.length ? parseErrors : ['No hay clientes para importar.'],
      };
    }

    let deleted = 0;
    if (replaceAll) {
      const existing = await db.getClientes();
      deleted = existing?.length || 0;
      await db.clearAllClientes();
    }

    const existing = replaceAll ? [] : await db.getClientes();
    const existingNames = new Set(
      (existing || []).map((cliente) => String(cliente.nombre || '').trim().toLowerCase())
    );

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [...parseErrors];
    if (inferredNames > 0) {
      errors.unshift(`${inferredNames} fila(s) importada(s) con nombre inferido (columna A vacía).`);
    }
    if (skippedEmpty > 0) {
      errors.unshift(`${skippedEmpty} fila(s) completamente vacía(s) omitida(s).`);
    }

    for (const row of clients) {
      const key = row.nombre.trim().toLowerCase();
      if (existingNames.has(key)) {
        skipped += 1;
        continue;
      }

      try {
        const res = await db.saveCliente({
          nombre: row.nombre,
          razon_social: row.razon_social,
          cuit: row.cuit,
          telefono: row.telefono,
          condicion_iva: row.condicion_iva,
          saldo: row.saldo,
          direccion_predeterminada: row.direccion || undefined,
        });

        if (!res.success || !res.data?.id) {
          failed += 1;
          errors.push(`Fila ${row.sourceLine} (${row.nombre}): no se pudo guardar.`);
          continue;
        }

        if (row.direccion) {
          const dirRes = await db.saveDireccion(res.data.id, row.direccion);
          if (!dirRes.success) {
            errors.push(`Fila ${row.sourceLine} (${row.nombre}): cliente creado pero falló la dirección.`);
          }
        }

        if (row.saldo !== 0) {
          await db.updateClienteSaldo(res.data.id, row.saldo);
        }

        existingNames.add(key);
        imported += 1;
      } catch (err) {
        failed += 1;
        errors.push(`Fila ${row.sourceLine} (${row.nombre}): ${err.message || 'error desconocido'}`);
      }
    }

    return {
      success: failed === 0,
      imported,
      skipped,
      skippedEmpty,
      inferredNames,
      failed,
      deleted,
      errors,
    };
  },

  updateCliente: async (id, updates) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_clientes')
          .update(updates)
          .eq('id', id)
          .eq('business_id', businessId)
          .select()
          .single();
        if (!error) return { success: true, data };
        
        // Handle case where column might be missing, log it
        console.warn("Supabase updateCliente failed, falling back to mock:", error);
      } catch (err) {
        console.warn("Supabase updateCliente error, falling back to mock:", err);
      }
    }

    // Mock Saving
    const stored = localStorage.getItem('mock_clientes');
    let clientes = stored ? JSON.parse(stored) : [];
    let updatedCliente = null;
    clientes = clientes.map(c => {
      if (c.id === id) {
        updatedCliente = { ...c, ...updates };
        return updatedCliente;
      }
      return c;
    });
    localStorage.setItem('mock_clientes', JSON.stringify(clientes));
    return { success: true, data: updatedCliente };
  },

  deleteCliente: async (id) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { error } = await supabase
          .from('gst_clientes')
          .delete()
          .eq('id', id)
          .eq('business_id', businessId);
        if (error) throw error;
        return { success: true };
      } catch (err) {
        console.warn("Supabase deleteCliente failed, falling back to mock:", err);
        return { success: false, error: err.message || 'No se pudo eliminar el cliente.' };
      }
    }

    const stored = localStorage.getItem('mock_clientes');
    const clientes = stored ? JSON.parse(stored) : [];
    if (!clientes.some((c) => c.id === id)) {
      return { success: false, error: 'Cliente no encontrado' };
    }

    localStorage.setItem('mock_clientes', JSON.stringify(clientes.filter((c) => c.id !== id)));

    const storedDirs = localStorage.getItem('mock_direcciones');
    if (storedDirs) {
      const direcciones = JSON.parse(storedDirs).filter((d) => d.cliente_id !== id);
      localStorage.setItem('mock_direcciones', JSON.stringify(direcciones));
    }

    const storedMovs = localStorage.getItem('mock_movimientos');
    if (storedMovs) {
      const movements = JSON.parse(storedMovs).filter((m) => m.cliente_id !== id);
      localStorage.setItem('mock_movimientos', JSON.stringify(movements));
    }

    const storedPedidos = localStorage.getItem('mock_pedidos');
    if (storedPedidos) {
      const pedidos = JSON.parse(storedPedidos).map((p) =>
        p.cliente_id === id ? { ...p, cliente_id: null } : p
      );
      localStorage.setItem('mock_pedidos', JSON.stringify(pedidos));
    }

    return { success: true };
  },

  getDirecciones: async (clienteId) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_cliente_direcciones')
          .select('*')
          .eq('cliente_id', clienteId)
          .eq('business_id', businessId);
        if (!error) return data;
        console.warn("Supabase getDirecciones failed, falling back to mock:", error);
      } catch (err) {
        console.warn("Supabase getDirecciones error, falling back to mock:", err);
      }
    }

    // Mock Fallback
    const stored = localStorage.getItem('mock_direcciones');
    let direcciones = [];
    if (stored) {
      direcciones = JSON.parse(stored);
    } else {
      // Seed mock directions
      direcciones = [
        { id: "d1", cliente_id: "c1", direccion: "Av. Cabildo 2450, CABA" },
        { id: "d2", cliente_id: "c1", direccion: "Calle Florida 150, CABA" },
        { id: "d3", cliente_id: "c3", direccion: "Av. Santa Fe 3200, CABA" }
      ];
      localStorage.setItem('mock_direcciones', JSON.stringify(direcciones));
    }
    return direcciones.filter(d => d.cliente_id === clienteId);
  },

  saveDireccion: async (clienteId, direccionText) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_cliente_direcciones')
          .insert([{
            business_id: businessId,
            cliente_id: clienteId,
            direccion: direccionText
          }])
          .select()
          .single();
        if (!error) return { success: true, data };
        console.warn("Supabase saveDireccion failed, falling back to mock:", error);
      } catch (err) {
        console.warn("Supabase saveDireccion error, falling back to mock:", err);
      }
    }

    // Mock Saving
    const stored = localStorage.getItem('mock_direcciones');
    const direcciones = stored ? JSON.parse(stored) : [];
    const newDir = {
      id: "d_" + Date.now(),
      cliente_id: clienteId,
      direccion: direccionText
    };
    direcciones.push(newDir);
    localStorage.setItem('mock_direcciones', JSON.stringify(direcciones));
    return { success: true, data: newDir };
  },

  getMovimientos: async (clienteId) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_cliente_movimientos')
          .select('*')
          .eq('cliente_id', clienteId)
          .eq('business_id', businessId)
          .order('fecha', { ascending: false });
        if (!error) return data;
        console.warn("Supabase getMovimientos failed, falling back to mock:", error);
      } catch (err) {
        console.warn("Supabase getMovimientos error, falling back to mock:", err);
      }
    }

    // Mock Fallback
    const stored = localStorage.getItem('mock_movimientos');
    let movimientos = [];
    if (stored) {
      movimientos = JSON.parse(stored);
    } else {
      movimientos = [
        { id: "m1", cliente_id: "c1", fecha: new Date(Date.now() - 86400000).toISOString(), concepto: "Pedido inicial cargado", debe: 15400.00, haber: 0.00 },
        { id: "m2", cliente_id: "c3", fecha: new Date(Date.now() - 172800000).toISOString(), concepto: "Pedido Gourmet #998", debe: 24500.00, haber: 0.00 }
      ];
      localStorage.setItem('mock_movimientos', JSON.stringify(movimientos));
    }
    return movimientos
      .filter(m => m.cliente_id === clienteId)
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  },

  saveMovement: async (movement) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_cliente_movimientos')
          .insert([{
            business_id: businessId,
            cliente_id: movement.cliente_id,
            concepto: movement.concepto,
            debe: parseFloat(movement.debe || 0),
            haber: parseFloat(movement.haber || 0),
            fecha: movement.fecha || new Date().toISOString()
          }])
          .select()
          .single();
        if (!error) return { success: true, data };
        console.warn("Supabase saveMovement failed, falling back to mock:", error);
      } catch (err) {
        console.warn("Supabase saveMovement error, falling back to mock:", err);
      }
    }

    const stored = localStorage.getItem('mock_movimientos');
    const movements = stored ? JSON.parse(stored) : [];
    const newMov = {
      id: "m_manual_" + Date.now(),
      cliente_id: movement.cliente_id,
      fecha: movement.fecha || new Date().toISOString(),
      concepto: movement.concepto,
      debe: parseFloat(movement.debe || 0),
      haber: parseFloat(movement.haber || 0)
    };
    movements.push(newMov);
    localStorage.setItem('mock_movimientos', JSON.stringify(movements));
    return { success: true, data: newMov };
  },

  registerClientPayment: async ({ cliente_id, monto, medio_pago, observacion = '', order_ids = null }) => {
    const pendingRows = await db.getClientOrdersCCPending(cliente_id, []);
    const resolvedOrderIds = Array.isArray(order_ids)
      ? order_ids
      : pendingRows.map((row) => row.orderId);

    return db.registerClientPaymentWithOrders({
      cliente_id,
      monto,
      medio_pago,
      order_ids: resolvedOrderIds,
      observacion,
    });
  },

  getClientOrdersCCPending: async (clienteId, orderIds = []) => {
    if (!clienteId) return [];
    const businessId = await ensureBusinessContext();
    const idSet = new Set(orderIds);

    let orders = [];
    let movements = [];

    if (isSupabaseConfigured() && supabase) {
      const { data: orderRows, error: ordersErr } = await supabase
        .from('gst_pedidos')
        .select('*')
        .eq('business_id', businessId)
        .eq('cliente_id', clienteId);
      if (ordersErr) throw ordersErr;
      orders = orderRows || [];

      const { data: movRows, error: movsErr } = await supabase
        .from('gst_cliente_movimientos')
        .select('*')
        .eq('business_id', businessId)
        .eq('cliente_id', clienteId);
      if (movsErr) throw movsErr;
      movements = movRows || [];
    } else {
      const storedOrders = localStorage.getItem('mock_pedidos');
      const storedMovs = localStorage.getItem('mock_movimientos');
      orders = storedOrders ? JSON.parse(storedOrders) : [];
      movements = storedMovs ? JSON.parse(storedMovs) : [];
      orders = orders.filter((order) => order.cliente_id === clienteId);
      movements = movements.filter((mov) => mov.cliente_id === clienteId);
    }

    const orderIdsFilter = idSet.size > 0 ? [...idSet] : null;
    return buildClientOrderPendingRows({ orders, movements, orderIdsFilter })
      .filter((row) => row.pending > 0)
      .map(({ order, ...row }) => row);
  },

  registerClientPaymentWithOrders: async ({
    cliente_id,
    monto,
    medio_pago,
    order_ids = [],
    observacion = '',
  }) => {
    const amount = roundMoney(monto);
    if (!cliente_id || !Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: 'Monto inválido.' };
    }
    if (!Array.isArray(order_ids)) {
      order_ids = [];
    }

    const medio = String(medio_pago || '').trim();
    if (!medio || isMedioCtaCte(medio)) {
      return { success: false, error: 'Seleccioná un medio de pago válido (sin Cta Cte).' };
    }

    const businessId = await ensureBusinessContext();
    const note = String(observacion || '').trim();
    const clientes = await db.getClientes();
    const client = clientes.find((c) => c.id === cliente_id);
    if (!client) {
      return { success: false, error: 'Cliente no encontrado.' };
    }

    if (order_ids.length === 0) {
      const resDep = await db.saveMovement({
        cliente_id,
        concepto: movementConcept.deposito(medio, note),
        debe: 0,
        haber: amount,
      });
      if (!resDep.success) {
        return { success: false, error: 'No se pudo registrar el depósito a cuenta.' };
      }
      const newSaldo = roundMoney(parseFloat(client.saldo || 0) - amount);
      await db.updateClienteSaldo(cliente_id, newSaldo);
      return {
        success: true,
        data: {
          saldo: newSaldo,
          appliedToOrders: 0,
          depositAmount: amount,
          allocations: [],
        },
      };
    }

    let orders = [];
    let allClientOrders = [];
    let movements = [];

    if (isSupabaseConfigured() && supabase) {
      const { data: orderRows, error: ordersErr } = await supabase
        .from('gst_pedidos')
        .select('*')
        .eq('business_id', businessId)
        .in('id', order_ids);
      if (ordersErr) throw ordersErr;
      orders = orderRows || [];

      const { data: allOrderRows, error: allOrdersErr } = await supabase
        .from('gst_pedidos')
        .select('*')
        .eq('business_id', businessId)
        .eq('cliente_id', cliente_id);
      if (allOrdersErr) throw allOrdersErr;
      allClientOrders = allOrderRows || [];

      const { data: movRows, error: movsErr } = await supabase
        .from('gst_cliente_movimientos')
        .select('*')
        .eq('business_id', businessId)
        .eq('cliente_id', cliente_id);
      if (movsErr) throw movsErr;
      movements = movRows || [];
    } else {
      const storedOrders = localStorage.getItem('mock_pedidos');
      const storedMovs = localStorage.getItem('mock_movimientos');
      const parsedOrders = storedOrders ? JSON.parse(storedOrders) : [];
      movements = storedMovs ? JSON.parse(storedMovs) : [];
      allClientOrders = parsedOrders.filter((order) => order.cliente_id === cliente_id);
      orders = allClientOrders.filter((order) => order_ids.includes(order.id));
      movements = movements.filter((mov) => mov.cliente_id === cliente_id);
    }

    if (orders.length !== order_ids.length) {
      return { success: false, error: 'No se encontraron todos los pedidos seleccionados.' };
    }
    if (orders.some((order) => order.cliente_id !== cliente_id)) {
      return { success: false, error: 'Todos los pedidos deben ser del mismo cliente.' };
    }
    if (orders.some((order) => !isFinalizadoEstadoValue(order.estado) || isCancelledEstadoValue(order.estado))) {
      return { success: false, error: 'Solo se pueden imputar pagos a pedidos finalizados.' };
    }

    const { orderAllocations, depositAmount, totalPendingSelected } = buildClientPaymentAllocations({
      orders,
      movements,
      amount,
      orderIds: order_ids,
      allClientOrders,
    });

    if (orderAllocations.length === 0 && totalPendingSelected <= 0 && depositAmount <= 0) {
      return { success: false, error: 'Los pedidos seleccionados no tienen deuda pendiente en cuenta corriente.' };
    }

    const appliedToOrders = roundMoney(
      orderAllocations.reduce((sum, row) => sum + row.amount, 0)
    );
    if (appliedToOrders <= 0 && depositAmount <= 0) {
      return { success: false, error: 'No se pudo imputar el pago.' };
    }

    const insertedMovements = [];
    const fecha = new Date().toISOString();

    const insertMovementRecord = async (mov) => {
      if (isSupabaseConfigured() && supabase) {
        const { data, error } = await supabase
          .from('gst_cliente_movimientos')
          .insert([{
            business_id: businessId,
            cliente_id,
            concepto: mov.concepto,
            debe: mov.debe,
            haber: mov.haber,
            fecha: mov.fecha || fecha,
          }])
          .select()
          .single();
        if (error) throw error;
        insertedMovements.push(data);
        movements.push(data);
        return;
      }

      const newMov = {
        id: `m_ccpay_${Date.now()}_${Math.random()}`,
        cliente_id,
        fecha: mov.fecha || fecha,
        concepto: mov.concepto,
        debe: mov.debe,
        haber: mov.haber,
      };
      movements.push(newMov);
      insertedMovements.push(newMov);
    };

    for (const allocation of orderAllocations) {
      const { order, orderRef, amount: allocAmount } = allocation;
      const relatedMovements = getOrderRelatedMovements(movements, orderRef);
      const missing = buildMissingFinalizeMovements(order, relatedMovements);
      for (const mov of missing) {
        await insertMovementRecord(mov);
      }

      await insertMovementRecord({
        concepto: movementConcept.cobro(orderRef, medio),
        debe: 0,
        haber: allocAmount,
        fecha,
      });
    }

    if (depositAmount > 0) {
      await insertMovementRecord({
        concepto: movementConcept.deposito(medio, note),
        debe: 0,
        haber: depositAmount,
        fecha,
      });
    }

    if (!isSupabaseConfigured() || !supabase) {
      localStorage.setItem('mock_movimientos', JSON.stringify(movements));
    }

    const newSaldo = roundMoney(parseFloat(client.saldo || 0) - amount);
    await db.updateClienteSaldo(cliente_id, newSaldo);

    return {
      success: true,
      data: {
        saldo: newSaldo,
        appliedToOrders,
        depositAmount,
        allocations: orderAllocations.map((row) => ({
          orderId: row.order.id,
          orderRef: row.orderRef,
          amount: row.amount,
        })),
        movements: insertedMovements,
      },
    };
  },

  updateClienteSaldo: async (clienteId, newSaldo) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_clientes')
          .update({ saldo: newSaldo })
          .eq('id', clienteId)
          .eq('business_id', businessId)
          .select()
          .single();
        if (!error) return { success: true, data };
        console.warn("Supabase updateClienteSaldo failed, falling back to mock:", error);
      } catch (err) {
        console.warn("Supabase updateClienteSaldo error, falling back to mock:", err);
      }
    }

    const stored = localStorage.getItem('mock_clientes');
    let clientes = stored ? JSON.parse(stored) : [];
    clientes = clientes.map(c => {
      if (c.id === clienteId) {
        return { ...c, saldo: parseFloat(newSaldo) };
      }
      return c;
    });
    localStorage.setItem('mock_clientes', JSON.stringify(clientes));
    return { success: true };
  },

  getDailyRefunds: async (startDate, endDate) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_cliente_movimientos')
          .select('*')
          .eq('business_id', businessId)
          .gte('fecha', startDate)
          .lte('fecha', endDate)
          .like('concepto', 'Devolución de pago%');
        if (!error) return data;
        console.warn("Supabase getDailyRefunds failed, falling back to mock:", error);
      } catch (err) {
        console.warn("Supabase getDailyRefunds error, falling back to mock:", err);
      }
    }

    const stored = localStorage.getItem('mock_movimientos');
    const movements = stored ? JSON.parse(stored) : [];
    return movements.filter(m => {
      const withinDate = m.fecha >= startDate && m.fecha <= endDate;
      const isRefund = isRefundConcept(m.concepto);
      return withinDate && isRefund;
    });
  },

  getDailyClientPayments: async (startDate, endDate) => {
    const businessId = getBusinessId();

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_cliente_movimientos')
          .select('*')
          .eq('business_id', businessId)
          .gte('fecha', startDate)
          .lte('fecha', endDate)
          .or('concepto.like.Pago cuenta corriente%,concepto.like.Depósito cuenta corriente%,concepto.like.%Cobro Pedido #%');
        if (!error) {
          return (data || []).filter((m) => isCCCashInflowConcept(m.concepto));
        }
        console.warn('Supabase getDailyClientPayments failed, falling back to mock:', error);
      } catch (err) {
        console.warn('Supabase getDailyClientPayments error, falling back to mock:', err);
      }
    }

    const stored = localStorage.getItem('mock_movimientos');
    const movements = stored ? JSON.parse(stored) : [];
    return movements.filter((m) => {
      const withinDate = m.fecha >= startDate && m.fecha <= endDate;
      return withinDate && isCCCashInflowConcept(m.concepto);
    });
  },

  savePedido: async (pedido) => {
    const businessId = getBusinessId();
    const terminalId = getTerminalId();
    if (isSupabaseConfigured() && supabase) {
      try {
        // 1. Insert Order
        const { data: orderData, error: orderErr } = await supabase
          .from('gst_pedidos')
          .insert([{
            business_id: businessId,
            terminal_id: terminalId,
            cliente_id: pedido.cliente_id,
            total: pedido.total,
            con_envio: pedido.con_envio,
            direccion_envio: pedido.direccion_envio,
            turno_caja: pedido.turno_caja || null,
            estado: 'Pendiente'
          }])
          .select()
          .single();

        if (orderErr) throw new Error(orderErr.message);

        // 2. Insert Items (including iva_alicuota)
        const itemsToInsert = pedido.items.map(item => ({
          business_id: businessId,
          pedido_id: orderData.id,
          producto: item.producto,
          cantidad: item.cantidad,
          valor: item.valor,
          observacion: item.observacion,
          iva_alicuota: item.iva_alicuota !== undefined ? parseFloat(item.iva_alicuota) : 21.00
        }));
        const { error: itemsErr } = await supabase.from('gst_pedido_items').insert(itemsToInsert);
        if (itemsErr) throw new Error(itemsErr.message);

        // 2b. Decrement stock in Supabase table "gst_productos"
        for (const item of pedido.items) {
          const { data: prodData } = await supabase
            .from('gst_productos')
            .select('id, stock')
            .eq('nombre', item.producto)
            .eq('business_id', businessId)
            .maybeSingle();
          if (prodData) {
            const newStock = parseFloat(prodData.stock || 0) - parseFloat(item.cantidad);
            await supabase
              .from('gst_productos')
              .update({ stock: newStock })
              .eq('id', prodData.id)
              .eq('business_id', businessId);
          }
        }

        return { success: true };
      } catch (err) {
        console.warn("Supabase savePedido error, falling back to mock:", err);
      }
    }

    // Mock Saving
    const storedClientes = localStorage.getItem('mock_clientes');
    let clientes = storedClientes ? JSON.parse(storedClientes) : [];
    let clienteNombre = "Cliente";
    
    clientes.forEach(c => {
      if (c.id === pedido.cliente_id) {
        clienteNombre = c.nombre;
      }
    });

    // 2b. Decrement stock in Mock Products
    const storedProds = localStorage.getItem('mock_productos');
    if (storedProds) {
      let mockProds = JSON.parse(storedProds);
      mockProds = mockProds.map(p => {
        const orderItem = pedido.items.find(it => it.producto === p.nombre);
        if (orderItem) {
          return { ...p, stock: parseFloat(p.stock || 0) - parseFloat(orderItem.cantidad) };
        }
        return p;
      });
      localStorage.setItem('mock_productos', JSON.stringify(mockProds));
    }

    // 3. Save Order object in mock_pedidos
    const orderId = "o_" + Date.now();
    const storedOrders = localStorage.getItem('mock_pedidos');
    const orders = storedOrders ? JSON.parse(storedOrders) : [];
    const newOrder = {
      id: orderId,
      cliente_id: pedido.cliente_id,
      cliente_nombre: clienteNombre,
      fecha: new Date().toISOString(),
      total: parseFloat(pedido.total),
      con_envio: pedido.con_envio,
      direccion_envio: pedido.direccion_envio,
      estado: 'Pendiente',
      repartidor: null,
      medio_pago: null,
      turno_caja: pedido.turno_caja || null,
      caja_cierre: null,
      items: pedido.items
    };
    orders.unshift(newOrder);
    localStorage.setItem('mock_pedidos', JSON.stringify(orders));

    return { success: true };
  },

  syncOrderTotalFinancials: async (order, oldTotal, newTotal) => {
    if (!order?.cliente_id || !hasPaymentMedio(order.medio_pago)) return;
    if (isMedioPagadoEnCaja(order.medio_pago) || isMedioCtaCte(order.medio_pago)) return;

    const businessId = getBusinessId();
    const orderRef = getOrderMovementRef(order.id);
    const parsedOld = roundCcMoney(oldTotal);
    const parsedNew = roundCcMoney(newTotal);
    if (parsedOld === parsedNew) return;

    if (isSupabaseConfigured() && supabase) {
      const { data: clientMovements } = await supabase
        .from('gst_cliente_movimientos')
        .select('id, concepto, debe, haber, fecha')
        .eq('business_id', businessId)
        .eq('cliente_id', order.cliente_id);

      const relatedMovements = getOrderRelatedMovements(clientMovements, orderRef);

      const adjustClientSaldo = async (delta) => {
        const { data: client } = await supabase
          .from('gst_clientes')
          .select('saldo')
          .eq('id', order.cliente_id)
          .eq('business_id', businessId)
          .maybeSingle();
        if (!client) return;
        const newSaldo = parseFloat(client.saldo || 0) + parseFloat(delta);
        await supabase
          .from('gst_clientes')
          .update({ saldo: newSaldo })
          .eq('id', order.cliente_id)
          .eq('business_id', businessId);
      };

      const updateMovementAmount = async (movementId, { haber }) => {
        await supabase
          .from('gst_cliente_movimientos')
          .update({ haber })
          .eq('id', movementId)
          .eq('business_id', businessId);
      };

      await syncOrderPaymentOnTotalChange({
        orderRef,
        oldTotal: parsedOld,
        newTotal: parsedNew,
        relatedMovements,
        updateMovementAmount,
        adjustClientSaldo,
      });
      return;
    }

    const storedMovs = localStorage.getItem('mock_movimientos');
    const storedClientes = localStorage.getItem('mock_clientes');
    let movements = storedMovs ? JSON.parse(storedMovs) : [];
    let clientes = storedClientes ? JSON.parse(storedClientes) : [];
    const relatedMovements = getOrderRelatedMovements(
      movements.filter((m) => m.cliente_id === order.cliente_id),
      orderRef
    );

    const adjustClientSaldo = async (delta) => {
      clientes = clientes.map((c) => (
        c.id === order.cliente_id
          ? { ...c, saldo: parseFloat(c.saldo || 0) + parseFloat(delta) }
          : c
      ));
    };

    const updateMovementAmount = async (movementId, { haber }) => {
      movements = movements.map((m) => (
        m.id === movementId ? { ...m, haber } : m
      ));
    };

    await syncOrderPaymentOnTotalChange({
      orderRef,
      oldTotal: parsedOld,
      newTotal: parsedNew,
      relatedMovements,
      updateMovementAmount,
      adjustClientSaldo,
    });

    localStorage.setItem('mock_movimientos', JSON.stringify(movements));
    localStorage.setItem('mock_clientes', JSON.stringify(clientes));
  },

  updatePedido: async (pedidoId, { items, total, cliente_id }) => {
    const businessId = getBusinessId();
    const parsedTotal = parseFloat(total);
    const normalizedItems = (items || []).map((item) => ({
      producto: item.producto,
      cantidad: parseFloat(item.cantidad),
      valor: parseFloat(item.valor),
      observacion: item.observacion || null,
      iva_alicuota: item.iva_alicuota !== undefined ? parseFloat(item.iva_alicuota) : 21.00,
    }));

    if (!normalizedItems.length) {
      return { success: false, error: 'El pedido debe tener al menos un ítem.' };
    }

    const adjustProductStock = async (productName, delta) => {
      if (!isSupabaseConfigured() || !supabase) return;
      const { data: prodData } = await supabase
        .from('gst_productos')
        .select('id, stock')
        .eq('nombre', productName)
        .eq('business_id', businessId)
        .maybeSingle();
      if (prodData) {
        const newStock = parseFloat(prodData.stock || 0) + parseFloat(delta);
        await supabase
          .from('gst_productos')
          .update({ stock: newStock })
          .eq('id', prodData.id)
          .eq('business_id', businessId);
      }
    };

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: order, error: orderErr } = await supabase
          .from('gst_pedidos')
          .select('*, gst_pedido_items(*)')
          .eq('id', pedidoId)
          .eq('business_id', businessId)
          .single();

        if (orderErr || !order) throw new Error(orderErr?.message || 'Pedido no encontrado.');
        if ((order.estado || '').toLowerCase() !== 'pendiente') {
          throw new Error('Solo se pueden editar pedidos en estado Pendiente.');
        }

        const oldTotal = parseFloat(order.total || 0);
        const oldItems = order.gst_pedido_items || [];
        const { error: updateErr } = await supabase
          .from('gst_pedidos')
          .update({ total: parsedTotal })
          .eq('id', pedidoId)
          .eq('business_id', businessId);
        if (updateErr) throw new Error(updateErr.message);

        const { error: deleteErr } = await supabase
          .from('gst_pedido_items')
          .delete()
          .eq('pedido_id', pedidoId)
          .eq('business_id', businessId);
        if (deleteErr) throw new Error(deleteErr.message);

        const itemsToInsert = normalizedItems.map((item) => ({
          business_id: businessId,
          pedido_id: pedidoId,
          producto: item.producto,
          cantidad: item.cantidad,
          valor: item.valor,
          observacion: item.observacion,
          iva_alicuota: item.iva_alicuota,
        }));
        const { error: itemsErr } = await supabase.from('gst_pedido_items').insert(itemsToInsert);
        if (itemsErr) throw new Error(itemsErr.message);

        for (const item of oldItems) {
          await adjustProductStock(item.producto, parseFloat(item.cantidad));
        }
        for (const item of normalizedItems) {
          await adjustProductStock(item.producto, -parseFloat(item.cantidad));
        }

        await db.syncOrderTotalFinancials(order, oldTotal, parsedTotal);

        return { success: true };
      } catch (err) {
        console.warn('Supabase updatePedido error, falling back to mock:', err);
        return { success: false, error: err.message || 'No se pudo actualizar el pedido.' };
      }
    }

    const storedOrders = localStorage.getItem('mock_pedidos');
    const storedClientes = localStorage.getItem('mock_clientes');
    const storedMovs = localStorage.getItem('mock_movimientos');
    const storedProds = localStorage.getItem('mock_productos');

    let orders = storedOrders ? JSON.parse(storedOrders) : [];
    let clientes = storedClientes ? JSON.parse(storedClientes) : [];
    let movements = storedMovs ? JSON.parse(storedMovs) : [];
    let mockProds = storedProds ? JSON.parse(storedProds) : [];

    const orderIndex = orders.findIndex((o) => o.id === pedidoId);
    if (orderIndex < 0) return { success: false, error: 'Pedido no encontrado.' };

    const order = orders[orderIndex];
    if ((order.estado || '').toLowerCase() !== 'pendiente') {
      return { success: false, error: 'Solo se pueden editar pedidos en estado Pendiente.' };
    }

    const oldItems = order.items || [];
    const oldTotal = parseFloat(order.total || 0);

    mockProds = mockProds.map((p) => {
      const oldItem = oldItems.find((it) => it.producto === p.nombre);
      const newItem = normalizedItems.find((it) => it.producto === p.nombre);
      let stock = parseFloat(p.stock || 0);
      if (oldItem) stock += parseFloat(oldItem.cantidad);
      if (newItem) stock -= parseFloat(newItem.cantidad);
      return { ...p, stock };
    });
    localStorage.setItem('mock_productos', JSON.stringify(mockProds));

    orders[orderIndex] = {
      ...order,
      total: parsedTotal,
      items: normalizedItems,
    };
    localStorage.setItem('mock_pedidos', JSON.stringify(orders));

    await db.syncOrderTotalFinancials(order, oldTotal, parsedTotal);

    return { success: true };
  },

  getPedidos: async () => {
    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase) {
      let isAuthenticated = false;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        isAuthenticated = !!session?.user;

        const { data, error } = await supabase
          .from('gst_pedidos')
          .select('*, gst_clientes(nombre), gst_pedido_items(*)')
          .eq('business_id', businessId)
          .order('fecha', { ascending: false });

        if (error) {
          console.error('[Gestion360i] getPedidos error:', error.message, { businessId, isAuthenticated });
          if (isAuthenticated) return [];
        } else if (data) {
          const formatted = data.map(p => ({
            ...p,
            cliente_nombre: p.gst_clientes ? p.gst_clientes.nombre : 'Cliente',
            items: p.gst_pedido_items || []
          }));

          return formatted.sort((a, b) => {
            if (a.con_envio === b.con_envio) {
              return new Date(b.fecha) - new Date(a.fecha);
            }
            return a.con_envio ? -1 : 1;
          });
        }

        if (isAuthenticated) return [];
      } catch (err) {
        console.error('[Gestion360i] getPedidos exception:', err);
        if (isAuthenticated) return [];
        console.warn('Supabase getPedidos error, falling back to mock:', err);
      }
    }

    // Mock Fallback
    const stored = localStorage.getItem('mock_pedidos');
    let orders = [];
    if (stored) {
      orders = JSON.parse(stored);
    } else {
      // Seed initial mock orders
      orders = [
        { 
          id: "o_seed1", 
          cliente_id: "c1", 
          cliente_nombre: "Distribuidora Dietética S.A.", 
          total: 15400.00, 
          con_envio: true, 
          direccion_envio: "Av. Cabildo 2450, CABA", 
          estado: 'Pendiente', 
          repartidor: null, 
          medio_pago: null, 
          fecha: new Date(Date.now() - 3600000).toISOString(),
          items: [
            { producto: "Yerba Mate Orgánica (1kg)", cantidad: 2, valor: 4500 },
            { producto: "Miel de Abeja Pura (500g)", cantidad: 2, valor: 3200 }
          ]
        },
        { 
          id: "o_seed2", 
          cliente_id: "c3", 
          cliente_nombre: "Rincón Gourmet", 
          total: 24500.00, 
          con_envio: false, 
          direccion_envio: null, 
          estado: 'Pendiente', 
          repartidor: null, 
          medio_pago: null, 
          fecha: new Date(Date.now() - 7200000).toISOString(),
          items: [
            { producto: "Aceite de Coco Neutro (360ml)", cantidad: 3, valor: 5800 },
            { producto: "Mix Frutos Secos Premium (250g)", cantidad: 2, valor: 2900 },
            { producto: "Granola Multisemillas (500g)", cantidad: 1, valor: 3500 }
          ]
        }
      ];
      localStorage.setItem('mock_pedidos', JSON.stringify(orders));
    }

    // Sort: con_envio=true first, then by date descending
    return orders.sort((a, b) => {
      if (a.con_envio === b.con_envio) {
        return new Date(b.fecha) - new Date(a.fecha);
      }
      return a.con_envio ? -1 : 1;
    });
  },

  getPendingPedidosForCierre: async (fechaLocal, turnoName, pedidoTipo = null) => {
    const businessId = getBusinessId();
    const turno = String(turnoName || '').trim();
    if (!fechaLocal || !turno) return [];

    const { startIso, endIso } = getArgentinaDayBounds(fechaLocal);

    const mapPedidoRow = (p) => ({
      ...p,
      cliente_nombre: p.gst_clientes?.nombre || p.cliente_nombre || 'Cliente',
    });

    const matchesCierreTurno = (p) => orderMatchesCajaTurno(p, turno, pedidoTipo);

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_pedidos')
          .select('*, gst_clientes(nombre)')
          .eq('business_id', businessId)
          .is('caja_cierre', null)
          .gte('fecha', startIso)
          .lt('fecha', endIso)
          .order('fecha', { ascending: true });

        if (error) throw error;

        return (data || [])
          .filter((p) => isFinalizedPedidoEstado(p.estado))
          .filter((p) => isOrderWithinBounds(p, startIso, endIso))
          .filter(matchesCierreTurno)
          .map(mapPedidoRow);
      } catch (err) {
        console.warn('getPendingPedidosForCierre failed:', err);
      }
    }

    const stored = localStorage.getItem('mock_pedidos');
    const orders = stored ? JSON.parse(stored) : [];

    return orders
      .filter((p) => !p.caja_cierre)
      .filter((p) => isFinalizedPedidoEstado(p.estado))
      .filter((p) => isOrderWithinBounds(p, startIso, endIso))
      .filter(matchesCierreTurno);
  },

  aggregatePedidosForCierre: (pedidos, cierreConceptos) =>
    aggregatePedidosMediosForCierre(pedidos, cierreConceptos),

  updatePedidosStatus: async (ids, updates) => {
    const businessId = await ensureBusinessContext();
    // updates: { estado, repartidor, medio_pago, con_envio }
    if (isSupabaseConfigured() && supabase) {
      const updateErrors = [];

      for (const id of ids) {
        const { data: order, error: orderErr } = await supabase
          .from('gst_pedidos')
          .select('*')
          .eq('id', id)
          .eq('business_id', businessId)
          .single();

        if (orderErr || !order) {
          updateErrors.push(orderErr?.message || `Pedido ${id} no encontrado.`);
          continue;
        }

        const effectiveUpdates = resolveLegacyShippingEstadoUpdate(order, updates);

        const prevEstado = (order.estado || '').toLowerCase();
        const nextEstado = (effectiveUpdates.estado !== undefined ? effectiveUpdates.estado : order.estado || '').toLowerCase();
        const prevFinalized = isFinalizadoEstadoValue(prevEstado);
        const nextFinalized = isFinalizadoEstadoValue(nextEstado);

        if (nextFinalized && !prevFinalized) {
          const nextMedio = effectiveUpdates.medio_pago !== undefined
            ? effectiveUpdates.medio_pago
            : order.medio_pago;
          if (!nextMedio || String(nextMedio).trim() === '') {
            updateErrors.push(
              `Pedido ${order.cliente_nombre || String(id).substring(0, 8)}: asigná un medio de pago antes de finalizar.`
            );
            continue;
          }
        }

        if (nextEstado === 'cancelado' && prevEstado !== 'cancelado') {
          try {
            const { data: items } = await supabase
              .from('gst_pedido_items')
              .select('producto, cantidad')
              .eq('pedido_id', id)
              .eq('business_id', businessId);
            await db.restoreOrderStock(items || []);
          } catch (stockErr) {
            console.warn('restoreOrderStock failed, continuing with status update:', stockErr);
          }
        }

        const fieldsToUpdate = {};
        if (effectiveUpdates.estado !== undefined) fieldsToUpdate.estado = effectiveUpdates.estado;
        if (effectiveUpdates.repartidor !== undefined) fieldsToUpdate.repartidor = effectiveUpdates.repartidor;
        if (effectiveUpdates.medio_pago !== undefined) fieldsToUpdate.medio_pago = effectiveUpdates.medio_pago;
        if (effectiveUpdates.turno_caja !== undefined) fieldsToUpdate.turno_caja = effectiveUpdates.turno_caja;
        if (effectiveUpdates.motivo_cancelacion !== undefined) fieldsToUpdate.motivo_cancelacion = effectiveUpdates.motivo_cancelacion;
        if (effectiveUpdates.con_envio !== undefined) {
          if (effectiveUpdates.con_envio === true) {
            const deliveryAddress = String(
              effectiveUpdates.direccion_envio ?? order.direccion_envio ?? ''
            ).trim();
            if (!deliveryAddress) {
              updateErrors.push(
                `Pedido ${order.cliente_nombre || String(id).substring(0, 8)}: indicá la dirección de envío.`
              );
              continue;
            }
            fieldsToUpdate.con_envio = true;
            fieldsToUpdate.direccion_envio = deliveryAddress;
          } else {
            fieldsToUpdate.con_envio = false;
            fieldsToUpdate.direccion_envio = null;
            fieldsToUpdate.repartidor = null;
          }
        } else if (effectiveUpdates.direccion_envio !== undefined) {
          fieldsToUpdate.direccion_envio = effectiveUpdates.direccion_envio;
        }
        if (effectiveUpdates.cae !== undefined) fieldsToUpdate.cae = effectiveUpdates.cae;
        if (effectiveUpdates.cae_vencimiento !== undefined) fieldsToUpdate.cae_vencimiento = effectiveUpdates.cae_vencimiento;
        if (effectiveUpdates.factura_nro !== undefined) fieldsToUpdate.factura_nro = effectiveUpdates.factura_nro;
        if (effectiveUpdates.factura_fecha !== undefined) fieldsToUpdate.factura_fecha = effectiveUpdates.factura_fecha;
        if (effectiveUpdates.factura_tipo !== undefined) fieldsToUpdate.factura_tipo = effectiveUpdates.factura_tipo;
        if (effectiveUpdates.factura_error !== undefined) fieldsToUpdate.factura_error = effectiveUpdates.factura_error;

        let updateErr = null;
        if (Object.keys(fieldsToUpdate).length > 0) {
          ({ error: updateErr } = await supabase
            .from('gst_pedidos')
            .update(fieldsToUpdate)
            .eq('id', id)
            .eq('business_id', businessId));

          if (updateErr && fieldsToUpdate.motivo_cancelacion !== undefined) {
            const { motivo_cancelacion, ...withoutMotivo } = fieldsToUpdate;
            ({ error: updateErr } = await supabase
              .from('gst_pedidos')
              .update(withoutMotivo)
              .eq('id', id)
              .eq('business_id', businessId));
          }
        }

        if (updateErr) {
          updateErrors.push(`Pedido ${String(id).substring(0, 8)}: ${updateErr.message}`);
          continue;
        }

        try {
          const orderAfterUpdate = { ...order, ...fieldsToUpdate };
          await db.processFinancialTransactions(orderAfterUpdate, effectiveUpdates);
        } catch (finErr) {
          console.warn('processFinancialTransactions failed after pedido update:', finErr);
        }
      }

      if (updateErrors.length === ids.length) {
        return { success: false, error: updateErrors[0] || 'No se pudo actualizar ningún pedido.' };
      }

      return {
        success: true,
        warnings: updateErrors.length ? updateErrors : undefined,
      };
    }

    // Mock Mode status updates and financial logic
    const storedOrders = localStorage.getItem('mock_pedidos');
    const storedClientes = localStorage.getItem('mock_clientes');
    const storedMovs = localStorage.getItem('mock_movimientos');

    let orders = storedOrders ? JSON.parse(storedOrders) : [];
    let clientes = storedClientes ? JSON.parse(storedClientes) : [];
    let movements = storedMovs ? JSON.parse(storedMovs) : [];
    const cancelledOrderItemsList = [];

    const isFinalizeUpdate = String(updates.estado || '').toLowerCase() === 'finalizado';
    if (isFinalizeUpdate) {
      const blocking = orders.filter(
        (order) =>
          ids.includes(order.id)
          && !isFinalizadoEstadoValue(order.estado)
          && (!order.medio_pago || String(order.medio_pago).trim() === '')
      );
      if (blocking.length > 0) {
        return {
          success: false,
          error: 'No podés finalizar pedidos sin medio de pago asignado.',
        };
      }
    }

    if (updates.con_envio === true) {
      for (const id of ids) {
        const order = orders.find((o) => o.id === id);
        if (!order || order.con_envio) continue;
        const deliveryAddress = String(
          updates.direccion_envio ?? order.direccion_envio ?? ''
        ).trim();
        if (!deliveryAddress) {
          return {
            success: false,
            error: `Pedido ${order.cliente_nombre || String(id).substring(0, 8)}: indicá la dirección de envío.`,
          };
        }
      }
    }

    orders = orders.map(order => {
      if (ids.includes(order.id)) {
        const effectiveUpdates = resolveLegacyShippingEstadoUpdate(order, updates);
        const prevEstado = (order.estado || '').toLowerCase();
        const nextEstado = (effectiveUpdates.estado !== undefined ? effectiveUpdates.estado : order.estado || '').toLowerCase();

        const prevMedio = order.medio_pago || '';
        const nextMedio = effectiveUpdates.medio_pago !== undefined ? effectiveUpdates.medio_pago : prevMedio;
        const isNextCtaCte = isMedioCtaCte(nextMedio);
        const prevFinalized = isFinalizadoEstadoValue(prevEstado);
        const nextFinalized = isFinalizadoEstadoValue(nextEstado);
        const isFinalizeTransition = nextFinalized && !prevFinalized;

        const orderRef = getOrderMovementRef(order.id);
        const total = parseFloat(order.total);
        let relatedMovements = movements
          .filter((m) => m.cliente_id === order.cliente_id)
          .filter((m) => m.concepto && m.concepto.includes(`#${orderRef}`));
        let ccFlags = buildOrderCCFlags(relatedMovements, orderRef);

        const adjustMockSaldo = (delta) => {
          clientes = clientes.map(c => {
            if (c.id === order.cliente_id) {
              return { ...c, saldo: parseFloat(c.saldo || 0) + parseFloat(delta) };
            }
            return c;
          });
        };

        const pushMovement = (concepto, debe, haber) => {
          const newMov = {
            id: "m_" + Date.now() + Math.random(),
            cliente_id: order.cliente_id,
            fecha: new Date().toISOString(),
            concepto,
            debe,
            haber,
          };
          movements.push(newMov);
          relatedMovements = [...relatedMovements, newMov];
          ccFlags = buildOrderCCFlags(relatedMovements, orderRef);
        };

        const updateMovementConcept = (movementId, concepto) => {
          movements = movements.map((m) =>
            m.id === movementId ? { ...m, concepto } : m
          );
          relatedMovements = relatedMovements.map((m) =>
            m.id === movementId ? { ...m, concepto } : m
          );
          ccFlags = buildOrderCCFlags(relatedMovements, orderRef);
        };

        const deleteMovement = (movementId) => {
          movements = movements.filter((m) => m.id !== movementId);
          relatedMovements = relatedMovements.filter((m) => m.id !== movementId);
          ccFlags = buildOrderCCFlags(relatedMovements, orderRef);
        };

        const isPaymentUpdate = effectiveUpdates.medio_pago !== undefined;
        const skipFinancialForShipping = isShippingOnlyStatusUpdate(effectiveUpdates);

        if (!skipFinancialForShipping && nextEstado === 'cancelado' && prevEstado !== 'cancelado') {
          cancelledOrderItemsList.push(order.items || []);
          if (prevFinalized && ccFlags.hasPedido) {
            adjustMockSaldo(-total);
            pushMovement(movementConcept.cancelacion(orderRef, effectiveUpdates.motivo_cancelacion), 0, total);
          }
          const cobroMov = relatedMovements.find((m) => isCobroPedidoConcept(m.concepto, orderRef));
          if (cobroMov) {
            const medio = extractMedioFromPaymentConcept(cobroMov.concepto);
            updateMovementConcept(cobroMov.id, movementConcept.credito(orderRef, medio));
          }
        }

        const paymentMov = findOrderPaymentMovement(relatedMovements, orderRef);

        if (
          !skipFinancialForShipping
          && isPaymentUpdate
          && prevMedio !== nextMedio
          && paymentMov
        ) {
          if (isMedioCtaCte(nextMedio)) {
            if (isCreditoPedidoConcept(paymentMov.concepto, orderRef)) {
              adjustMockSaldo(total);
            } else if (
              isCobroPedidoConcept(paymentMov.concepto, orderRef)
              && !isCobroSaldoFavorImputation(paymentMov.concepto)
            ) {
              adjustMockSaldo(roundCcMoney(parseFloat(paymentMov.haber || total)));
            }
            deleteMovement(paymentMov.id);
          } else {
            const isCredit = isCreditoPedidoConcept(paymentMov.concepto, orderRef);
            const newConcept = (isCredit && !nextFinalized)
              ? movementConcept.credito(orderRef, nextMedio)
              : movementConcept.cobro(orderRef, nextMedio);
            updateMovementConcept(paymentMov.id, newConcept);
          }
        } else if (!skipFinancialForShipping && !isFinalizeTransition) {
          if (
            !nextFinalized
            && isPaymentUpdate
            && isPaidMedioForOrder(nextMedio)
            && !isMedioPagadoEnCaja(nextMedio)
            && !paymentMov
          ) {
            adjustMockSaldo(-total);
            pushMovement(movementConcept.credito(orderRef, nextMedio), 0, total);
          }
        }

        if (!skipFinancialForShipping && isFinalizeTransition) {
          const favorBeforeCompra = isNextCtaCte
            ? computeFavorBeforeOrderCompra(
              movements.filter((m) => m.cliente_id === order.cliente_id),
              orderRef
            )
            : 0;

          if (!ccFlags.hasPedido) {
            adjustMockSaldo(total);
            pushMovement(movementConcept.pedido(orderRef), total, 0);
          }

          const creditMov = relatedMovements.find((m) => isCreditoPedidoConcept(m.concepto, orderRef));
          if (creditMov) {
            if (isNextCtaCte) {
              adjustMockSaldo(total);
              deleteMovement(creditMov.id);
            } else {
              updateMovementConcept(creditMov.id, movementConcept.cobro(orderRef, nextMedio));
            }
          } else if (isNextCtaCte) {
            const alreadyCobrado = relatedMovements
              .filter((m) => isCobroPedidoConcept(m.concepto, orderRef))
              .reduce((sum, m) => sum + roundCcMoney(m.haber), 0);

            const cobroPlans = planSaldoFavorCobros({
              orderRef,
              orderTotal: total,
              favorAvailable: favorBeforeCompra,
              alreadyCobrado,
              isCtaCte: true,
            });
            for (const item of cobroPlans) {
              pushMovement(item.concepto, item.debe, item.haber);
            }
          } else if (
            isPaidMedioForOrder(nextMedio)
            && !isMedioPagadoEnCaja(nextMedio)
            && !ccFlags.hasCobro
          ) {
            adjustMockSaldo(-total);
            pushMovement(movementConcept.cobro(orderRef, nextMedio), 0, total);
          }
        }

        // Apply status fields updates
        const updatedOrder = { ...order };
        if (effectiveUpdates.estado !== undefined) updatedOrder.estado = effectiveUpdates.estado;
        if (effectiveUpdates.repartidor !== undefined) updatedOrder.repartidor = effectiveUpdates.repartidor;
        if (effectiveUpdates.medio_pago !== undefined) updatedOrder.medio_pago = effectiveUpdates.medio_pago;
        if (effectiveUpdates.turno_caja !== undefined) updatedOrder.turno_caja = effectiveUpdates.turno_caja;
        if (effectiveUpdates.motivo_cancelacion !== undefined) updatedOrder.motivo_cancelacion = effectiveUpdates.motivo_cancelacion;
        if (effectiveUpdates.con_envio !== undefined) {
          if (effectiveUpdates.con_envio === true) {
            const deliveryAddress = String(
              effectiveUpdates.direccion_envio ?? order.direccion_envio ?? ''
            ).trim();
            updatedOrder.con_envio = true;
            updatedOrder.direccion_envio = deliveryAddress;
          } else {
            updatedOrder.con_envio = false;
            updatedOrder.direccion_envio = null;
            updatedOrder.repartidor = null;
          }
        } else if (effectiveUpdates.direccion_envio !== undefined) {
          updatedOrder.direccion_envio = effectiveUpdates.direccion_envio;
        }
        if (effectiveUpdates.cae !== undefined) updatedOrder.cae = effectiveUpdates.cae;
        if (effectiveUpdates.cae_vencimiento !== undefined) updatedOrder.cae_vencimiento = effectiveUpdates.cae_vencimiento;
        if (effectiveUpdates.factura_nro !== undefined) updatedOrder.factura_nro = effectiveUpdates.factura_nro;
        if (effectiveUpdates.factura_fecha !== undefined) updatedOrder.factura_fecha = effectiveUpdates.factura_fecha;
        if (effectiveUpdates.factura_tipo !== undefined) updatedOrder.factura_tipo = effectiveUpdates.factura_tipo;
        if (effectiveUpdates.factura_error !== undefined) updatedOrder.factura_error = effectiveUpdates.factura_error;

        return updatedOrder;
      }
      return order;
    });

    for (const items of cancelledOrderItemsList) {
      await db.restoreOrderStock(items);
    }

    localStorage.setItem('mock_pedidos', JSON.stringify(orders));
    localStorage.setItem('mock_clientes', JSON.stringify(clientes));
    localStorage.setItem('mock_movimientos', JSON.stringify(movements));

    return { success: true };
  },

  restoreOrderStock: async (items) => {
    if (!items?.length) return;

    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase) {
      for (const item of items) {
        const { data: prodData } = await supabase
          .from('gst_productos')
          .select('id, stock')
          .eq('nombre', item.producto)
          .eq('business_id', businessId)
          .maybeSingle();
        if (prodData) {
          const newStock = parseFloat(prodData.stock || 0) + parseFloat(item.cantidad);
          await supabase
            .from('gst_productos')
            .update({ stock: newStock })
            .eq('id', prodData.id)
            .eq('business_id', businessId);
        }
      }
      return;
    }

    const storedProds = localStorage.getItem('mock_productos');
    if (!storedProds) return;
    let mockProds = JSON.parse(storedProds);
    mockProds = mockProds.map((p) => {
      const orderItem = items.find((it) => it.producto === p.nombre);
      if (orderItem) {
        return { ...p, stock: parseFloat(p.stock || 0) + parseFloat(orderItem.cantidad) };
      }
      return p;
    });
    localStorage.setItem('mock_productos', JSON.stringify(mockProds));
  },

  // Helper for Supabase financial sync
  processFinancialTransactions: async (order, updates) => {
    if (isShippingOnlyStatusUpdate(updates)) return;
    if (!isSupabaseConfigured() || !supabase) return;

    const businessId = await ensureBusinessContext();
    const prevEstado = (order.estado || '').toLowerCase();
    const nextEstado = (updates.estado !== undefined ? updates.estado : order.estado || '').toLowerCase();
    const total = parseFloat(order.total || 0);
    const orderRef = getOrderMovementRef(order.id);
    const isPaymentUpdate = updates.medio_pago !== undefined;
    const isFinalizeTransition = isFinalizadoEstadoValue(nextEstado) && !isFinalizadoEstadoValue(prevEstado);

    const prevMedio = order.medio_pago || '';
    const nextMedio = updates.medio_pago !== undefined ? updates.medio_pago : prevMedio;
    const isNextCtaCte = isMedioCtaCte(nextMedio);
    const prevFinalized = isFinalizadoEstadoValue(prevEstado);
    const nextFinalized = isFinalizadoEstadoValue(nextEstado);

    const { data: clientMovements } = await supabase
      .from('gst_cliente_movimientos')
      .select('id, concepto, debe, haber, fecha')
      .eq('business_id', businessId)
      .eq('cliente_id', order.cliente_id);

    let relatedMovements = (clientMovements || []).filter(
      (m) => m.concepto && m.concepto.includes(`#${orderRef}`)
    );
    let ccFlags = buildOrderCCFlags(relatedMovements, orderRef);

    const adjustClientSaldo = async (delta) => {
      const { data: client } = await supabase
        .from('gst_clientes')
        .select('saldo')
        .eq('id', order.cliente_id)
        .eq('business_id', businessId)
        .maybeSingle();
      if (!client) return;
      const newSaldo = parseFloat(client.saldo || 0) + parseFloat(delta);
      await supabase
        .from('gst_clientes')
        .update({ saldo: newSaldo })
        .eq('id', order.cliente_id)
        .eq('business_id', businessId);
    };

    const insertMovement = async (concepto, debe, haber) => {
      const { data } = await supabase.from('gst_cliente_movimientos').insert([{
        business_id: businessId,
        cliente_id: order.cliente_id,
        concepto,
        debe,
        haber,
      }]).select('id, concepto, debe, haber, fecha').single();
      if (data) {
        relatedMovements = [...relatedMovements, data];
        ccFlags = buildOrderCCFlags(relatedMovements, orderRef);
      }
    };

    const updateMovementConcept = async (movementId, concepto) => {
      await supabase
        .from('gst_cliente_movimientos')
        .update({ concepto })
        .eq('id', movementId)
        .eq('business_id', businessId);
      relatedMovements = relatedMovements.map((m) =>
        m.id === movementId ? { ...m, concepto } : m
      );
      if ((clientMovements || []).some((m) => m.id === movementId)) {
        for (let i = 0; i < (clientMovements || []).length; i += 1) {
          if (clientMovements[i].id === movementId) {
            clientMovements[i] = { ...clientMovements[i], concepto };
          }
        }
      }
      ccFlags = buildOrderCCFlags(relatedMovements, orderRef);
    };

    const deleteMovement = async (movementId) => {
      await supabase
        .from('gst_cliente_movimientos')
        .delete()
        .eq('id', movementId)
        .eq('business_id', businessId);
      relatedMovements = relatedMovements.filter((m) => m.id !== movementId);
      ccFlags = buildOrderCCFlags(relatedMovements, orderRef);
    };

    // A. Cancelación — anula Compra; Cobro → Crédito (Crédito se mantiene)
    if (nextEstado === 'cancelado' && prevEstado !== 'cancelado') {
      if (prevFinalized && ccFlags.hasPedido) {
        await adjustClientSaldo(-total);
        await insertMovement(movementConcept.cancelacion(orderRef, updates.motivo_cancelacion), 0, total);
      }
      const cobroMov = relatedMovements.find((m) => isCobroPedidoConcept(m.concepto, orderRef));
      if (cobroMov) {
        const medio = extractMedioFromPaymentConcept(cobroMov.concepto);
        await updateMovementConcept(cobroMov.id, movementConcept.credito(orderRef, medio));
      }
      return;
    }

    const paymentMov = findOrderPaymentMovement(relatedMovements, orderRef);

    // B. Cambio de medio — Cta Cte elimina cobro/crédito; otros medios solo actualizan concepto
    if (isPaymentUpdate && prevMedio !== nextMedio && paymentMov) {
      if (isMedioCtaCte(nextMedio)) {
        if (isCreditoPedidoConcept(paymentMov.concepto, orderRef)) {
          await adjustClientSaldo(total);
        } else if (
          isCobroPedidoConcept(paymentMov.concepto, orderRef)
          && !isCobroSaldoFavorImputation(paymentMov.concepto)
        ) {
          await adjustClientSaldo(roundCcMoney(parseFloat(paymentMov.haber || total)));
        }
        await deleteMovement(paymentMov.id);
        if (!isFinalizeTransition) return;
      } else {
        const isCredit = isCreditoPedidoConcept(paymentMov.concepto, orderRef);
        const newConcept = (isCredit && !nextFinalized)
          ? movementConcept.credito(orderRef, nextMedio)
          : movementConcept.cobro(orderRef, nextMedio);
        await updateMovementConcept(paymentMov.id, newConcept);
        if (!isFinalizeTransition) return;
      }
    }

    // C. Crédito — cobro antes de finalizar
    if (
      !nextFinalized
      && isPaymentUpdate
      && isPaidMedioForOrder(nextMedio)
      && !isMedioPagadoEnCaja(nextMedio)
      && !paymentMov
    ) {
      await adjustClientSaldo(-total);
      await insertMovement(movementConcept.credito(orderRef, nextMedio), 0, total);
    }

    // D. Finalizar — Compra; Cta Cte + saldo a favor; otros medios Crédito→Cobro / cobro directo
    if (isFinalizeTransition) {
      const favorBeforeCompra = isNextCtaCte
        ? computeFavorBeforeOrderCompra(clientMovements || [], orderRef)
        : 0;

      if (!ccFlags.hasPedido) {
        await adjustClientSaldo(total);
        await insertMovement(movementConcept.pedido(orderRef), total, 0);
      }

      const creditMov = relatedMovements.find((m) => isCreditoPedidoConcept(m.concepto, orderRef));
      if (creditMov) {
        if (isNextCtaCte) {
          await adjustClientSaldo(total);
          await deleteMovement(creditMov.id);
        } else {
          await updateMovementConcept(creditMov.id, movementConcept.cobro(orderRef, nextMedio));
        }
      } else if (isNextCtaCte) {
        const alreadyCobrado = relatedMovements
          .filter((m) => isCobroPedidoConcept(m.concepto, orderRef))
          .reduce((sum, m) => sum + roundCcMoney(m.haber), 0);

        const cobroPlans = planSaldoFavorCobros({
          orderRef,
          orderTotal: total,
          favorAvailable: favorBeforeCompra,
          alreadyCobrado,
          isCtaCte: true,
        });
        for (const item of cobroPlans) {
          await insertMovement(item.concepto, item.debe, item.haber);
        }
      } else if (
        isPaidMedioForOrder(nextMedio)
        && !isMedioPagadoEnCaja(nextMedio)
        && !ccFlags.hasCobro
      ) {
        await adjustClientSaldo(-total);
        await insertMovement(movementConcept.cobro(orderRef, nextMedio), 0, total);
      }
    }
  },
  // --- CIERRES DE CAJA ---
  getPendingCompras: async () => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_compras')
          .select('*')
          .eq('business_id', businessId)
          .is('caja_cierre', null)
          .order('created_at', { ascending: true });
        if (!error) return data;
      } catch (err) {
        console.warn("Supabase pending compras failed:", err);
      }
    }
    // Mock
    const stored = localStorage.getItem('mock_compras');
    if (!stored) {
      const initial = [
        { id: "g1", fecha: new Date().toISOString(), proveedor: "Distribuidora Sol", cuit: "20123456789", tipo: "Mercadería", detalle: "Repuestos e insumos", monto_neto: 10330.58, iva_10_5: 0, iva_21: 2169.42, total: 12500, pago: "Transferencia Bancaria", factura: "Entregada", caja_cierre: null },
        { id: "g2", fecha: new Date().toISOString(), proveedor: "Fiambrería Rossi", cuit: "27987654321", tipo: "Mercadería", detalle: "Queso y jamón para fiambre", monto_neto: 7355.37, iva_10_5: 0, iva_21: 1544.63, total: 8900, pago: "Caja", factura: "Entregada", caja_cierre: null },
        { id: "g3", fecha: new Date().toISOString(), proveedor: "Limpieza Express", cuit: "30555555555", tipo: "Gasto", detalle: "Detergentes y bolsas", monto_neto: 3719.01, iva_10_5: 0, iva_21: 780.99, total: 4500, pago: "Caja", factura: "Pendiente", caja_cierre: null }
      ];
      localStorage.setItem('mock_compras', JSON.stringify(initial));
      return initial;
    }
    return JSON.parse(stored).filter(g => !g.caja_cierre);
  },

  getCompras: async (limitDays = 30) => {
    const businessId = getBusinessId();
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - limitDays);
    const limitIso = limitDate.toISOString();

    if (isSupabaseConfigured() && supabase) {
      try {
        const [recentRes, pendingRes] = await Promise.all([
          supabase.from('gst_compras').select('*').eq('business_id', businessId).gte('fecha', limitIso),
          supabase.from('gst_compras').select('*').eq('business_id', businessId).eq('factura', 'Pendiente')
        ]);

        if (recentRes.error) throw recentRes.error;
        if (pendingRes.error) throw pendingRes.error;

        const combined = [...(recentRes.data || []), ...(pendingRes.data || [])];
        const map = {};
        combined.forEach(item => {
          map[item.id] = item;
        });
        const list = Object.values(map);
        list.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        return list;
      } catch (err) {
        console.warn("Supabase getCompras failed:", err);
      }
    }
    // Mock
    const stored = localStorage.getItem('mock_compras') || '[]';
    const list = JSON.parse(stored);
    return list
      .filter(c => new Date(c.fecha) >= new Date(limitIso) || c.factura === 'Pendiente')
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  },

  getProveedoresData: async () => {
    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase) {
      try {
        await syncHistoricalData(businessId);
        const activeBusinessId = getBusinessId();
        const rows = await queryGstTable('gst_proveedores', activeBusinessId, {
          orderBy: { field: 'nombre', ascending: true }
        });
        const map = {};
        rows.forEach(p => {
          map[p.nombre] = {
            tipo: p.tipo,
            detalle: p.detalle,
            pago: p.pago,
            cuit: p.cuit,
            alias: p.alias,
            factura: p.factura || 'Sin factura',
            celular_repartidor: p.celular_repartidor,
            celular_administracion: p.celular_administracion
          };
        });
        return map;
      } catch (err) {
        console.warn("Supabase getProveedoresData failed:", err);
      }
    }
    // Mock
    const stored = localStorage.getItem('mock_proveedores');
    if (!stored) {
      const initial = {
        "Distribuidora Sol": { tipo: "Mercadería", detalle: "Insumos varios", pago: "Transferencia Bancaria", cuit: "20123456789", alias: "Sol Dist", factura: "Entregada" },
        "Fiambrería Rossi": { tipo: "Mercadería", detalle: "Quesería", pago: "Caja", cuit: "27987654321", alias: "Fiambrería", factura: "Sin factura" },
        "Limpieza Express": { tipo: "Gasto", detalle: "Detergentes", pago: "Caja", cuit: "30555555555", alias: "Limpieza", factura: "Sin factura" }
      };
      localStorage.setItem('mock_proveedores', JSON.stringify(initial));
      return initial;
    }
    return JSON.parse(stored);
  },

  saveProveedor: async (prov, originalNombre = null) => {
    const businessId = getBusinessId();
    const cleanProv = {
      business_id: businessId,
      nombre: prov.nombre.trim(),
      cuit: prov.cuit ? prov.cuit.trim() : null,
      alias: prov.alias ? prov.alias.trim() : null,
      tipo: prov.tipo || 'Mercadería',
      detalle: prov.detalle || '',
      pago: prov.pago || 'Caja',
      factura: prov.factura || 'Sin factura',
      celular_repartidor: prov.celular_repartidor || null,
      celular_administracion: prov.celular_administracion || null
    };

    const targetNombre = originalNombre || cleanProv.nombre;

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: provExist } = await supabase
          .from('gst_proveedores')
          .select('id')
          .eq('nombre', targetNombre)
          .eq('business_id', businessId)
          .limit(1);

        if (!provExist || provExist.length === 0) {
          const { error } = await supabase.from('gst_proveedores').insert([cleanProv]);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('gst_proveedores')
            .update(cleanProv)
            .eq('id', provExist[0].id)
            .eq('business_id', businessId);
          if (error) throw error;
        }
        return { success: true };
      } catch (err) {
        console.warn("Supabase saveProveedor failed, falling back to mock:", err);
      }
    }

    // Mock Fallback
    const storedProv = localStorage.getItem('mock_proveedores') || '{}';
    const provs = JSON.parse(storedProv);
    
    if (originalNombre && originalNombre !== cleanProv.nombre) {
      delete provs[originalNombre];
    }
    
    provs[cleanProv.nombre] = {
      tipo: cleanProv.tipo,
      detalle: cleanProv.detalle,
      pago: cleanProv.pago,
      cuit: cleanProv.cuit,
      alias: cleanProv.alias,
      factura: cleanProv.factura,
      celular_repartidor: cleanProv.celular_repartidor,
      celular_administracion: cleanProv.celular_administracion
    };
    localStorage.setItem('mock_proveedores', JSON.stringify(provs));
    return { success: true };
  },

  deleteProveedor: async (nombre) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { error } = await supabase
          .from('gst_proveedores')
          .delete()
          .eq('nombre', nombre)
          .eq('business_id', businessId);
        if (error) throw error;
        return { success: true };
      } catch (err) {
        console.warn("Supabase deleteProveedor failed, falling back to mock:", err);
      }
    }

    const storedProv = localStorage.getItem('mock_proveedores') || '{}';
    const provs = JSON.parse(storedProv);
    if (provs[nombre]) {
      delete provs[nombre];
      localStorage.setItem('mock_proveedores', JSON.stringify(provs));
      return { success: true };
    }
    return { success: false, error: "Proveedor no encontrado" };
  },

  saveCompra: async (compra) => {
    const businessId = getBusinessId();
    const terminalId = getTerminalId();
    const isNew = !compra.id;
    const compraId = compra.id || "g_" + Date.now();
    const cleanCompra = {
      business_id: businessId,
      terminal_id: terminalId,
      fecha: compra.fecha || new Date().toISOString(),
      proveedor: compra.proveedor,
      cuit: compra.cuit || null,
      alias: compra.alias || null,
      tipo: compra.tipo || 'Mercadería',
      detalle: compra.detalle || '',
      monto_neto: parseFloat(compra.monto_neto || 0),
      iva_21: parseFloat(compra.iva_21 || 0),
      monto_neto_10_5: parseFloat(compra.monto_neto_10_5 || 0),
      iva_10_5: parseFloat(compra.iva_10_5 || 0),
      monto_neto_27: parseFloat(compra.monto_neto_27 || 0),
      iva_27: parseFloat(compra.iva_27 || 0),
      monto_exento: parseFloat(compra.monto_exento || 0),
      monto_no_gravado: parseFloat(compra.monto_no_gravado || 0),
      percep_iva: parseFloat(compra.percep_iva || 0),
      percep_iibb: parseFloat(compra.percep_iibb || 0),
      iibb_jurisdiccion: (parseFloat(compra.percep_iibb) || 0) > 0 ? compra.iibb_jurisdiccion : null,
      percep_ganancias: parseFloat(compra.percep_ganancias || 0),
      impuestos_internos: parseFloat(compra.impuestos_internos || 0),
      tasas_municipales: parseFloat(compra.tasas_municipales || 0),
      total: parseFloat(compra.total || 0),
      pago: compra.pago || 'Efectivo',
      factura: compra.factura || 'Sin factura',
      nro_factura: compra.nro_factura || null,
      no_computar_compra: !!compra.no_computar_compra,
      caja_cierre: compra.caja_cierre || null,
      conceptos_desglose: compra.conceptos_desglose || []
    };

    if (isSupabaseConfigured() && supabase) {
      try {
        let savedData = null;
        if (isNew) {
          const { data, error } = await supabase
            .from('gst_compras')
            .insert([cleanCompra])
            .select()
            .single();
          if (error) throw error;
          savedData = data;
        } else {
          const { data, error } = await supabase
            .from('gst_compras')
            .update(cleanCompra)
            .eq('id', compra.id)
            .eq('business_id', businessId)
            .select()
            .single();
          if (error) throw error;
          savedData = data;
        }

        // B. IMPACTOS SECUNDARIOS - Rendiciones
        if (cleanCompra.pago.toLowerCase().includes("rendic")) {
          const conceptLabel = `Gasto (Rendiciones): ${cleanCompra.proveedor} - ${cleanCompra.detalle}`;
          const { data: existingRend } = await supabase
            .from('gst_rendiciones')
            .select('id')
            .eq('business_id', businessId)
            .eq('concepto', conceptLabel)
            .eq('haber', cleanCompra.total)
            .limit(1);

          if (!existingRend || existingRend.length === 0) {
            await supabase.from('gst_rendiciones').insert([{
              business_id: businessId,
              terminal_id: terminalId,
              fecha: cleanCompra.fecha,
              concepto: conceptLabel,
              debe: 0.00,
              haber: cleanCompra.total,
              categoria: "Compras"
            }]);
          }
        }

        // C. GUARDAR PROVEEDOR (SOLO SI ES NUEVO)
        if (cleanCompra.proveedor.trim()) {
          const { data: provExist } = await supabase
            .from('gst_proveedores')
            .select('id')
            .eq('business_id', businessId)
            .eq('nombre', cleanCompra.proveedor.trim())
            .limit(1);
          
          if (!provExist || provExist.length === 0) {
            const provObj = {
              business_id: businessId,
              nombre: cleanCompra.proveedor.trim(),
              cuit: cleanCompra.cuit,
              alias: cleanCompra.alias,
              tipo: cleanCompra.tipo,
              detalle: cleanCompra.detalle,
              pago: cleanCompra.pago,
              factura: cleanCompra.factura,
              celular_repartidor: compra.celular_repartidor || null,
              celular_administracion: compra.celular_administracion || null
            };
            await supabase.from('gst_proveedores').insert([provObj]);
          }
          // No update here to avoid overwriting habitual settings (tipo, detalle, pago, factura)
        }

        return { success: true, data: savedData };
      } catch (err) {
        console.error("Supabase saveCompra failed:", err);
        return { success: false, error: err.message || "Error al guardar compra en Supabase." };
      }
    }

    // Mock
    const stored = localStorage.getItem('mock_compras') || '[]';
    const list = JSON.parse(stored);
    
    let savedMock = null;
    if (isNew) {
      savedMock = { id: compraId, ...cleanCompra };
      list.push(savedMock);
    } else {
      savedMock = { id: compra.id, ...cleanCompra };
      const idx = list.findIndex(c => c.id === compra.id);
      if (idx > -1) list[idx] = savedMock;
      else list.push(savedMock);
    }
    localStorage.setItem('mock_compras', JSON.stringify(list));

    // Impact in mock rendiciones
    if (cleanCompra.pago.toLowerCase().includes("rendic")) {
      const storedRend = localStorage.getItem('mock_rendiciones') || '[]';
      const rendList = JSON.parse(storedRend);
      const conceptLabel = `Gasto (Rendiciones): ${cleanCompra.proveedor} - ${cleanCompra.detalle}`;
      const exist = rendList.some(r => r.concepto === conceptLabel && r.haber === cleanCompra.total);
      if (!exist) {
        rendList.push({
          id: "r_" + Date.now(),
          fecha: cleanCompra.fecha,
          concepto: conceptLabel,
          debe: 0.00,
          haber: cleanCompra.total,
          categoria: "Compras"
        });
        localStorage.setItem('mock_rendiciones', JSON.stringify(rendList));
      }
    }

    // Impact in mock providers (only if new)
    if (cleanCompra.proveedor.trim()) {
      const storedProv = localStorage.getItem('mock_proveedores') || '{}';
      const provMap = JSON.parse(storedProv);
      if (!provMap[cleanCompra.proveedor.trim()]) {
        provMap[cleanCompra.proveedor.trim()] = {
          nombre: cleanCompra.proveedor.trim(),
          cuit: cleanCompra.cuit,
          alias: cleanCompra.alias,
          tipo: cleanCompra.tipo,
          detalle: cleanCompra.detalle,
          pago: cleanCompra.pago,
          factura: cleanCompra.factura,
          celular_repartidor: compra.celular_repartidor || null,
          celular_administracion: compra.celular_administracion || null
        };
        localStorage.setItem('mock_proveedores', JSON.stringify(provMap));
      }
      // No update for existing mock providers
    }

    return { success: true, data: savedMock };
  },

  deleteCompra: async (id) => {
    let target = null;
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: comp } = await supabase
          .from('gst_compras')
          .select('*')
          .eq('id', id)
          .single();
        target = comp;
      } catch (err) {
        console.warn("Supabase fetch before delete failed:", err);
      }
    } else {
      const stored = localStorage.getItem('mock_compras') || '[]';
      const list = JSON.parse(stored);
      target = list.find(c => c.id === id);
    }

    if (target) {
      if (target.pago && target.pago.toLowerCase().includes("rendic")) {
        const conceptLabel = `Gasto (Rendiciones): ${target.proveedor} - ${target.detalle}`;
        if (isSupabaseConfigured() && supabase) {
          try {
            await supabase
              .from('gst_rendiciones')
              .delete()
              .eq('business_id', businessId)
              .eq('concepto', conceptLabel)
              .eq('haber', target.total);
          } catch (err) {
            console.warn("Supabase revert rendiciones failed:", err);
          }
        } else {
          const storedRend = localStorage.getItem('mock_rendiciones') || '[]';
          const rendList = JSON.parse(storedRend);
          const filtered = rendList.filter(r => !(r.concepto === conceptLabel && r.haber === target.total));
          localStorage.setItem('mock_rendiciones', JSON.stringify(filtered));
        }
      }
    }

    // Perform delete
    if (isSupabaseConfigured() && supabase) {
      try {
        const { error } = await supabase
          .from('gst_compras')
          .delete()
          .eq('business_id', businessId)
          .eq('id', id);
        if (error) throw error;
        return { success: true };
      } catch (err) {
        console.warn("Supabase deleteCompra failed:", err);
      }
    }

    // Mock
    const stored = localStorage.getItem('mock_compras') || '[]';
    const list = JSON.parse(stored);
    const filtered = list.filter(c => c.id !== id);
    localStorage.setItem('mock_compras', JSON.stringify(filtered));
    return { success: true };
  },

  marcarFacturaEntregada: async (id, tipoFactura = 'Entregada') => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_compras')
          .update({ factura: tipoFactura })
          .eq('id', id)
          .eq('business_id', businessId)
          .select()
          .single();
        if (!error) return { success: true, data };
      } catch (err) {
        console.warn("Supabase marcarFacturaEntregada failed:", err);
      }
    }
    // Mock
    const mock = JSON.parse(localStorage.getItem('mock_compras') || '[]');
    const idx = mock.findIndex(c => c.id === id);
    if (idx > -1) {
      mock[idx].factura = tipoFactura;
      localStorage.setItem('mock_compras', JSON.stringify(mock));
      return { success: true, data: mock[idx] };
    }
    return { success: false, error: 'Compra no encontrada' };
  },

  getUniqueDetailsAndPayments: async () => {
    const details = await db.getComprasConceptos();
    const payments = await db.getComprasFormasPago();
    return { detalles: details, pagos: payments };
  },

  getPendingAdelantos: async () => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_empleado_movimientos')
          .select(EMPLEADO_MOVIMIENTOS_SELECT)
          .eq('business_id', businessId)
          .is('caja_cierre', null)
          .order('created_at', { ascending: true });
        if (!error) return mapEmpleadoMovimientoRows(data);
      } catch (err) {
        console.warn("Supabase pending adelantos failed:", err);
      }
    }
    // Mock
    purgeLegacyDemoAdelantosLocal();
    const stored = localStorage.getItem('mock_empleado_movimientos');
    if (!stored) return [];
    return JSON.parse(stored).filter(ad => !ad.caja_cierre);
  },

  getEmpleados: async () => {
    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase) {
      try {
        await syncHistoricalData(businessId);
        const activeBusinessId = getBusinessId();
        const rows = await queryGstTable('gst_personal', activeBusinessId, {
          orderBy: { field: 'nombre', ascending: true },
          mapRow: (emp) => ({ ...emp, is_active: emp.activo ?? emp.is_active ?? true })
        });
        return rows;
      } catch (err) {
        console.warn("Supabase getEmpleados failed:", err);
      }
    }
    // Mock
    const stored = localStorage.getItem('mock_personal_full');
    if (stored) return JSON.parse(stored);
    return [];
  },

  saveEmpleado: async (empleado) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const payload = {
          id: empleado.id || undefined,
          business_id: businessId,
          nombre: empleado.nombre,
          apodo: empleado.apodo,
          cuit: empleado.cuit,
          cbu: empleado.cbu,
          telefono: empleado.telefono,
          direccion: empleado.direccion,
          activo: empleado.is_active ?? true
        };
        console.log("Supabase saveEmpleado payload:", payload);
        const { data, error } = await supabase
          .from('gst_personal')
          .upsert(payload)
          .select()
          .single();
        console.log("Supabase saveEmpleado result:", { data, error });
        if (error) throw error;
        
        // Return mapped for UI
        return { 
          success: true, 
          data: { ...data, is_active: data.activo } 
        };
      } catch (err) {
        console.error("Error saving personal:", err);
        return { success: false, error: err.message };
      }
    }
    // Mock
    const list = JSON.parse(localStorage.getItem('mock_personal_full') || '[]');
    if (!empleado.id && list.some(p => p.nombre.toLowerCase() === empleado.nombre.toLowerCase())) {
      return { success: false, error: "El empleado ya existe." };
    }
    const newEmp = { ...empleado, id: empleado.id || ("p_" + Date.now()), is_active: true };
    if (empleado.id) {
      const idx = list.findIndex(p => p.id === empleado.id);
      if (idx !== -1) list[idx] = newEmp;
      else list.push(newEmp);
    } else {
      list.push(newEmp);
    }
    localStorage.setItem('mock_personal_full', JSON.stringify(list));
    return { success: true, data: newEmp };
  },

  toggleEmpleadoActivo: async (id, activo) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { error } = await supabase
          .from('gst_personal')
          .update({ activo: activo })
          .eq('id', id);
        if (error) throw error;
        return { success: true };
      } catch (err) {
        console.error("Error toggling personal status:", err);
        return { success: false, error: err.message };
      }
    }
    // Mock
    const list = JSON.parse(localStorage.getItem('mock_personal_full') || '[]');
    const idx = list.findIndex(p => p.id === id);
    if (idx > -1) {
      list[idx].is_active = activo;
      localStorage.setItem('mock_personal_full', JSON.stringify(list));
      return { success: true, data: list[idx] };
    }
    return { success: false, error: "Empleado no encontrado." };
  },

  getEmpleadoMovimientos: async (empleadoIdOrLimit, empleadoNombre) => {
    if (typeof empleadoIdOrLimit === 'number') {
      return fetchAdelantosMovimientos(empleadoIdOrLimit);
    }
    return fetchEmpleadoMovimientosByEmployee(empleadoIdOrLimit, empleadoNombre);
  },

  deleteEmpleadoMovimiento: async (id) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        // First get the movement to check if it's from Rendición
        const { data: target } = await supabase
          .from('gst_empleado_movimientos')
          .select('*')
          .eq('id', id)
          .eq('business_id', businessId)
          .single();
        
        if (target && target.caja_cierre === 'Rendición') {
          const detailLabel = `Adelanto Personal: ${target.empleado}`;
          await supabase
            .from('gst_rendiciones')
            .delete()
            .eq('business_id', businessId)
            .eq('concepto', detailLabel)
            .eq('haber', target.monto);
        }

        const { error: delErr } = await supabase
          .from('gst_empleado_movimientos')
          .delete()
          .eq('id', id)
          .eq('business_id', businessId);
        if (!delErr) return { success: true };
        throw delErr;
      } catch (err) {
        console.warn("Supabase deleteEmpleadoMovimiento failed:", err);
        return { success: false, error: err.message || "Error al eliminar movimiento." };
      }
    }
    // Mock
    const stored = localStorage.getItem('mock_empleado_movimientos') || '[]';
    const list = JSON.parse(stored);
    const target = list.find(item => item.id === id);
    if (target && target.caja_cierre === 'Rendición') {
      const storedRend = localStorage.getItem('mock_rendiciones') || '[]';
      const rendList = JSON.parse(storedRend);
      const detailLabel = `Adelanto Personal: ${target.empleado}`;
      const updatedRend = rendList.filter(r => !(r.concepto === detailLabel && r.haber === target.monto));
      localStorage.setItem('mock_rendiciones', JSON.stringify(updatedRend));
    }
    const updated = list.filter(item => item.id !== id);
    localStorage.setItem('mock_empleado_movimientos', JSON.stringify(updated));
    return { success: true };
  },

  getRendiciones: async (limit = 100) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: cutoffData } = await supabase
          .from('gst_rendiciones')
          .select('fecha')
          .eq('business_id', businessId)
          .ilike('concepto', '%Retiro total%')
          .order('fecha', { ascending: false })
          .limit(1)
          .maybeSingle();

        let query = supabase
          .from('gst_rendiciones')
          .select('*')
          .eq('business_id', businessId);

        if (cutoffData && cutoffData.fecha) {
          query = query.gt('fecha', cutoffData.fecha);
        }

        const { data, error } = await query
          .order('fecha', { ascending: false })
          .limit(limit);
        if (!error) return data;
        throw error;
      } catch (err) {
        console.warn("Supabase getRendiciones failed:", err);
      }
    }
    const stored = localStorage.getItem('mock_rendiciones') || '[]';
    const list = JSON.parse(stored).sort((a,b) => new Date(b.fecha) - new Date(a.fecha));
    const latestRetiro = list.find(r => r.concepto && r.concepto.toLowerCase().includes('retiro total'));
    if (latestRetiro) {
      const cutoffTime = new Date(latestRetiro.fecha).getTime();
      return list.filter(r => new Date(r.fecha).getTime() > cutoffTime);
    }
    return list;
  },

  getRendicionesSaldo: async () => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: cutoffData } = await supabase
          .from('gst_rendiciones')
          .select('fecha')
          .eq('business_id', businessId)
          .ilike('concepto', '%Retiro total%')
          .order('fecha', { ascending: false })
          .limit(1)
          .maybeSingle();

        let query = supabase
          .from('gst_rendiciones')
          .select('debe, haber')
          .eq('business_id', businessId);

        if (cutoffData && cutoffData.fecha) {
          query = query.gt('fecha', cutoffData.fecha);
        }

        const { data, error } = await query;
        if (!error && data) {
          const debeSum = data.reduce((acc, curr) => acc + (parseFloat(curr.debe) || 0), 0);
          const haberSum = data.reduce((acc, curr) => acc + (parseFloat(curr.haber) || 0), 0);
          return { debe: debeSum, haber: haberSum, saldo: debeSum - haberSum };
        }
        throw error;
      } catch (err) {
        console.warn("Supabase getRendicionesSaldo failed:", err);
      }
    }
    const stored = localStorage.getItem('mock_rendiciones') || '[]';
    const list = JSON.parse(stored);
    const listSorted = [...list].sort((a,b) => new Date(b.fecha) - new Date(a.fecha));
    const latestRetiro = listSorted.find(r => r.concepto && r.concepto.toLowerCase().includes('retiro total'));
    let filteredList = list;
    if (latestRetiro) {
      const cutoffTime = new Date(latestRetiro.fecha).getTime();
      filteredList = list.filter(r => new Date(r.fecha).getTime() > cutoffTime);
    }
    const debeSum = filteredList.reduce((acc, curr) => acc + (parseFloat(curr.debe) || 0), 0);
    const haberSum = filteredList.reduce((acc, curr) => acc + (parseFloat(curr.haber) || 0), 0);
    return { debe: debeSum, haber: haberSum, saldo: debeSum - haberSum };
  },

  saveRendicion: async (mov) => {
    const businessId = getBusinessId();
    const terminalId = getTerminalId();
    const cleanMov = {
      business_id: businessId,
      terminal_id: terminalId,
      fecha: mov.fecha || new Date().toISOString(),
      concepto: mov.concepto,
      debe: parseFloat(mov.debe || 0),
      haber: parseFloat(mov.haber || 0),
      categoria: mov.categoria || 'Ajuste'
    };

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_rendiciones')
          .insert([cleanMov])
          .select()
          .single();
        if (!error) return { success: true, data };
        throw error;
      } catch (err) {
        console.warn("Supabase saveRendicion failed:", err);
        return { success: false, error: err.message };
      }
    }
    const stored = localStorage.getItem('mock_rendiciones') || '[]';
    const list = JSON.parse(stored);
    const newRend = { id: "r_" + Date.now(), ...cleanMov };
    list.push(newRend);
    localStorage.setItem('mock_rendiciones', JSON.stringify(list));
    return { success: true, data: newRend };
  },

  getLatestRetiroTotal: async () => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_rendiciones')
          .select('*')
          .eq('business_id', businessId)
          .ilike('concepto', '%Retiro total%')
          .order('fecha', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!error) return data;
      } catch (err) {
        console.warn("Supabase getLatestRetiroTotal failed:", err);
      }
    }
    const stored = localStorage.getItem('mock_rendiciones') || '[]';
    const list = JSON.parse(stored);
    return [...list]
      .filter(r => r.concepto && r.concepto.toLowerCase().includes('retiro total'))
      .sort((a,b) => new Date(b.fecha) - new Date(a.fecha))[0] || null;
  },

  deleteRendicion: async (id) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { error } = await supabase
          .from('gst_rendiciones')
          .delete()
          .eq('id', id)
          .eq('business_id', businessId);
        if (!error) return { success: true };
        throw error;
      } catch (err) {
        console.warn("Supabase deleteRendicion failed:", err);
        return { success: false, error: err.message };
      }
    }
    const stored = localStorage.getItem('mock_rendiciones') || '[]';
    const list = JSON.parse(stored);
    const updated = list.filter(r => r.id !== id);
    localStorage.setItem('mock_rendiciones', JSON.stringify(updated));
    return { success: true };
  },

  saveAdelanto: async (mov) => {
    const businessId = getBusinessId();
    const terminalId = getTerminalId();
    const identity = await resolveEmpleadoMovimientoIdentity(mov);
    if (identity.error) {
      return { success: false, error: identity.error };
    }

    const isRendicion = mov.concepto.toLowerCase().includes("rendic") || (mov.origen && mov.origen.toLowerCase().includes("rendic"));
    const finalCajaCierre = isRendicion ? 'Rendición' : null;
    
    // Concatenate observation into concept to avoid schema cache issues with adding new columns to the database schema
    const combinedConcepto = mov.concepto + (mov.observacion ? ' - ' + mov.observacion : '');

    const cleanMov = {
      business_id: businessId,
      terminal_id: terminalId,
      empleado_id: identity.empleadoId,
      fecha: mov.fecha || new Date().toISOString(),
      empleado: identity.empleadoNombre,
      concepto: combinedConcepto,
      monto: parseFloat(mov.monto || 0),
      caja_cierre: finalCajaCierre
    };

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_empleado_movimientos')
          .insert([cleanMov])
          .select()
          .single();
        if (error) throw error;

        if (isRendicion) {
          const detailLabel = `Adelanto Personal: ${cleanMov.empleado}${mov.observacion ? ` - ${mov.observacion}` : ''}`;
          await supabase.from('gst_rendiciones').insert([{
            business_id: businessId,
            terminal_id: terminalId,
            fecha: cleanMov.fecha,
            concepto: detailLabel,
            debe: 0.00,
            haber: cleanMov.monto,
            categoria: "Personal"
          }]);
        }

        return { success: true, data };
      } catch (err) {
        console.warn("Supabase saveAdelanto failed:", err);
        return { success: false, error: err.message || "Error al guardar adelanto." };
      }
    }
    // Mock
    const stored = localStorage.getItem('mock_empleado_movimientos') || '[]';
    const list = JSON.parse(stored);
    const newMov = {
      id: "ad_" + Date.now(),
      ...cleanMov
    };
    list.push(newMov);
    localStorage.setItem('mock_empleado_movimientos', JSON.stringify(list));

    if (isRendicion) {
      const storedRend = localStorage.getItem('mock_rendiciones') || '[]';
      const rendList = JSON.parse(storedRend);
      const detailLabel = `Adelanto Personal: ${cleanMov.empleado}${mov.observacion ? ` - ${mov.observacion}` : ''}`;
      rendList.push({
        id: "r_" + Date.now(),
        fecha: cleanMov.fecha,
        concepto: detailLabel,
        debe: 0.00,
        haber: cleanMov.monto,
        categoria: "Personal"
      });
      localStorage.setItem('mock_rendiciones', JSON.stringify(rendList));
    }

    return { success: true, data: newMov };
  },

  getProveedorPagos: async (limitDays = 90) => {
    const businessId = getBusinessId();
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - limitDays);
    const limitIso = limitDate.toISOString();

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_proveedor_pagos')
          .select('*')
          .eq('business_id', businessId)
          .gte('fecha', limitIso)
          .order('fecha', { ascending: false });
        if (!error) return data;
        throw error;
      } catch (err) {
        console.warn("Supabase getProveedorPagos failed:", err);
      }
    }
    // Mock
    const stored = localStorage.getItem('mock_proveedor_pagos') || '[]';
    return JSON.parse(stored)
      .filter(p => new Date(p.fecha) >= new Date(limitIso))
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  },

  saveProveedorPago: async (pago) => {
    const businessId = getBusinessId();
    const terminalId = getTerminalId();
    const isRendicion = pago.origen && pago.origen.toLowerCase().includes("rendic");
    const finalCajaCierre = isRendicion ? 'Rendición' : (pago.origen || null);
    
    const cleanPago = {
      business_id: businessId,
      terminal_id: terminalId,
      fecha: pago.fecha || new Date().toISOString(),
      proveedor: pago.proveedor,
      alias: pago.alias || null,
      origen: pago.origen,
      monto: parseFloat(pago.monto || 0),
      observacion: pago.observacion || '',
      caja_cierre: finalCajaCierre
    };

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_proveedor_pagos')
          .insert([cleanPago])
          .select()
          .single();
        if (error) throw error;

        if (isRendicion) {
          const detailLabel = `Pago Proveedor: ${cleanPago.proveedor}${cleanPago.observacion ? ` - ${cleanPago.observacion}` : ''}`;
          await supabase.from('gst_rendiciones').insert([{
            business_id: businessId,
            terminal_id: terminalId,
            fecha: cleanPago.fecha,
            concepto: detailLabel,
            debe: 0.00,
            haber: cleanPago.monto,
            categoria: "Proveedores"
          }]);
        }

        return { success: true, data };
      } catch (err) {
        console.warn("Supabase saveProveedorPago failed:", err);
        return { success: false, error: err.message || "Error al guardar pago a proveedor." };
      }
    }
    // Mock
    const stored = localStorage.getItem('mock_proveedor_pagos') || '[]';
    const list = JSON.parse(stored);
    const newPago = {
      id: "pp_" + Date.now(),
      ...cleanPago
    };
    list.push(newPago);
    localStorage.setItem('mock_proveedor_pagos', JSON.stringify(list));

    if (isRendicion) {
      const storedRend = localStorage.getItem('mock_rendiciones') || '[]';
      const rendList = JSON.parse(storedRend);
      const detailLabel = `Pago Proveedor: ${cleanPago.proveedor}${cleanPago.observacion ? ` - ${cleanPago.observacion}` : ''}`;
      rendList.push({
        id: "r_" + Date.now(),
        fecha: cleanPago.fecha,
        concepto: detailLabel,
        debe: 0.00,
        haber: cleanPago.monto,
        categoria: "Proveedores"
      });
      localStorage.setItem('mock_rendiciones', JSON.stringify(rendList));
    }

    return { success: true, data: newPago };
  },

  deleteProveedorPago: async (id) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        // First get the payment to check if it's from Rendición
        const { data: target } = await supabase
          .from('gst_proveedor_pagos')
          .select('*')
          .eq('id', id)
          .eq('business_id', businessId)
          .single();
        
        if (target && target.caja_cierre === 'Rendición') {
          const detailLabel = `Pago Proveedor: ${target.proveedor}${target.observacion ? ` - ${target.observacion}` : ''}`;
          await supabase
            .from('gst_rendiciones')
            .delete()
            .eq('business_id', businessId)
            .eq('concepto', detailLabel)
            .eq('haber', target.monto);
        }

        const { error: delErr } = await supabase
          .from('gst_proveedor_pagos')
          .delete()
          .eq('id', id)
          .eq('business_id', businessId);
        if (!delErr) return { success: true };
        throw delErr;
      } catch (err) {
        console.warn("Supabase deleteProveedorPago failed:", err);
        return { success: false, error: err.message || "Error al eliminar pago." };
      }
    }
    // Mock
    const stored = localStorage.getItem('mock_proveedor_pagos') || '[]';
    const list = JSON.parse(stored);
    const target = list.find(item => item.id === id);
    if (target && target.caja_cierre === 'Rendición') {
      const storedRend = localStorage.getItem('mock_rendiciones') || '[]';
      const rendList = JSON.parse(storedRend);
      const detailLabel = `Pago Proveedor: ${target.proveedor}${target.observacion ? ` - ${target.observacion}` : ''}`;
      const updatedRend = rendList.filter(r => !(r.concepto === detailLabel && r.haber === target.monto));
      localStorage.setItem('mock_rendiciones', JSON.stringify(updatedRend));
    }
    const updated = list.filter(item => item.id !== id);
    localStorage.setItem('mock_proveedor_pagos', JSON.stringify(updated));
    return { success: true };
  },


  saveCierre: async (cierre, selectedGastoIds = [], selectedAdelantoIds = [], selectedPedidoIds = []) => {
    const businessId = getBusinessId();
    const labelTurno = cierre.turno;
    const medioValues = cierre.medioValues || {};
    const medios = await db.getCierreConceptos();
    const slotRow = buildCierreSlotRow(medioValues);
    const totalEfectivo = slotRow.medio_01;
    const totalCierre = parseFloat(cierre.total || 0);

    let dateObj;
    if (cierre.fecha) {
      const now = new Date();
      const [y, m, d] = cierre.fecha.split('-').map(Number);
      dateObj = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds());
    } else {
      dateObj = new Date();
    }
    const labelCaja = buildCajaCierreLabel(cierre.fecha, labelTurno);

    const baseRow = {
      business_id: businessId,
      fecha: dateObj.toISOString(),
      turno: labelTurno,
      ...slotRow,
      adelantos_efectivo: parseFloat(cierre.adelantos_efectivo || 0),
      adelantos_merc: parseFloat(cierre.adelantos_merc || 0),
      compras: parseFloat(cierre.compras || 0),
      total: totalCierre,
    };

    if (isSupabaseConfigured() && supabase) {
      try {
        const safeTerminalId = await resolveTerminalIdForInsert(businessId);
        const insertRow = {
          ...baseRow,
          ...(safeTerminalId ? { terminal_id: safeTerminalId } : {}),
        };

        const { error: errCierre } = await supabase
          .from('gst_cierres_caja')
          .insert([insertRow])
          .select();
        
        if (errCierre) throw errCierre;

        const updatedMedios = applyUsedMedioFlags(medios, medioValues);
        await db.saveCierreMediosUsed(updatedMedios);

        if (totalCierre > 0) {
          const rendRow = {
            business_id: businessId,
            fecha: dateObj.toISOString(),
            concepto: `Cierre ${labelTurno}`,
            debe: totalEfectivo,
            haber: 0.00,
            categoria: "Ventas"
          };
          if (safeTerminalId) rendRow.terminal_id = safeTerminalId;
          await supabase.from('gst_rendiciones').insert([rendRow]);
        }

        if (selectedGastoIds.length > 0) {
          await supabase
            .from('gst_compras')
            .update({ caja_cierre: labelCaja })
            .in('id', selectedGastoIds)
            .eq('business_id', businessId);
        }

        if (selectedAdelantoIds.length > 0) {
          await supabase
            .from('gst_empleado_movimientos')
            .update({ caja_cierre: labelCaja })
            .in('id', selectedAdelantoIds)
            .eq('business_id', businessId);
        }

        if (selectedPedidoIds.length > 0) {
          await supabase
            .from('gst_pedidos')
            .update({ caja_cierre: labelCaja })
            .in('id', selectedPedidoIds)
            .eq('business_id', businessId);
        }

        void notifyCierreCajaSaved(cierre, medioValues, medios);

        return { success: true };
      } catch (err) {
        console.warn("Supabase saveCierre failed:", err);
        return { success: false, error: err.message || 'Error al guardar cierre en Supabase.' };
      }
    }

    // Mock (solo modo demo / sin Supabase)
    const storedCierres = localStorage.getItem('mock_cierres') || '[]';
    const cierres = JSON.parse(storedCierres);
    const newCierre = {
      id: "c_" + Date.now(),
      ...baseRow,
    };
    cierres.push(newCierre);
    localStorage.setItem('mock_cierres', JSON.stringify(cierres));

    if (totalCierre > 0) {
      const storedRendiciones = localStorage.getItem('mock_rendiciones') || '[]';
      const rendiciones = JSON.parse(storedRendiciones);
      rendiciones.push({
        id: "r_" + Date.now(),
        fecha: dateObj.toISOString(),
        concepto: `Cierre ${labelTurno}`,
        debe: totalEfectivo,
        haber: 0.00,
        categoria: "Ventas"
      });
      localStorage.setItem('mock_rendiciones', JSON.stringify(rendiciones));
    }

    if (selectedGastoIds.length > 0) {
      const storedCompras = localStorage.getItem('mock_compras') || '[]';
      const compras = JSON.parse(storedCompras);
      const updated = compras.map(c => selectedGastoIds.includes(c.id) ? { ...c, caja_cierre: labelCaja } : c);
      localStorage.setItem('mock_compras', JSON.stringify(updated));
    }

    if (selectedAdelantoIds.length > 0) {
      const storedAdelantos = localStorage.getItem('mock_empleado_movimientos') || '[]';
      const adelantos = JSON.parse(storedAdelantos);
      const updated = adelantos.map(ad => selectedAdelantoIds.includes(ad.id) ? { ...ad, caja_cierre: labelCaja } : ad);
      localStorage.setItem('mock_empleado_movimientos', JSON.stringify(updated));
    }

    if (selectedPedidoIds.length > 0) {
      const storedPedidos = localStorage.getItem('mock_pedidos') || '[]';
      const pedidos = JSON.parse(storedPedidos);
      const updatedPedidos = pedidos.map((p) => (
        selectedPedidoIds.includes(p.id) ? { ...p, caja_cierre: labelCaja } : p
      ));
      localStorage.setItem('mock_pedidos', JSON.stringify(updatedPedidos));
    }

    await db.saveCierreMediosUsed(applyUsedMedioFlags(medios, medioValues));

    void notifyCierreCajaSaved(cierre, medioValues, medios);

    return { success: true };
  },

  getUltimosCierres: async () => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_cierres_caja')
          .select('*')
          .eq('business_id', businessId)
          .order('fecha', { ascending: false })
          .limit(10);
        if (!error) return data;
      } catch (err) {
        console.warn("Supabase getUltimosCierres failed:", err);
      }
    }
    const stored = localStorage.getItem('mock_cierres') || '[]';
    return JSON.parse(stored).sort((a,b) => new Date(b.fecha) - new Date(a.fecha));
  },

  /** Turnos habilitados que aún no tienen cierre registrado hoy. */
  getCajasAbiertasDelDia: async (eligibleTurnos = null, referenceDate = new Date()) => {
    const allTurnos = await db.getCierreTurnoNames();
    const turnos = Array.isArray(eligibleTurnos) && eligibleTurnos.length > 0
      ? eligibleTurnos
      : allTurnos;
    const cierres = await db.getUltimosCierres();
    return getUnclosedTurnosForDate(turnos, cierres, referenceDate);
  },

  // --- PRICE LISTS ---
  _readMockPriceLists: () => {
    const stored = localStorage.getItem('mock_listas_precios');
    return stored ? JSON.parse(stored) : [];
  },

  _writeMockPriceLists: (lists) => {
    localStorage.setItem('mock_listas_precios', JSON.stringify(lists));
  },

  _readMockPriceListItems: () => {
    const stored = localStorage.getItem('mock_lista_precio_items');
    return stored ? JSON.parse(stored) : [];
  },

  _writeMockPriceListItems: (items) => {
    localStorage.setItem('mock_lista_precio_items', JSON.stringify(items));
  },

  ensureDefaultPriceLists: async () => {
    const businessId = await ensureBusinessContext();
    const names = [
      { nombre: DEFAULT_PRICE_LIST_NAMES.normal, es_default: true, orden: 1, legacyNames: [] },
      { nombre: DEFAULT_PRICE_LIST_NAMES.empresas, es_default: false, orden: 2, legacyNames: [LEGACY_PRICE_LIST_NAMES.empresas] },
      { nombre: DEFAULT_PRICE_LIST_NAMES.viandas, es_default: false, orden: 3, legacyNames: [] },
      { nombre: DEFAULT_PRICE_LIST_NAMES.efectivo, es_default: false, orden: 4, legacyNames: [] },
    ];

    const seedNonDefaultListItems = async (lists) => {
      const products = await db.getProducts();
      const nonDefault = lists.filter((l) => !l.es_default);
      if (nonDefault.length === 0) return;

      if (isSupabaseConfigured() && supabase) {
        const listaIds = nonDefault.map((l) => l.id);
        const { data: existingItems, error: fetchErr } = await supabase
          .from('gst_lista_precio_items')
          .select('lista_id, producto_id')
          .eq('business_id', businessId)
          .in('lista_id', listaIds);
        if (fetchErr) throw fetchErr;

        const existingKeys = new Set(
          (existingItems || []).map((row) => buildPriceListItemKey(row.lista_id, row.producto_id))
        );

        const rowsToInsert = [];
        for (const lista of nonDefault) {
          for (const p of products || []) {
            const key = buildPriceListItemKey(lista.id, p.id);
            if (existingKeys.has(key)) continue;
            rowsToInsert.push({
              business_id: businessId,
              lista_id: lista.id,
              producto_id: p.id,
              precio: parseFloat(p.precio) || 0,
            });
          }
        }

        if (rowsToInsert.length > 0) {
          const { error: insertErr } = await supabase
            .from('gst_lista_precio_items')
            .insert(rowsToInsert);
          if (insertErr) throw insertErr;
        }
        return;
      }

      let items = db._readMockPriceListItems();
      for (const lista of nonDefault) {
        for (const p of products || []) {
          const key = buildPriceListItemKey(lista.id, p.id);
          if (!items.some((it) => buildPriceListItemKey(it.lista_id, it.producto_id) === key)) {
            items.push({
              id: `pli_${Date.now()}_${Math.random()}`,
              business_id: businessId,
              lista_id: lista.id,
              producto_id: p.id,
              precio: parseFloat(p.precio) || 0,
            });
          }
        }
      }
      db._writeMockPriceListItems(items);
    };

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: existing } = await supabase
          .from('gst_listas_precios')
          .select('*')
          .eq('business_id', businessId)
          .order('orden', { ascending: true });

        const byName = Object.fromEntries((existing || []).map((l) => [l.nombre, l]));
        const resolved = [];

        for (const spec of names) {
          if (byName[spec.nombre]) {
            const current = byName[spec.nombre];
            if (current.orden !== spec.orden || current.es_default !== spec.es_default) {
              const { data, error } = await supabase
                .from('gst_listas_precios')
                .update({ orden: spec.orden, es_default: spec.es_default, activa: true })
                .eq('id', current.id)
                .select()
                .single();
              if (error) throw error;
              resolved.push(data);
              byName[spec.nombre] = data;
            } else {
              resolved.push(current);
            }
            continue;
          }

          const legacyName = (spec.legacyNames || []).find((legacy) => byName[legacy]);
          if (legacyName) {
            const { data, error } = await supabase
              .from('gst_listas_precios')
              .update({
                nombre: spec.nombre,
                orden: spec.orden,
                es_default: spec.es_default,
                activa: true,
              })
              .eq('id', byName[legacyName].id)
              .select()
              .single();
            if (error) throw error;
            delete byName[legacyName];
            byName[spec.nombre] = data;
            resolved.push(data);
            continue;
          }

          const { data, error } = await supabase
            .from('gst_listas_precios')
            .insert([{
              business_id: businessId,
              nombre: spec.nombre,
              es_default: spec.es_default,
              activa: true,
              orden: spec.orden,
            }])
            .select()
            .single();
          if (error) throw error;
          byName[spec.nombre] = data;
          resolved.push(data);
        }

        const sorted = resolved.sort((a, b) => (a.orden || 0) - (b.orden || 0));
        await seedNonDefaultListItems(sorted);
        return sorted;
      } catch (err) {
        console.warn('ensureDefaultPriceLists Supabase error:', err);
      }
    }

    let allLists = db._readMockPriceLists();
    let lists = allLists.filter((l) => l.business_id === businessId);
    const byName = Object.fromEntries(lists.map((l) => [l.nombre, l]));
    const resolved = [];

    for (const spec of names) {
      if (byName[spec.nombre]) {
        const current = byName[spec.nombre];
        current.orden = spec.orden;
        current.es_default = spec.es_default;
        current.activa = true;
        resolved.push(current);
        continue;
      }

      const legacyName = (spec.legacyNames || []).find((legacy) => byName[legacy]);
      if (legacyName) {
        const current = byName[legacyName];
        current.nombre = spec.nombre;
        current.orden = spec.orden;
        current.es_default = spec.es_default;
        current.activa = true;
        delete byName[legacyName];
        byName[spec.nombre] = current;
        resolved.push(current);
        continue;
      }

      const created = {
        id: `pl_${businessId}_${spec.orden}`,
        business_id: businessId,
        nombre: spec.nombre,
        es_default: spec.es_default,
        activa: true,
        orden: spec.orden,
      };
      lists.push(created);
      allLists.push(created);
      byName[spec.nombre] = created;
      resolved.push(created);
    }

    db._writeMockPriceLists(allLists);
    const sorted = resolved.sort((a, b) => (a.orden || 0) - (b.orden || 0));
    await seedNonDefaultListItems(sorted);
    return sorted;
  },

  needsPriceListSetup: (lists) => {
    const expected = Object.values(DEFAULT_PRICE_LIST_NAMES);
    const names = new Set((lists || []).map((list) => list.nombre));
    if ((lists || []).length === 0) return true;
    if (names.has(LEGACY_PRICE_LIST_NAMES.empresas)) return true;
    return expected.some((name) => !names.has(name));
  },

  getPriceLists: async () => {
    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_listas_precios')
          .select('*')
          .eq('business_id', businessId)
          .eq('activa', true)
          .order('orden', { ascending: true });
        if (!error) {
          if (db.needsPriceListSetup(data)) {
            return db.ensureDefaultPriceLists();
          }
          return data;
        }
      } catch (err) {
        console.warn('getPriceLists Supabase error:', err);
      }
    }

    let lists = db._readMockPriceLists().filter(
      (list) => list.business_id === businessId && list.activa !== false
    );
    if (db.needsPriceListSetup(lists)) {
      return db.ensureDefaultPriceLists();
    }
    return lists.sort((a, b) => (a.orden || 0) - (b.orden || 0));
  },

  getPriceListItemsMap: async () => {
    const businessId = await ensureBusinessContext();
    const map = {};

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_lista_precio_items')
          .select('lista_id, producto_id, precio')
          .eq('business_id', businessId);
        if (!error && data) {
          data.forEach((row) => {
            map[buildPriceListItemKey(row.lista_id, row.producto_id)] = parseFloat(row.precio) || 0;
          });
          return map;
        }
      } catch (err) {
        console.warn('getPriceListItemsMap Supabase error:', err);
      }
    }

    db._readMockPriceListItems()
      .filter((row) => row.business_id === businessId)
      .forEach((row) => {
        map[buildPriceListItemKey(row.lista_id, row.producto_id)] = parseFloat(row.precio) || 0;
      });
    return map;
  },

  syncProductPriceListItems: async (productId, precio) => {
    const businessId = getBusinessId();
    const lists = await db.getPriceLists();
    const nonDefault = lists.filter((l) => !l.es_default);
    const price = parseFloat(precio) || 0;

    if (isSupabaseConfigured() && supabase) {
      try {
        const rows = nonDefault.map((lista) => ({
          business_id: businessId,
          lista_id: lista.id,
          producto_id: productId,
          precio: price,
        }));
        if (rows.length === 0) return { success: true };
        const { error } = await supabase
          .from('gst_lista_precio_items')
          .upsert(rows, { onConflict: 'lista_id,producto_id' });
        if (error) throw error;
        return { success: true };
      } catch (err) {
        console.warn('syncProductPriceListItems Supabase error:', err);
      }
    }

    let items = db._readMockPriceListItems();
    for (const lista of nonDefault) {
      const key = buildPriceListItemKey(lista.id, productId);
      const idx = items.findIndex(
        (it) => buildPriceListItemKey(it.lista_id, it.producto_id) === key
      );
      if (idx >= 0) {
        items[idx] = { ...items[idx], precio: price };
      } else {
        items.push({
          id: `pli_${Date.now()}_${Math.random()}`,
          business_id: businessId,
          lista_id: lista.id,
          producto_id: productId,
          precio: price,
        });
      }
    }
    db._writeMockPriceListItems(items);
    return { success: true };
  },

  applyBulkProductListPrices: async ({
    productIds,
    listPrices,
  }) => {
    const businessId = getBusinessId();
    const lists = await db.getPriceLists();
    const defaultList = lists.find((l) => l.es_default) || lists[0];
    const normalPrice = parseFloat(listPrices[defaultList?.id]) || 0;

    if (isSupabaseConfigured() && supabase) {
      try {
        for (const productId of productIds) {
          const { error: prodErr } = await supabase
            .from('gst_productos')
            .update({ precio: normalPrice })
            .eq('id', productId)
            .eq('business_id', businessId);
          if (prodErr) throw prodErr;
        }

        const rows = [];
        for (const lista of lists) {
          if (lista.es_default) continue;
          const price = parseFloat(listPrices[lista.id]);
          if (!Number.isFinite(price)) continue;
          for (const productId of productIds) {
            rows.push({
              business_id: businessId,
              lista_id: lista.id,
              producto_id: productId,
              precio: price,
            });
          }
        }

        if (rows.length > 0) {
          const { error: itemErr } = await supabase
            .from('gst_lista_precio_items')
            .upsert(rows, { onConflict: 'lista_id,producto_id' });
          if (itemErr) throw itemErr;
        }

        return { success: true, updated: productIds.length };
      } catch (err) {
        console.warn('applyBulkProductListPrices Supabase error:', err);
        throw err;
      }
    }

    const stored = localStorage.getItem('mock_productos');
    let products = stored ? JSON.parse(stored) : [];
    products = products.map((p) =>
      productIds.includes(p.id) ? { ...p, precio: normalPrice } : p
    );
    localStorage.setItem('mock_productos', JSON.stringify(products));

    let items = db._readMockPriceListItems();
    for (const lista of lists) {
      if (lista.es_default) continue;
      const price = parseFloat(listPrices[lista.id]);
      if (!Number.isFinite(price)) continue;
      for (const productId of productIds) {
        const key = buildPriceListItemKey(lista.id, productId);
        const idx = items.findIndex(
          (it) => buildPriceListItemKey(it.lista_id, it.producto_id) === key
        );
        if (idx >= 0) {
          items[idx] = { ...items[idx], precio: price };
        } else {
          items.push({
            id: `pli_${Date.now()}_${Math.random()}`,
            business_id: businessId,
            lista_id: lista.id,
            producto_id: productId,
            precio: price,
          });
        }
      }
    }
    db._writeMockPriceListItems(items);
    return { success: true, updated: productIds.length };
  },

  // --- PRODUCTS INVENTORY ---
  getProducts: async () => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_productos')
          .select('*')
          .eq('business_id', businessId)
          .order('nombre', { ascending: true });
        
        if (!error && data) return data;
      } catch (err) {
        console.warn("Supabase getProducts error:", err);
      }
    }

    const defaultProducts = [
      { id: "p1", nombre: "Yerba Mate Orgánica (1kg)", rubro: "Almacén", precio: 4500, stock: 50, iva: 21 },
      { id: "p2", nombre: "Miel de Abeja Pura (500g)", rubro: "Almacén", precio: 3200, stock: 30, iva: 10.5 },
      { id: "p3", nombre: "Aceite de Coco Neutro (360ml)", rubro: "Almacén", precio: 5800, stock: 20, iva: 21 },
      { id: "p4", nombre: "Mix Frutos Secos Premium (250g)", rubro: "Dietética", precio: 2900, stock: 40, iva: 0 },
      { id: "p5", nombre: "Granola Multisemillas (500g)", rubro: "Dietética", precio: 3500, stock: 25, iva: 10.5 }
    ];
    const stored = localStorage.getItem('mock_productos');
    if (!stored) {
      localStorage.setItem('mock_productos', JSON.stringify(defaultProducts));
      return defaultProducts;
    }
    return JSON.parse(stored);
  },

  saveProduct: async (product) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const isUpdate = product.id && !String(product.id).startsWith('p');
        if (isUpdate) {
          const { data, error } = await supabase
            .from('gst_productos')
            .update({
              nombre: product.nombre,
              rubro: product.rubro,
              precio: parseFloat(product.precio),
              stock: parseFloat(product.stock),
              iva: parseFloat(product.iva)
            })
            .eq('id', product.id)
            .eq('business_id', businessId)
            .select()
            .single();
          if (error) throw error;
          return { success: true, data };
        } else {
          const insertData = {
            business_id: businessId,
            nombre: product.nombre,
            rubro: product.rubro,
            precio: parseFloat(product.precio),
            stock: parseFloat(product.stock),
            iva: parseFloat(product.iva)
          };
          const { data, error } = await supabase
            .from('gst_productos')
            .insert([insertData])
            .select()
            .single();
          if (error) throw error;
          await db.syncProductPriceListItems(data.id, insertData.precio);
          return { success: true, data };
        }
      } catch (err) {
        console.warn("Supabase saveProduct failed, falling back to mock:", err);
      }
    }

    const stored = localStorage.getItem('mock_productos');
    let products = stored ? JSON.parse(stored) : [];
    let savedProduct = { ...product };

    if (product.id) {
      products = products.map(p => p.id === product.id ? savedProduct : p);
    } else {
      savedProduct.id = "p_" + Date.now();
      products.push(savedProduct);
    }
    localStorage.setItem('mock_productos', JSON.stringify(products));
    if (!product.id) {
      await db.syncProductPriceListItems(savedProduct.id, savedProduct.precio);
    }
    return { success: true, data: savedProduct };
  },

  deleteProduct: async (productId) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { error } = await supabase
          .from('gst_productos')
          .delete()
          .eq('id', productId)
          .eq('business_id', businessId);
        if (!error) return { success: true };
      } catch (err) {
        console.warn("Supabase deleteProduct failed, falling back to mock:", err);
      }
    }
    const stored = localStorage.getItem('mock_productos');
    if (stored) {
      let products = JSON.parse(stored);
      products = products.filter(p => p.id !== productId);
      localStorage.setItem('mock_productos', JSON.stringify(products));
    }
    return { success: true };
  },

  recalculateClientSaldosFromMovements: async (clienteId = null) => {
    const businessId = await ensureBusinessContext();

    if (isSupabaseConfigured() && supabase) {
      let clientes = [];
      if (clienteId) {
        clientes = [{ id: clienteId }];
      } else {
        const { data, error: clientsErr } = await supabase
          .from('gst_clientes')
          .select('id')
          .eq('business_id', businessId);
        if (clientsErr) throw clientsErr;
        clientes = data || [];
      }

      let updated = 0;
      for (const cliente of clientes) {
        const { data: movs, error: movsErr } = await supabase
          .from('gst_cliente_movimientos')
          .select('debe, haber, fecha, concepto')
          .eq('business_id', businessId)
          .eq('cliente_id', cliente.id)
          .order('fecha', { ascending: true });
        if (movsErr) throw movsErr;

        const roundedSaldo = computeClientSaldoFromMovements(movs || []);

        const { error: updateErr } = await supabase
          .from('gst_clientes')
          .update({ saldo: roundedSaldo })
          .eq('id', cliente.id)
          .eq('business_id', businessId);
        if (updateErr) throw updateErr;
        updated += 1;
      }

      return { success: true, updatedClients: updated };
    }

    const storedClientes = localStorage.getItem('mock_clientes');
    const storedMovs = localStorage.getItem('mock_movimientos');
    let clientes = storedClientes ? JSON.parse(storedClientes) : [];
    const movements = storedMovs ? JSON.parse(storedMovs) : [];

    if (clienteId) {
      clientes = clientes.filter((c) => c.id === clienteId);
    }

    clientes = clientes.map((cliente) => {
      const clientMovs = movements
        .filter((m) => m.cliente_id === cliente.id)
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
      const saldo = computeClientSaldoFromMovements(clientMovs);
      return {
        ...cliente,
        saldo: Math.round((saldo + Number.EPSILON) * 100) / 100,
      };
    });

    localStorage.setItem('mock_clientes', JSON.stringify(clientes));
    return { success: true, updatedClients: clientes.length };
  },

  syncCuentaCorrienteFromFinalizedOrders: async (options = {}) => {
    const { skipAdminCheck = false } = options;
    if (!skipAdminCheck) {
      const adminCheck = await requireBusinessAdmin();
      if (!adminCheck.ok) throw new Error(adminCheck.error);
    }

    const businessId = await ensureBusinessContext();
    const { from, to, dayLabel, clienteId } = options;

    if (isSupabaseConfigured() && supabase) {
      let cleanupQuery = supabase
        .from('gst_cliente_movimientos')
        .delete()
        .eq('business_id', businessId)
        .ilike('concepto', 'Aplicación anticipo Pedido #%');
      if (clienteId) cleanupQuery = cleanupQuery.eq('cliente_id', clienteId);
      await cleanupQuery;

      let ordersQuery = supabase
        .from('gst_pedidos')
        .select('*')
        .eq('business_id', businessId);
      if (clienteId) ordersQuery = ordersQuery.eq('cliente_id', clienteId);
      const { data: orders, error: ordersErr } = await ordersQuery;
      if (ordersErr) throw ordersErr;

      let finalizedOrders = (orders || []).filter(
        (order) => isFinalizadoEstadoValue(order.estado) && !isCancelledEstadoValue(order.estado)
      );
      if (from && to) {
        finalizedOrders = finalizedOrders.filter((order) => isOrderWithinBounds(order, from, to));
      }

      let movsQuery = supabase
        .from('gst_cliente_movimientos')
        .select('*')
        .eq('business_id', businessId);
      if (clienteId) movsQuery = movsQuery.eq('cliente_id', clienteId);
      const { data: allMovements, error: movsErr } = await movsQuery;
      if (movsErr) throw movsErr;

      const movementsByClient = {};
      for (const mov of allMovements || []) {
        if (!movementsByClient[mov.cliente_id]) movementsByClient[mov.cliente_id] = [];
        movementsByClient[mov.cliente_id].push(mov);
      }

      const syncResult = await applyCuentaCorrienteSyncForOrders({
        finalizedOrders,
        businessId,
        movementsByClient,
        insertMovement: async (order, mov) => {
          const { error: insertErr } = await supabase.from('gst_cliente_movimientos').insert([{
            business_id: businessId,
            cliente_id: order.cliente_id,
            concepto: mov.concepto,
            debe: mov.debe,
            haber: mov.haber,
            fecha: mov.fecha,
          }]);
          if (insertErr) throw insertErr;
        },
        deleteMovement: async (movementId) => {
          const { error: deleteErr } = await supabase
            .from('gst_cliente_movimientos')
            .delete()
            .eq('id', movementId)
            .eq('business_id', businessId);
          if (deleteErr) throw deleteErr;
        },
      });

      const recalc = await db.recalculateClientSaldosFromMovements(clienteId || null);
      return {
        success: true,
        day: dayLabel || null,
        ...syncResult,
        updatedClients: recalc.updatedClients || 0,
      };
    }

    const storedOrders = localStorage.getItem('mock_pedidos');
    const storedMovs = localStorage.getItem('mock_movimientos');
    let orders = storedOrders ? JSON.parse(storedOrders) : [];
    let movements = storedMovs ? JSON.parse(storedMovs) : [];
    movements = movements.filter((m) => !String(m.concepto || '').startsWith('Aplicación anticipo Pedido #'));

    let finalizedOrders = orders.filter(
      (order) => isFinalizadoEstadoValue(order.estado) && !isCancelledEstadoValue(order.estado)
    );
    if (clienteId) {
      finalizedOrders = finalizedOrders.filter((order) => order.cliente_id === clienteId);
    }
    if (from && to) {
      finalizedOrders = finalizedOrders.filter((order) => isOrderWithinBounds(order, from, to));
    }

    const movementsByClient = {};
    for (const mov of movements) {
      if (!movementsByClient[mov.cliente_id]) movementsByClient[mov.cliente_id] = [];
      movementsByClient[mov.cliente_id].push(mov);
    }

    const syncResult = await applyCuentaCorrienteSyncForOrders({
      finalizedOrders,
      businessId,
      movementsByClient,
      insertMovement: async (order, mov) => {
        movements.push({
          id: `m_sync_${Date.now()}_${Math.random()}`,
          cliente_id: order.cliente_id,
          fecha: mov.fecha,
          concepto: mov.concepto,
          debe: mov.debe,
          haber: mov.haber,
        });
      },
      deleteMovement: async (movementId) => {
        movements = movements.filter((m) => m.id !== movementId);
      },
    });

    localStorage.setItem('mock_movimientos', JSON.stringify(movements));
    const recalc = await db.recalculateClientSaldosFromMovements(clienteId || null);

    return {
      success: true,
      day: dayLabel || null,
      ...syncResult,
      updatedClients: recalc.updatedClients || 0,
    };
  },

  syncCuentaCorrienteForDay: async (dayStr) => {
    const bounds = getArgentinaDayBounds(dayStr);
    return db.syncCuentaCorrienteFromFinalizedOrders({
      from: bounds.startIso,
      to: bounds.endIso,
      dayLabel: bounds.dayStr,
      skipAdminCheck: true,
    });
  },

  syncCuentaCorrienteForToday: async () => db.syncCuentaCorrienteForDay(),

  syncCuentaCorrienteForClient: async (clienteId) => {
    if (!clienteId) return { success: false, error: 'Cliente inválido.' };
    return db.syncCuentaCorrienteFromFinalizedOrders({
      clienteId,
      skipAdminCheck: true,
    });
  },

  clearAllPedidos: async () => {
    const adminCheck = await requireBusinessAdmin();
    if (!adminCheck.ok) throw new Error(adminCheck.error);

    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { error: itemsErr } = await supabase
          .from('gst_pedido_items')
          .delete()
          .eq('business_id', businessId);
        if (itemsErr) throw itemsErr;

        const { error: ordersErr } = await supabase
          .from('gst_pedidos')
          .delete()
          .eq('business_id', businessId);
        if (ordersErr) throw ordersErr;

        const { error: movsErr } = await supabase
          .from('gst_cliente_movimientos')
          .delete()
          .eq('business_id', businessId);
        if (movsErr) throw movsErr;

        const { error: clientsErr } = await supabase
          .from('gst_clientes')
          .update({ saldo: 0 })
          .eq('business_id', businessId);
        if (clientsErr) throw clientsErr;

        return { success: true };
      } catch (err) {
        console.error("Supabase clearAllPedidos error:", err);
        throw err;
      }
    }

    // Mock Fallback
    localStorage.setItem('mock_pedidos', JSON.stringify([]));
    localStorage.setItem('mock_movimientos', JSON.stringify([]));

    const storedClientes = localStorage.getItem('mock_clientes');
    let clientes = storedClientes ? JSON.parse(storedClientes) : [];
    clientes = clientes.map(c => ({ ...c, saldo: 0 }));
    localStorage.setItem('mock_clientes', JSON.stringify(clientes));

    return { success: true };
  },

  resetAllClientSaldos: async () => {
    const adminCheck = await requireBusinessAdmin();
    if (!adminCheck.ok) throw new Error(adminCheck.error);

    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { error: movsErr } = await supabase
          .from('gst_cliente_movimientos')
          .delete()
          .eq('business_id', businessId);
        if (movsErr) throw movsErr;

        const { error: clientsErr } = await supabase
          .from('gst_clientes')
          .update({ saldo: 0 })
          .eq('business_id', businessId);
        if (clientsErr) throw clientsErr;

        return { success: true };
      } catch (err) {
        console.error('Supabase resetAllClientSaldos error:', err);
        throw err;
      }
    }

    localStorage.setItem('mock_movimientos', JSON.stringify([]));
    const storedClientes = localStorage.getItem('mock_clientes');
    let clientes = storedClientes ? JSON.parse(storedClientes) : [];
    clientes = clientes.map((c) => ({ ...c, saldo: 0 }));
    localStorage.setItem('mock_clientes', JSON.stringify(clientes));

    return { success: true };
  },

  clearAllCompras: async () => {
    const adminCheck = await requireBusinessAdmin();
    if (!adminCheck.ok) throw new Error(adminCheck.error);

    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { error } = await supabase
          .from('gst_compras')
          .delete()
          .eq('business_id', businessId);
        if (error) throw error;
        return { success: true };
      } catch (err) {
        console.error("Supabase clearAllCompras error:", err);
        throw err;
      }
    }

    // Mock Fallback
    localStorage.setItem('mock_compras', JSON.stringify([]));
    return { success: true };
  },

  clearClienteMovimientos: async (clienteId) => {
    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { error: movsErr } = await supabase
          .from('gst_cliente_movimientos')
          .delete()
          .eq('business_id', businessId)
          .eq('cliente_id', clienteId);
        if (movsErr) throw movsErr;

        const { data: updatedClient, error: clientErr } = await supabase
          .from('gst_clientes')
          .update({ saldo: 0 })
          .eq('id', clienteId)
          .eq('business_id', businessId)
          .select()
          .single();
        if (clientErr) throw clientErr;

        return { success: true, data: updatedClient };
      } catch (err) {
        console.error("Supabase clearClienteMovimientos error:", err);
        throw err;
      }
    }

    // Mock Fallback
    const storedMovs = localStorage.getItem('mock_movimientos');
    let movements = storedMovs ? JSON.parse(storedMovs) : [];
    movements = movements.filter(m => m.cliente_id !== clienteId);
    localStorage.setItem('mock_movimientos', JSON.stringify(movements));

    const storedClientes = localStorage.getItem('mock_clientes');
    let clientes = storedClientes ? JSON.parse(storedClientes) : [];
    let updatedClientObj = null;
    clientes = clientes.map(c => {
      if (c.id === clienteId) {
        updatedClientObj = { ...c, saldo: 0 };
        return updatedClientObj;
      }
      return c;
    });
    localStorage.setItem('mock_clientes', JSON.stringify(clientes));

    return { success: true, data: updatedClientObj };
  },

  /** Borra movimientos legacy "Reversión …" y recalcula saldos. */
  purgeReversionMovements: async () => {
    const adminCheck = await requireBusinessAdmin();
    if (!adminCheck.ok) throw new Error(adminCheck.error);

    const businessId = await ensureBusinessContext();

    if (isSupabaseConfigured() && supabase) {
      const { data: toDelete, error: previewErr } = await supabase
        .from('gst_cliente_movimientos')
        .select('id')
        .eq('business_id', businessId)
        .ilike('concepto', '%reversi%');
      if (previewErr) throw previewErr;

      const ids = (toDelete || []).map((row) => row.id);
      if (ids.length === 0) {
        return { success: true, deleted: 0, updatedClients: 0 };
      }

      const { error: deleteErr } = await supabase
        .from('gst_cliente_movimientos')
        .delete()
        .eq('business_id', businessId)
        .ilike('concepto', '%reversi%');
      if (deleteErr) throw deleteErr;

      const recalc = await db.recalculateClientSaldosFromMovements();
      return {
        success: true,
        deleted: ids.length,
        updatedClients: recalc.updatedClients || 0,
      };
    }

    const storedMovs = localStorage.getItem('mock_movimientos');
    let movements = storedMovs ? JSON.parse(storedMovs) : [];
    const before = movements.length;
    movements = movements.filter(
      (m) => !String(m.concepto || '').toLowerCase().includes('reversi')
    );
    localStorage.setItem('mock_movimientos', JSON.stringify(movements));

    const recalc = await db.recalculateClientSaldosFromMovements();
    return {
      success: true,
      deleted: before - movements.length,
      updatedClients: recalc.updatedClients || 0,
    };
  },

  getComprasCategorias: async () => {
    const businessId = getBusinessId();
    const defaultCats = DEFAULT_COMPRAS_CATEGORIES;
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_configs')
          .select('value')
          .eq('business_id', businessId)
          .eq('key', 'compras_categorias')
          .maybeSingle();
        if (!error && data?.value) {
          return normalizeComprasCategories(data.value, { mergeDefaults: false });
        }
      } catch (err) {
        console.warn("Supabase getComprasCategorias failed:", err);
      }
    }
    const stored = localStorage.getItem('compras_categorias');
    return normalizeComprasCategories(stored ? JSON.parse(stored) : defaultCats, { mergeDefaults: false });
  },

  saveComprasCategorias: async (list) => {
    const result = isSupabaseConfigured() && supabase
      ? await saveBusinessConfig('compras_categorias', list)
      : { ok: true };
    if (!result.ok) return { success: false, error: result.error };
    localStorage.setItem('compras_categorias', JSON.stringify(list));
    return { success: true };
  },

  getComprasConceptos: async () => {
    const businessId = getBusinessId();
    const defaultConcepts = createDefaultComprasConceptos();
    let categories = DEFAULT_COMPRAS_CATEGORIES;

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_configs')
          .select('value')
          .eq('business_id', businessId)
          .eq('key', 'compras_categorias')
          .maybeSingle();
        if (!error && data?.value) categories = data.value;
      } catch (err) {
        console.warn("Supabase getComprasConceptos categories failed:", err);
      }
    } else {
      const storedCats = localStorage.getItem('compras_categorias');
      if (storedCats) categories = JSON.parse(storedCats);
    }

    const fromCategories = flattenComprasConceptosFromCategories(categories);
    if (fromCategories.length > 0) return fromCategories;

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_configs')
          .select('value')
          .eq('business_id', businessId)
          .eq('key', 'compras_conceptos')
          .maybeSingle();
        if (!error && data?.value?.length) return data.value;
      } catch (err) {
        console.warn("Supabase getComprasConceptos failed:", err);
      }
    }

    const stored = localStorage.getItem('compras_conceptos');
    return stored ? JSON.parse(stored) : defaultConcepts;
  },

  saveComprasConceptos: async (list) => {
    const result = isSupabaseConfigured() && supabase
      ? await saveBusinessConfig('compras_conceptos', list)
      : { ok: true };
    if (!result.ok) return { success: false, error: result.error };
    localStorage.setItem('compras_conceptos', JSON.stringify(list));
    return { success: true };
  },

  getComprasFormasPago: async () => {
    const businessId = getBusinessId();
    const defaultPayments = DEFAULT_COMPRAS_FORMAS_PAGO;
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_configs')
          .select('value')
          .eq('business_id', businessId)
          .eq('key', 'compras_formas_pago')
          .maybeSingle();
        if (!error && data) return data.value;
      } catch (err) {
        console.warn("Supabase getComprasFormasPago failed:", err);
      }
    }
    const stored = localStorage.getItem('compras_formas_pago');
    return stored ? JSON.parse(stored) : defaultPayments;
  },

  saveComprasFormasPago: async (list) => {
    const result = isSupabaseConfigured() && supabase
      ? await saveBusinessConfig('compras_formas_pago', list)
      : { ok: true };
    if (!result.ok) return { success: false, error: result.error };
    localStorage.setItem('compras_formas_pago', JSON.stringify(list));
    return { success: true };
  },

  // --- USER MANAGEMENT & PERMISSIONS ---
  getProfiles: async () => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_profiles')
          .select('*')
          .eq('business_id', businessId);
        if (error) throw error;
        return data || [];
      } catch (err) {
        console.error("Error fetching profiles:", err);
      }
    }
    return [];
  },

  updateProfilePermissions: async (profileId, updates) => {
    const businessId = await ensureBusinessContext();
    const adminCheck = await requireBusinessAdmin();
    if (!adminCheck.ok) return { success: false, error: adminCheck.error };

    if (updates?.role) {
      const roleError = rejectAdminRoleAssignment(updates.role);
      if (roleError) return { success: false, error: roleError };
    }

    if (isSupabaseConfigured() && supabase) {
      try {
        const { error } = await supabase
          .from('gst_profiles')
          .update(updates)
          .eq('id', profileId)
          .eq('business_id', businessId);
        if (error) throw error;
        return { success: true };
      } catch (err) {
        console.error("Error updating profile:", err);
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: "Not configured" };
  },

  createEmployeeUser: async (email, password, fullName, role, employeeId) => {
    const adminCheck = await requireBusinessAdmin();
    if (!adminCheck.ok) return { success: false, error: adminCheck.error };

    const roleError = rejectAdminRoleAssignment(role);
    if (roleError) return { success: false, error: roleError };

    const businessId = await ensureBusinessContext();
    if (!businessId || INVALID_BUSINESS_ID.includes(String(businessId))) {
      return { success: false, error: 'Empresa no configurada' };
    }

    const { url, key } = getCredentials();
    if (!url || !key) return { success: false, error: 'Supabase not configured' };

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      return { success: false, error: 'Email y contraseña son obligatorios' };
    }

    try {
      const tempSupabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data, error } = await tempSupabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            full_name: fullName,
            business_id: businessId,
            role: role || 'cajero',
            employee_id: employeeId,
          },
        },
      });

      if (error) throw error;
      if (!data.user) throw new Error('No se pudo crear el usuario de acceso');

      if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('Este correo ya está registrado. Usá otro email.');
      }

      const profilePayload = {
        id: data.user.id,
        business_id: businessId,
        employee_id: employeeId,
        full_name: fullName,
        role: role || 'cajero',
        assigned_cajas: [],
      };

      const { error: rpcError } = await supabase.rpc('gst_create_employee_profile', {
        p_user_id: data.user.id,
        p_employee_id: employeeId,
        p_full_name: fullName,
        p_role: role || 'cajero',
        p_assigned_cajas: [],
      });

      if (rpcError) {
        console.warn('gst_create_employee_profile RPC failed, trying direct insert:', rpcError.message);
        const { error: profError } = await supabase.from('gst_profiles').insert([profilePayload]);
        if (profError) {
          throw new Error(
            profError.message.includes('employee_id')
              ? 'Falta migrar la base: ejecutá migrate_gst_profiles_employee.sql en Supabase.'
              : profError.message
          );
        }
      }

      return {
        success: true,
        user: data.user,
        needsEmailConfirmation: !data.session,
      };
    } catch (err) {
      console.error('Error creating employee user:', err);
      return { success: false, error: err.message || 'No se pudo crear el acceso del empleado' };
    }
  },



  updateEmployeeAccess: async (employeeId, role, assignedCajas) => {
    const businessId = await ensureBusinessContext();
    const adminCheck = await requireBusinessAdmin();
    if (!adminCheck.ok) return { success: false, error: adminCheck.error };

    const roleError = rejectAdminRoleAssignment(role);
    if (roleError) return { success: false, error: roleError };

    if (isSupabaseConfigured() && supabase) {
      try {
        const { error } = await supabase
          .from('gst_profiles')
          .update({
            role: role,
            assigned_cajas: assignedCajas
          })
          .eq('employee_id', employeeId)
          .eq('business_id', businessId);
        if (error) throw error;
        return { success: true };
      } catch (err) {
        console.error("Error updating employee access:", err);
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: "Not configured" };
  },

  saveEmpleadoMovimiento: async (mov) => {
    const businessId = getBusinessId();
    const identity = await resolveEmpleadoMovimientoIdentity(mov);
    if (identity.error) {
      return { success: false, error: identity.error };
    }

    if (isSupabaseConfigured() && supabase) {
      try {
        const payload = {
          business_id: businessId,
          empleado_id: identity.empleadoId,
          empleado: identity.empleadoNombre,
          concepto: mov.concepto,
          monto: parseFloat(mov.debe || mov.haber || mov.monto || 0),
          fecha: mov.fecha || new Date().toISOString(),
        };

        const { error } = await supabase
          .from('gst_empleado_movimientos')
          .insert(payload);
        if (error) throw error;
        return { success: true };
      } catch (err) {
        console.error('Error saving employee movement:', err);
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: 'Not configured' };
  },

  // --- PROVIDERS CTA CTE ---
  getProveedoresSaldos: async () => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        // Fetch all purchases that are 'Cuenta Corriente'
        const { data: compras, error: errC } = await supabase
          .from('gst_compras')
          .select('proveedor, total')
          .eq('business_id', businessId)
          .eq('pago', 'Cuenta Corriente');
        
        if (errC) throw errC;

        // Fetch all payments to providers
        const { data: pagos, error: errP } = await supabase
          .from('gst_proveedor_pagos')
          .select('proveedor_nombre, monto')
          .eq('business_id', businessId);
        
        if (errP) throw errP;

        // Calculate balances
        const saldos = {};
        (compras || []).forEach(c => {
          const prov = c.proveedor;
          if (!saldos[prov]) saldos[prov] = 0;
          saldos[prov] += parseFloat(c.total || 0);
        });

        (pagos || []).forEach(p => {
          const prov = p.proveedor_nombre;
          if (!saldos[prov]) saldos[prov] = 0;
          saldos[prov] -= parseFloat(p.monto || 0);
        });

        const lista = Object.keys(saldos).map(nombre => ({
          nombre,
          saldo: saldos[nombre]
        })).sort((a, b) => b.saldo - a.saldo);

        const totalGlobal = lista.reduce((acc, curr) => acc + (curr.saldo > 0 ? curr.saldo : 0), 0);

        return { listaSaldos: lista, totalGlobalDeuda: totalGlobal };
      } catch (err) {
        console.error("Error fetching provider balances:", err);
        return { error: err.message, listaSaldos: [], totalGlobalDeuda: 0 };
      }
    }
    return { listaSaldos: [], totalGlobalDeuda: 0 };
  },

  getHistorialProveedor: async (nombreProveedor) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const [comprasRes, pagosRes] = await Promise.all([
          supabase.from('gst_compras')
            .select('*')
            .eq('business_id', businessId)
            .eq('proveedor', nombreProveedor)
            .eq('pago', 'Cuenta Corriente'),
          supabase.from('gst_proveedor_pagos')
            .select('*')
            .eq('business_id', businessId)
            .eq('proveedor_nombre', nombreProveedor)
        ]);

        if (comprasRes.error) throw comprasRes.error;
        if (pagosRes.error) throw pagosRes.error;

        const transacciones = [];
        (comprasRes.data || []).forEach(c => {
          transacciones.push({
            fecha: c.fecha,
            detalle: c.detalle || "Compra a CC",
            monto: parseFloat(c.total || 0),
            tipo: 'DEUDA',
            orden: 1
          });
        });

        (pagosRes.data || []).forEach(p => {
          transacciones.push({
            fecha: p.fecha_registro,
            detalle: `Pago (${p.medio_pago || 'S/D'})`,
            monto: -parseFloat(p.monto || 0),
            tipo: 'PAGO',
            orden: 2
          });
        });

        transacciones.sort((a, b) => {
          const dA = new Date(a.fecha);
          const dB = new Date(b.fecha);
          if (dA - dB !== 0) return dA - dB;
          return a.orden - b.orden;
        });

        let saldoAcumulado = 0;
        const movimientos = transacciones.map(m => {
          saldoAcumulado += m.monto;
          return {
            ...m,
            saldo: saldoAcumulado
          };
        }).reverse();

        return { movimientos, total: saldoAcumulado };
      } catch (err) {
        console.error("Error fetching provider history:", err);
        return { error: err.message };
      }
    }
    return { error: "Not configured" };
  },

  saveProveedorPago: async (pago) => {
    const businessId = getBusinessId();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { error } = await supabase
          .from('gst_proveedor_pagos')
          .insert({ ...pago, business_id: businessId });
        if (error) throw error;
        return { success: true };
      } catch (err) {
        console.error("Error saving provider payment:", err);
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: "Not configured" };
  },

  uploadInvoice: async (file, fileName) => {
    const businessId = getBusinessId();
    if (!isSupabaseConfigured() || !supabase) return { error: "Supabase not configured" };

    try {
      const filePath = `${businessId}/${fileName}`;
      const buckets = ['gst_invoices', 'invoices'];
      let usedBucket = null;
      let lastError = null;

      for (const bucket of buckets) {
        const { error } = await supabase.storage.from(bucket).upload(filePath, file, { upsert: true });
        if (!error) {
          usedBucket = bucket;
          break;
        }
        lastError = error;
      }

      if (!usedBucket) throw lastError;

      const { data: { publicUrl } } = supabase.storage.from(usedBucket).getPublicUrl(filePath);
      return { publicUrl };
    } catch (err) {
      console.error("Error uploading to storage:", err);
      return { error: err.message };
    }
  },

  getBusinessFiscalConfig: async () => {
    const stored = await getBusinessConfig(BUSINESS_FISCAL_CONFIG_KEY);
    if (stored?.condicion) return stored;
    return { condicion: 'responsable_inscripto' };
  },

  saveBusinessFiscalConfig: async (condicion) =>
    saveBusinessConfig(BUSINESS_FISCAL_CONFIG_KEY, { condicion }),

  seedBusinessDefaults: async ({ isMonotributo = false } = {}) => {
    const businessId = await ensureBusinessContext();
    if (!isSupabaseConfigured() || !supabase || !businessId || INVALID_BUSINESS_ID.includes(String(businessId))) {
      return { success: false, error: 'Empresa no configurada' };
    }

    const defaults = buildNewBusinessDefaults({ isMonotributo });

    try {
      await Promise.all([
        db.saveModules(defaults.modules),
        db.saveCierreTurnos(getCierreTurnoNames(defaults.cierreTurnos)),
        db.saveCierreConceptos(defaults.cierreMedios),
        db.saveComprasCategorias(defaults.comprasCategorias),
        db.saveComprasFormasPago(defaults.comprasFormasPago),
        db.saveRolePermissions(defaults.rolePermissions),
        db.savePedidosCajasConfig(defaults.pedidosCajas),
      ]);

      localStorage.setItem('rendiciones_config', JSON.stringify(defaults.rendiciones));
      localStorage.setItem('whatsapp_template', defaults.whatsappTemplate);

      await db.seedDefaultPeriodicPayments({ isMonotributo });

      return { success: true };
    } catch (err) {
      console.error('[Gestion360i] seedBusinessDefaults:', err);
      return { success: false, error: err.message };
    }
  },

  seedDefaultPeriodicPayments: async ({ isMonotributo = false } = {}) => {
    const businessId = await ensureBusinessContext();
    if (!isSupabaseConfigured() || !supabase || !businessId || INVALID_BUSINESS_ID.includes(String(businessId))) {
      return { success: false, error: 'Empresa no configurada' };
    }

    try {
      let existing = await db.getPagosPeriodicos();
      existing = (Array.isArray(existing) ? existing : []).map(normalizePeriodicPayment);

      for (let i = 0; i < DEFAULT_PERIODIC_CONCEPTS.length; i++) {
        const concept = DEFAULT_PERIODIC_CONCEPTS[i];
        const payload = buildPeriodicPaymentFromConcept(concept, isMonotributo, i);
        const found = findExistingPeriodicItem(existing, concept.sg, concept.nombre);

        if (found) {
          if (found.activo === false) {
            const res = await db.savePagoPeriodico({ ...found, activo: true });
            if (!res.success) {
              console.error(`No se pudo reactivar ${concept.nombre}:`, res.error);
            }
          }
          continue;
        }

        const res = await db.savePagoPeriodico(payload);
        if (!res.success) {
          console.error(`No se pudo crear ${concept.nombre}:`, res.error);
        } else if (res.data) {
          existing.push(normalizePeriodicPayment(res.data));
        }
      }

      return { success: true };
    } catch (err) {
      console.error('[Gestion360i] seedDefaultPeriodicPayments:', err);
      return { success: false, error: err.message };
    }
  },

  // PAGOS PERIÓDICOS
  getPagosPeriodicos: async () => {
    let businessId = await ensureBusinessContext();
    if (!businessId || INVALID_BUSINESS_ID.includes(String(businessId))) {
      console.warn('[Gestion360i] getPagosPeriodicos: business_id no disponible');
      return [];
    }

    businessId = await repairPagosPeriodicosBusinessId(businessId);

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_pagos_periodicos')
          .select('*')
          .eq('business_id', businessId);

        if (error) {
          console.error('[Gestion360i] getPagosPeriodicos:', error.message, { businessId });
          return [];
        }

        return (data || [])
          .filter((item) => item.activo !== false)
          .sort((a, b) => {
            const subgroupCompare = String(a.subgrupo || '').localeCompare(String(b.subgrupo || ''));
            if (subgroupCompare !== 0) return subgroupCompare;
            const orderCompare = (a.orden || 0) - (b.orden || 0);
            if (orderCompare !== 0) return orderCompare;
            return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');
          });
      } catch (err) {
        console.warn('Supabase getPagosPeriodicos failed:', err);
      }
    }
    return [];
  },

  savePagoPeriodico: async (pago) => {
    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('gst_pagos_periodicos')
          .upsert({ ...pago, business_id: businessId })
          .select();
        if (error) throw error;
        return { success: true, data: data[0] };
      } catch (err) {
        console.error("Error saving periodic payment:", err);
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: "Not configured" };
  },

  deletePagoPeriodico: async (id) => {
    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { error } = await supabase
          .from('gst_pagos_periodicos')
          .delete()
          .eq('id', id)
          .eq('business_id', businessId);
        if (error) throw error;
        return { success: true };
      } catch (err) {
        console.error("Error deleting periodic payment:", err);
        return { success: false, error: err.message };
      }
    }
    return { success: false };
  },

  updatePagoPeriodicoStatus: async (id, updates) => {
    const businessId = await ensureBusinessContext();
    if (isSupabaseConfigured() && supabase) {
      try {
        const { error } = await supabase
          .from('gst_pagos_periodicos')
          .update(updates)
          .eq('id', id)
          .eq('business_id', businessId);
        if (error) throw error;
        return { success: true };
      } catch (err) {
        console.error("Error updating periodic payment status:", err);
        return { success: false, error: err.message };
      }
    }
    return { success: false };
  },

  updatePagosOrden: async (pagos) => {
    if (isSupabaseConfigured() && supabase) {
      try {
        const { error } = await supabase
          .from('gst_pagos_periodicos')
          .upsert(pagos);
        if (error) throw error;
        return { success: true };
      } catch (err) {
        console.error("Error updating payments order:", err);
        return { success: false, error: err.message };
      }
    }
    return { success: false };
  }
};
