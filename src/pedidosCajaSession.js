import { setActiveCaja, isFinalizedPedidoEstado } from './cierreTurnos';
import { PEDIDOS_CAJA_TIPOS } from './pedidosCajas';

export const OPEN_CAJA_SESSION_KEYS = {
  [PEDIDOS_CAJA_TIPOS.DELIVERY]: 'gst_open_delivery_caja',
  [PEDIDOS_CAJA_TIPOS.LOCAL]: 'gst_open_local_caja',
};

/** @deprecated use OPEN_CAJA_SESSION_KEYS.delivery */
export const OPEN_DELIVERY_CAJA_KEY = OPEN_CAJA_SESSION_KEYS[PEDIDOS_CAJA_TIPOS.DELIVERY];
/** @deprecated use OPEN_CAJA_SESSION_KEYS.local */
export const OPEN_LOCAL_CAJA_KEY = OPEN_CAJA_SESSION_KEYS[PEDIDOS_CAJA_TIPOS.LOCAL];

const isOrderCancelled = (order) => {
  const est = String(order?.estado || '').toLowerCase().trim();
  return est === 'cancelado' || est === 'cancelada' || est === 'cancelled';
};

const isSameLocalDay = (dateStr, referenceDate = new Date()) => {
  if (!dateStr) return false;
  const orderDate = new Date(dateStr);
  return orderDate.getDate() === referenceDate.getDate()
    && orderDate.getMonth() === referenceDate.getMonth()
    && orderDate.getFullYear() === referenceDate.getFullYear();
};

export const isBeforeLocalDay = (dateStr, referenceDate = new Date()) => {
  if (!dateStr) return false;
  const orderDate = new Date(dateStr);
  const ref = new Date(referenceDate);
  orderDate.setHours(0, 0, 0, 0);
  ref.setHours(0, 0, 0, 0);
  return orderDate.getTime() < ref.getTime();
};

export const getStaleLocalOrdersToFinalize = (orders, referenceDate = new Date()) =>
  (orders || []).filter((order) => {
    if (order?.con_envio || isOrderCancelled(order)) return false;
    if (isFinalizedPedidoEstado(order.estado)) return false;
    return isBeforeLocalDay(order.fecha, referenceDate);
  });

export const STALE_LOCAL_BLOCKING_DELIVERY_MSG =
  'Hay pedidos anteriores pendientes de finalización, completelos antes de Abrir la caja';

export const getDeliveryOpenBlockReason = (orders, localCajas) => {
  if ((localCajas || []).length > 0) return '';
  if (getStaleLocalOrdersToFinalize(orders).length === 0) return '';
  return STALE_LOCAL_BLOCKING_DELIVERY_MSG;
};

const orderMatchesTipo = (order, tipo) => (
  tipo === PEDIDOS_CAJA_TIPOS.DELIVERY ? order?.con_envio === true : !order?.con_envio
);

export const getOpenCajaSession = (tipo) => {
  const key = OPEN_CAJA_SESSION_KEYS[tipo];
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const turnoName = String(parsed?.turnoName || '').trim();
    if (!turnoName) return null;
    return {
      turnoName,
      openedAt: parsed.openedAt || null,
    };
  } catch {
    return null;
  }
};

export const getOpenCajaName = (tipo) => getOpenCajaSession(tipo)?.turnoName || '';

export const isCajaOpen = (tipo) => !!getOpenCajaName(tipo);

export const openCaja = (tipo, turnoName) => {
  const key = OPEN_CAJA_SESSION_KEYS[tipo];
  const name = String(turnoName || '').trim();
  if (!key || !name) return null;
  const session = { turnoName: name, openedAt: new Date().toISOString() };
  localStorage.setItem(key, JSON.stringify(session));
  setActiveCaja(tipo, name);
  return session;
};

export const closeCaja = (tipo) => {
  const key = OPEN_CAJA_SESSION_KEYS[tipo];
  if (!key) return;
  localStorage.removeItem(key);
  setActiveCaja(tipo, null);
};

export const syncOpenCajaWithConfig = (tipo, cajas) => {
  const session = getOpenCajaSession(tipo);
  if (!session) return '';
  if (!cajas.includes(session.turnoName)) {
    closeCaja(tipo);
    return '';
  }
  return session.turnoName;
};

export const getTodayOrdersForTipo = (orders, tipo) =>
  (orders || []).filter((order) => {
    if (isOrderCancelled(order) || !orderMatchesTipo(order, tipo)) return false;
    return isSameLocalDay(order.fecha);
  });

const orderBelongsToOpenCaja = (order, turnoName) => {
  const caja = String(order.turno_caja || '').trim();
  if (caja) return caja === String(turnoName || '').trim();
  return true;
};

export const getTodayOrdersForCaja = (orders, tipo, turnoName) =>
  getTodayOrdersForTipo(orders, tipo).filter((order) =>
    orderBelongsToOpenCaja(order, turnoName)
  );

export const countNonFinalizedOrdersForCaja = (orders, tipo, turnoName) =>
  getTodayOrdersForCaja(orders, tipo, turnoName).filter(
    (order) => !isFinalizedPedidoEstado(order.estado)
  ).length;

export const canCloseCaja = (orders, tipo, turnoName) => {
  if (!turnoName) return false;
  return countNonFinalizedOrdersForCaja(orders, tipo, turnoName) === 0;
};

