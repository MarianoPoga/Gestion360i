import { normalizeCierreTurnos, getTurnoName } from './cierreTurnos';

export const PAGADO_EN_CAJA_OPTION = 'Pagado en caja';
/** @deprecated use PAGADO_EN_CAJA_OPTION */
export const COBRO_EN_CAJA_OPTION = PAGADO_EN_CAJA_OPTION;

export const PEDIDOS_CAJA_TIPOS = {
  DELIVERY: 'delivery',
  LOCAL: 'local',
};

export const emptyCajaAssignment = () => ({ delivery: false, local: false });

export const normalizeCajaAssignment = (value) => {
  if (value && typeof value === 'object' && ('delivery' in value || 'local' in value)) {
    return {
      delivery: value.delivery === true,
      local: value.local === true,
    };
  }
  return emptyCajaAssignment();
};

export const normalizeTurnoNameList = (turnoNames) =>
  (turnoNames || [])
    .map((item) => (typeof item === 'string' ? item : getTurnoName(item)))
    .map((name) => String(name || '').trim())
    .filter(Boolean);

export const migratePedidosCajasFromTurnos = (turnos) => {
  const assignments = {};
  normalizeCierreTurnos(turnos).forEach((turno) => {
    if (turno.pedidosDelivery && !turno.pedidosLocal) {
      assignments[turno.name] = { delivery: true, local: false };
    } else if (turno.pedidosLocal && !turno.pedidosDelivery) {
      assignments[turno.name] = { delivery: false, local: true };
    } else {
      assignments[turno.name] = emptyCajaAssignment();
    }
  });
  return { assignments };
};

export const normalizePedidosCajasConfig = (turnoNames, stored) => {
  const names = normalizeTurnoNameList(turnoNames);
  const raw = { ...(stored?.assignments || {}) };
  const assignments = {};

  names.forEach((name) => {
    assignments[name] = normalizeCajaAssignment(raw[name]);
  });

  return { assignments };
};

export const getCajasForPedidosTipo = (config, turnoNames, tipo) => {
  const { assignments } = normalizePedidosCajasConfig(turnoNames, config);
  const field = tipo === PEDIDOS_CAJA_TIPOS.DELIVERY ? 'delivery' : 'local';
  return Object.entries(assignments)
    .filter(([, flags]) => flags[field] === true)
    .map(([name]) => name);
};

export const getDefaultCajaForPedidosTipo = (config, turnoNames, tipo) =>
  getCajasForPedidosTipo(config, turnoNames, tipo)[0] || '';

export const hasLocalPedidosCajas = (config, turnoNames) =>
  getCajasForPedidosTipo(config, turnoNames, PEDIDOS_CAJA_TIPOS.LOCAL).length > 0;

export const localPedidosManagedExternally = (config, turnoNames) =>
  !hasLocalPedidosCajas(config, turnoNames);

export const usesSeparateLocalCobroCaja = (config, turnoNames) => {
  if (!hasLocalPedidosCajas(config, turnoNames)) return false;
  const delivery = getCajasForPedidosTipo(config, turnoNames, PEDIDOS_CAJA_TIPOS.DELIVERY);
  const local = getCajasForPedidosTipo(config, turnoNames, PEDIDOS_CAJA_TIPOS.LOCAL);
  if (!delivery.length || !local.length) return false;
  return !delivery.some((name) => local.includes(name));
};

export const resolvePedidoTurnoCaja = ({
  order,
  pedidosCajasConfig,
  turnoNames,
  cobroCajaOverride,
}) => {
  if (cobroCajaOverride) return cobroCajaOverride;
  if (order?.turno_caja) return order.turno_caja;

  const tipo = order?.con_envio ? PEDIDOS_CAJA_TIPOS.DELIVERY : PEDIDOS_CAJA_TIPOS.LOCAL;
  if (tipo === PEDIDOS_CAJA_TIPOS.LOCAL && localPedidosManagedExternally(pedidosCajasConfig, turnoNames)) {
    return null;
  }
  if (tipo === PEDIDOS_CAJA_TIPOS.LOCAL && usesSeparateLocalCobroCaja(pedidosCajasConfig, turnoNames)) {
    return null;
  }
  return getDefaultCajaForPedidosTipo(pedidosCajasConfig, turnoNames, tipo);
};

export const togglePedidosCajaFlag = (config, turnoName, field, checked) => {
  const current = normalizeCajaAssignment(config?.assignments?.[turnoName]);
  return {
    assignments: {
      ...(config?.assignments || {}),
      [turnoName]: { ...current, [field]: checked },
    },
  };
};

export const initPedidosCajaAssignment = (config, turnoName) => ({
  assignments: {
    ...(config?.assignments || {}),
    [turnoName]: emptyCajaAssignment(),
  },
});
