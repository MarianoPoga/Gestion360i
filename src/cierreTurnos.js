import { getActiveMedios } from './cierreMedios';

export const DEFAULT_CIERRE_TURNOS = [
  { name: 'Mañana', pedidosDelivery: false, pedidosLocal: true },
  { name: 'Tarde', pedidosDelivery: false, pedidosLocal: true },
  { name: 'Delivery', pedidosDelivery: true, pedidosLocal: false },
  { name: 'Noche', pedidosDelivery: false, pedidosLocal: true },
];

export const ACTIVE_CAJA_STORAGE_KEY = 'gst_active_cajas';

export const getTurnoName = (turno) => {
  if (!turno) return '';
  if (typeof turno === 'string') return turno.trim();
  return String(turno.name || '').trim();
};

export const inferTurnoFlagsFromName = (name) => {
  const lower = String(name || '').trim().toLowerCase();
  if (lower.includes('delivery')) {
    return { pedidosDelivery: true, pedidosLocal: false };
  }
  return { pedidosDelivery: false, pedidosLocal: true };
};

export const normalizeCierreTurno = (item) => {
  if (typeof item === 'string') {
    const name = item.trim();
    if (!name) return null;
    return { name, ...inferTurnoFlagsFromName(name) };
  }
  if (!item || typeof item !== 'object') return null;
  const name = String(item.name || '').trim();
  if (!name) return null;
  const inferred = inferTurnoFlagsFromName(name);
  return {
    name,
    pedidosDelivery: item.pedidosDelivery === true
      || (item.pedidosDelivery !== false && inferred.pedidosDelivery),
    pedidosLocal: item.pedidosLocal === true
      || (item.pedidosLocal !== false && inferred.pedidosLocal),
  };
};

export const normalizeCierreTurnos = (raw) => {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_CIERRE_TURNOS.map((t) => ({ ...t }));
  }
  const normalized = raw.map(normalizeCierreTurno).filter(Boolean);
  return normalized.length > 0 ? normalized : DEFAULT_CIERRE_TURNOS.map((t) => ({ ...t }));
};

export const getCierreTurnoNames = (turnos) =>
  normalizeCierreTurnos(turnos).map((t) => t.name);

export const getTurnosForPedidoTipo = (turnos, pedidoTipo) =>
  normalizeCierreTurnos(turnos).filter((t) => (
    pedidoTipo === 'delivery' ? t.pedidosDelivery : t.pedidosLocal
  ));

export const getActiveCajas = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVE_CAJA_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const setActiveCaja = (pedidoTipo, turnoName) => {
  const current = getActiveCajas();
  const next = { ...current, [pedidoTipo]: turnoName || null };
  if (!turnoName) delete next[pedidoTipo];
  localStorage.setItem(ACTIVE_CAJA_STORAGE_KEY, JSON.stringify(next));
  return next;
};

export const resolveActiveCajaForTipo = (turnos, pedidoTipo) => {
  const eligible = getTurnosForPedidoTipo(turnos, pedidoTipo);
  if (!eligible.length) return '';
  const active = getActiveCajas()[pedidoTipo];
  if (active && eligible.some((t) => t.name === active)) return active;
  return eligible[0].name;
};

export const buildCajaCierreLabel = (fechaLocal, turnoName) => {
  const [year, month, day] = String(fechaLocal || '').split('-');
  const shiftLetter = turnoName && turnoName.trim().length > 0
    ? turnoName.trim().charAt(0).toUpperCase()
    : 'M';
  return `Caja ${day}/${month}/${year} ${shiftLetter}`;
};

export const isFinalizedPedidoEstado = (estado) => {
  const est = String(estado || '').toLowerCase();
  return est === 'finalizado' || est === 'cobrado';
};

/** Pedido asignado a una caja/turno concreto (cierre o panel de pedidos). */
export const orderMatchesCajaTurno = (order, turnoName, pedidoTipo = null) => {
  const turno = String(turnoName || '').trim();
  if (!turno) return true;

  const caja = String(order?.turno_caja || '').trim();
  if (caja) return caja === turno;

  // Sin turno_caja: solo imputar cuando hay contexto de tipo (caja abierta / cierre desde pedidos).
  if (!pedidoTipo) return false;

  return pedidoTipo === 'delivery'
    ? order?.con_envio === true
    : order?.con_envio !== true;
};

export const isPedidoMedioCtaCte = (medio) => {
  const normalized = String(medio || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized === 'cta cte'
    || normalized === 'cuenta corriente (deuda)'
    || normalized === 'cuenta corriente'
    || normalized.includes('cuenta corriente');
};

const normalizeMedioLabel = (label) => String(label || '').trim().toLowerCase();

export const resolvePedidoMedioConcept = (medioLabel, cierreConceptos) => {
  const activeMedios = getActiveMedios(cierreConceptos);
  const normalized = normalizeMedioLabel(medioLabel);
  if (!normalized || isPedidoMedioCtaCte(medioLabel)) return null;

  const exact = activeMedios.find(
    (concept) => normalizeMedioLabel(concept.label) === normalized
  );
  if (exact) return exact;

  if (normalized.includes('pagado en caja') || normalized.includes('cobro en caja')) {
    const efectivo = activeMedios.find(
      (concept) => concept.slot === 1 || normalizeMedioLabel(concept.label) === 'efectivo'
    );
    if (efectivo) return efectivo;
  }

  const partial = activeMedios.find((concept) => {
    const conceptLabel = normalizeMedioLabel(concept.label);
    return conceptLabel && (normalized.includes(conceptLabel) || conceptLabel.includes(normalized));
  });
  return partial || null;
};

export const aggregatePedidosMediosForCierre = (pedidos, cierreConceptos) => {
  const totals = {};
  getActiveMedios(cierreConceptos).forEach((medio) => {
    totals[medio.id] = 0;
  });

  (pedidos || []).forEach((pedido) => {
    const concept = resolvePedidoMedioConcept(pedido.medio_pago, cierreConceptos);
    if (!concept) return;
    totals[concept.id] = (totals[concept.id] || 0) + parseFloat(pedido.total || 0);
  });

  return totals;
};