export const inferCajaFromTodayOrders = (orders, tipo, cajas) => {
  const eligible = (cajas || []).filter(Boolean);
  if (!eligible.length) return '';

  const todayOrders = getTodayOrdersForTipo(orders, tipo);
  if (!todayOrders.length) return '';

  const counts = {};
  todayOrders.forEach((order) => {
    const name = String(order.turno_caja || '').trim();
    if (!name || !eligible.includes(name)) return;
    counts[name] = (counts[name] || 0) + 1;
  });

  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (ranked.length > 0) return ranked[0][0];

  if (eligible.length === 1) return eligible[0];
  return eligible[0] || '';
};

export const shouldAutoOpenCaja = (orders, tipo, cajas) => {
  if (!cajas?.length || getOpenCajaName(tipo)) return false;
  const todayOrders = getTodayOrdersForTipo(orders, tipo);
  if (!todayOrders.length) return false;
  return todayOrders.some((order) => !isFinalizedPedidoEstado(order.estado));
};

export const autoOpenCajaFromOrders = (orders, tipo, cajas) => {
  const eligible = (cajas || []).filter(Boolean);
  if (!eligible.length) return '';

  const current = syncOpenCajaWithConfig(tipo, eligible);
  if (current) return current;

  if (!shouldAutoOpenCaja(orders, tipo, eligible)) return '';

  const toOpen = inferCajaFromTodayOrders(orders, tipo, eligible);
  if (!toOpen) return '';

  openCaja(tipo, toOpen);
  return toOpen;
};

export const resolveCajaForNewPedido = ({
  tipo,
  cajas,
  selectedCajaToOpen,
  tipoLabel,
}) => {
  const eligible = (cajas || []).filter(Boolean);
  const label = tipoLabel || (tipo === PEDIDOS_CAJA_TIPOS.DELIVERY ? 'Delivery' : 'Local');

  if (!eligible.length) {
    return { turnoName: '', error: `Configurá una caja ${label} en Configuración → Pedidos.` };
  }

  const current = syncOpenCajaWithConfig(tipo, eligible);
  if (current) return { turnoName: current, error: '' };

  const toOpen = eligible.length === 1
    ? eligible[0]
    : String(selectedCajaToOpen || '').trim();

  if (!toOpen) {
    return { turnoName: '', error: `Seleccioná la caja ${label.toLowerCase()} para abrir.` };
  }
  if (!eligible.includes(toOpen)) {
    return { turnoName: '', error: `La caja ${label.toLowerCase()} seleccionada ya no está configurada.` };
  }

  openCaja(tipo, toOpen);
  return { turnoName: toOpen, error: '' };
};

// --- Backward-compatible delivery aliases ---
export const getOpenDeliveryCajaSession = () => getOpenCajaSession(PEDIDOS_CAJA_TIPOS.DELIVERY);
export const getOpenDeliveryCajaName = () => getOpenCajaName(PEDIDOS_CAJA_TIPOS.DELIVERY);
export const isDeliveryCajaOpen = () => isCajaOpen(PEDIDOS_CAJA_TIPOS.DELIVERY);
export const openDeliveryCaja = (turnoName) => openCaja(PEDIDOS_CAJA_TIPOS.DELIVERY, turnoName);
export const closeDeliveryCaja = () => closeCaja(PEDIDOS_CAJA_TIPOS.DELIVERY);
export const syncOpenDeliveryCajaWithConfig = (cajas) =>
  syncOpenCajaWithConfig(PEDIDOS_CAJA_TIPOS.DELIVERY, cajas);
export const getTodayDeliveryOrders = (orders) =>
  getTodayOrdersForTipo(orders, PEDIDOS_CAJA_TIPOS.DELIVERY);
export const getTodayDeliveryOrdersForCaja = (orders, turnoName) =>
  getTodayOrdersForCaja(orders, PEDIDOS_CAJA_TIPOS.DELIVERY, turnoName);
export const getDeliveryOrdersForCaja = (orders, turnoName) =>
  getTodayOrdersForCaja(orders, PEDIDOS_CAJA_TIPOS.DELIVERY, turnoName);
export const countNonFinalizedDeliveryOrdersForCaja = (orders, turnoName) =>
  countNonFinalizedOrdersForCaja(orders, PEDIDOS_CAJA_TIPOS.DELIVERY, turnoName);
export const canCloseDeliveryCaja = (orders, turnoName) =>
  canCloseCaja(orders, PEDIDOS_CAJA_TIPOS.DELIVERY, turnoName);
export const inferDeliveryCajaFromTodayOrders = (orders, cajas) =>
  inferCajaFromTodayOrders(orders, PEDIDOS_CAJA_TIPOS.DELIVERY, cajas);
export const shouldAutoOpenDeliveryCaja = (orders, cajas) =>
  shouldAutoOpenCaja(orders, PEDIDOS_CAJA_TIPOS.DELIVERY, cajas);
export const autoOpenDeliveryCajaFromOrders = (orders, cajas) =>
  autoOpenCajaFromOrders(orders, PEDIDOS_CAJA_TIPOS.DELIVERY, cajas);
export const resolveDeliveryCajaForNewPedido = ({
  deliveryCajas,
  selectedCajaToOpen,
  orders,
  localCajas,
}) => {
  const blockReason = getDeliveryOpenBlockReason(orders, localCajas);
  if (blockReason) return { turnoName: '', error: blockReason };

  return resolveCajaForNewPedido({
    tipo: PEDIDOS_CAJA_TIPOS.DELIVERY,
    cajas: deliveryCajas,
    selectedCajaToOpen,
    tipoLabel: 'Delivery',
  });
};
