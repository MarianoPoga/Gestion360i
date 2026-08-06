/**
 * Tipos de movimiento de cuenta corriente (CC).
 *
 * Convención: debe = deuda del cliente · haber = pago / saldo a favor.
 * En DB se guarda "Pedido"; en pantalla se muestra "Compra".
 *
 * Reglas de negocio:
 * - Compra: solo al FINALIZAR (con medio de pago asignado).
 * - Crédito: cobro antes de finalizar.
 * - Al finalizar: Crédito pasa a Cobro (misma línea, sin cambiar montos).
 * - Cobro: pago real sobre compra finalizada (Efectivo, Transferencia, etc.).
 * - Cta Cte: Compra al finalizar; si hay saldo a favor previo → Cobro (Depósito — saldo a favor).
 * - Cancelación: anula Compra (si finalizada); Cobro pasa a Crédito.
 * - Depósitos: línea independiente; la imputación al pedido Cta Cte crea cobro saldo a favor.
 * - Link/Efectivo/etc.: Crédito/Cobro del pedido tienen prioridad; no consumen Depósito.
 * - Devolución: anula Crédito/Cobro/Depósito (botón devolver saldo).
 * - Cambio de medio: solo actualiza texto del concepto, sin nuevas líneas.
 */

export const CC_MOVEMENT_KIND = {
  COMPRA: 'compra',
  CREDITO: 'credito',
  COBRO: 'cobro',
  DEPOSITO: 'deposito',
  DEVOLUCION: 'devolucion',
  CANCELACION: 'cancelacion',
  /** Legacy — lectura / migración */
  REVERSION_COMPRA: 'reversion_compra',
  REVERSION_CREDITO: 'reversion_credito',
  REVERSION_COBRO: 'reversion_cobro',
  ANTICIPO: 'anticipo',
  APLICACION_ANTICIPO: 'aplicacion_anticipo',
  PAGO_LEGACY: 'pago_legacy',
  OTRO: 'otro',
};

export const CC_MOVEMENT_CATALOG = [
  {
    kind: CC_MOVEMENT_KIND.COMPRA,
    pattern: 'Pedido #{ref}',
    debe: true,
    activo: true,
    display: 'Compra #{ref}',
    cuando: 'Al finalizar el pedido (con medio de pago asignado).',
  },
  {
    kind: CC_MOVEMENT_KIND.CREDITO,
    pattern: 'Crédito Pedido #{ref} ({medio})',
    haber: true,
    activo: true,
    display: 'Crédito Compra #{ref} ({medio})',
    cuando: 'Cobro registrado antes de finalizar.',
  },
  {
    kind: CC_MOVEMENT_KIND.COBRO,
    pattern: 'Cobro Pedido #{ref} ({medio})',
    haber: true,
    activo: true,
    display: 'Cobro Compra #{ref} ({medio})',
    cuando: 'Al finalizar (ex-Crédito) o pago sobre compra finalizada / imputación saldo a favor.',
  },
  {
    kind: CC_MOVEMENT_KIND.DEPOSITO,
    pattern: 'Depósito cuenta corriente ({medio})',
    haber: true,
    activo: true,
    display: 'Depósito a cuenta ({medio})',
    cuando: 'Ingreso a cuenta sin compra asociada.',
  },
  {
    kind: CC_MOVEMENT_KIND.DEVOLUCION,
    pattern: 'Devolución de pago ({medio})',
    debe: true,
    activo: true,
    display: 'Devolución de pago ({medio})',
    cuando: 'Devolver saldo a favor al cliente (botón existente).',
  },
  {
    kind: CC_MOVEMENT_KIND.CANCELACION,
    pattern: 'Cancelación Pedido #{ref}',
    haber: true,
    activo: true,
    display: 'Cancelación Compra #{ref}',
    cuando: 'Pedido finalizado cancelado — anula Compra; Cobro previo pasa a Crédito.',
  },
];

export const roundCcMoney = (value) =>
  Math.round((parseFloat(value || 0) + Number.EPSILON) * 100) / 100;

export const getOrderMovementRef = (orderId) => String(orderId).substring(0, 6);

export const movementConcept = {
  pedido: (ref) => `Pedido #${ref}`,
  credito: (ref, medio) => `Crédito Pedido #${ref} (${medio})`,
  cobro: (ref, medio) => `Cobro Pedido #${ref} (${medio})`,
  deposito: (medio, note) => (
    note
      ? `Depósito cuenta corriente (${medio}) — ${note}`
      : `Depósito cuenta corriente (${medio})`
  ),
  cancelacion: (ref, motivo) => (
    motivo
      ? `Cancelación Pedido #${ref} (Motivo: ${motivo})`
      : `Cancelación Pedido #${ref}`
  ),
  devolucion: (medio) => `Devolución de pago (${medio})`,
  /** Cobro imputado desde saldo a favor (Depósito u otro); no duplica haber en saldo global */
  cobroSaldoFavor: (ref, medio) => `Cobro Pedido #${ref} (${medio} — saldo a favor)`,
};

const conceptText = (concepto) => String(concepto || '');

export const isCobroSaldoFavorImputation = (concepto) => {
  const c = conceptText(concepto);
  return c.includes('Cobro Pedido #') && c.includes('saldo a favor');
};

export const isMedioCtaCteValue = (medio) => {
  const normalized = String(medio || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized === 'cta cte'
    || normalized === 'cuenta corriente (deuda)'
    || normalized === 'cuenta corriente';
};

/** Cobro con medio Cta Cte no es un pago real — la deuda queda en la Compra. */
export const isInvalidCtaCteCobroConcept = (concepto) => {
  if (!isCobroPedidoConcept(concepto) || isCobroSaldoFavorImputation(concepto)) return false;
  return isMedioCtaCteValue(extractMedioFromPaymentConcept(concepto));
};

export const extractMedioFromPaymentConcept = (concepto) => {
  const match = conceptText(concepto).match(/\(([^)]+)\)/);
  if (!match) return 'Pago';
  return match[1].replace(/\s*—\s*saldo a favor/i, '').trim();
};

export const computeClientSaldoFromMovements = (movements) => {
  const saldo = (movements || []).reduce((sum, m) => {
    const debe = roundCcMoney(m.debe);
    const haber = roundCcMoney(m.haber);
    const haberForSaldo = isCobroSaldoFavorImputation(m.concepto) ? 0 : haber;
    return sum + debe - haberForSaldo;
  }, 0);
  return roundCcMoney(saldo);
};

export const isCreditoPedidoConcept = (concepto, orderRef) => {
  const text = conceptText(concepto);
  if (orderRef && !text.includes(`#${orderRef}`)) return false;
  return text.includes('Crédito Pedido #') || text.includes('Anticipo Pedido #');
};

export const isCobroPedidoConcept = (concepto, orderRef) => {
  const text = conceptText(concepto);
  if (orderRef && !text.includes(`#${orderRef}`)) return false;
  return text.includes('Cobro Pedido #') && !text.includes('Reversión');
};

export const isPedidoDeudaConcept = (concepto) => /^Pedido #/.test(conceptText(concepto));

export const isUnlinkedClientPaymentConcept = (concepto) =>
  conceptText(concepto).startsWith('Pago cuenta corriente');

export const isDepositConcept = (concepto) =>
  conceptText(concepto).startsWith('Depósito cuenta corriente');

export const isRefundConcept = (concepto) =>
  conceptText(concepto).startsWith('Devolución de pago');

export const isUnlinkedHaberMovement = (concepto) =>
  isDepositConcept(concepto) || isUnlinkedClientPaymentConcept(concepto);

export const isOrderPrimaryDeudaCharge = (mov, orderRef) => {
  const c = conceptText(mov?.concepto);
  const debe = parseFloat(mov?.debe || 0);
  if (debe <= 0 || !orderRef || !c.includes(`#${orderRef}`)) return false;
  if (c.includes('Reversión') || c.includes('Cobro') || c.includes('Crédito') || c.includes('Anticipo')) {
    return false;
  }
  return isPedidoDeudaConcept(c);
};

export const isPedidoChargeMovement = (mov) =>
  isPedidoDeudaConcept(mov?.concepto) && parseFloat(mov?.debe || 0) > 0;

export const dedupePedidoChargeMovements = (movements, orderRef = null) => {
  let seenPedidoCharge = false;
  return (movements || []).filter((mov) => {
    const isDupTarget = orderRef
      ? isOrderPrimaryDeudaCharge(mov, orderRef)
      : isPedidoChargeMovement(mov);
    if (!isDupTarget) return true;
    if (seenPedidoCharge) return false;
    seenPedidoCharge = true;
    return true;
  });
};

export const buildOrderCCFlags = (movements, orderRef) => ({
  hasPedido: (movements || []).some((m) => isOrderPrimaryDeudaCharge(m, orderRef)),
  hasCredit: (movements || []).some((m) => isCreditoPedidoConcept(m.concepto, orderRef)),
  hasCobro: (movements || []).some((m) => isCobroPedidoConcept(m.concepto, orderRef)),
});

export const getOrderRelatedMovements = (movements, orderRef) =>
  (movements || []).filter((m) => m.concepto && m.concepto.includes(`#${orderRef}`));

export const findOrderPaymentMovement = (movements, orderRef) =>
  (movements || []).find(
    (m) => isCreditoPedidoConcept(m.concepto, orderRef) || isCobroPedidoConcept(m.concepto, orderRef)
  );

/** Orden en UI de grupo por pedido: Compra → Cobro/Crédito → resto. */
export const getOrderMovementDisplayRank = (concepto) => {
  const c = conceptText(concepto);
  if (/^Pedido #/.test(c)) return 0;
  if (c.includes('Crédito') || c.includes('Anticipo')) return 1;
  if ((c.includes('Cobro Pedido') || c.startsWith('Pago cuenta corriente')) && !c.includes('Reversión')) {
    return 1;
  }
  if (c.includes('Cancelación')) return 2;
  return 3;
};

export const sortOrderGroupMovements = (movements) =>
  [...(movements || [])].sort((a, b) => {
    const rankDiff = getOrderMovementDisplayRank(a.concepto) - getOrderMovementDisplayRank(b.concepto);
    if (rankDiff !== 0) return rankDiff;
    return new Date(a.fecha || 0).getTime() - new Date(b.fecha || 0).getTime();
  });

export const paymentConceptWithMedio = (orderRef, medio, isCredit) =>
  isCredit
    ? movementConcept.credito(orderRef, medio)
    : movementConcept.cobro(orderRef, medio);

/**
 * Solo aplica si el medio del pedido es Cuenta Corriente.
 * Con Link/Efectivo/etc. el pago va por Crédito/Cobro del pedido sin tocar Depósitos.
 */
export const planSaldoFavorCobros = ({
  orderRef,
  orderTotal,
  favorAvailable = 0,
  alreadyCobrado = 0,
  isCtaCte = false,
}) => {
  if (!isCtaCte) return [];

  const remaining = roundCcMoney(orderTotal - alreadyCobrado);
  if (remaining <= 0 || favorAvailable <= 0) return [];

  const fromFavor = roundCcMoney(Math.min(remaining, favorAvailable));
  if (fromFavor <= 0) return [];

  return [{
    concepto: movementConcept.cobroSaldoFavor(orderRef, 'Depósito'),
    debe: 0,
    haber: fromFavor,
  }];
};

export const classifyMovementKind = (concepto) => {
  const c = conceptText(concepto);
  if (c.startsWith('Devolución de pago')) return CC_MOVEMENT_KIND.DEVOLUCION;
  if (c.startsWith('Depósito cuenta corriente')) return CC_MOVEMENT_KIND.DEPOSITO;
  if (c.startsWith('Pago cuenta corriente')) return CC_MOVEMENT_KIND.PAGO_LEGACY;
  if (c.startsWith('Aplicación anticipo Pedido #')) return CC_MOVEMENT_KIND.APLICACION_ANTICIPO;
  if (c.includes('Reversión crédito Pedido #') || c.includes('Reversión anticipo Pedido #')) {
    return CC_MOVEMENT_KIND.REVERSION_CREDITO;
  }
  if (c.includes('Reversión Cobro Pedido #')) return CC_MOVEMENT_KIND.REVERSION_COBRO;
  if (c.includes('Reversión Pedido #')) return CC_MOVEMENT_KIND.REVERSION_COMPRA;
  if (c.includes('Cancelación Pedido #')) return CC_MOVEMENT_KIND.CANCELACION;
  if (c.includes('Crédito Pedido #')) return CC_MOVEMENT_KIND.CREDITO;
  if (c.includes('Anticipo Pedido #')) return CC_MOVEMENT_KIND.ANTICIPO;
  if (c.includes('Cobro Pedido #')) return CC_MOVEMENT_KIND.COBRO;
  if (/^Pedido #/.test(c)) return CC_MOVEMENT_KIND.COMPRA;
  return CC_MOVEMENT_KIND.OTRO;
};

export const formatMovementForDisplay = (concepto) => {
  let text = conceptText(concepto);
  text = text.replace(/Pedido #/g, 'Compra #');
  text = text.replace(/Pedido /g, 'Compra ');
  text = text.replace(/Cobro Pedido #/g, 'Cobro Compra #');
  text = text.replace(/Cancelación Pedido #/g, 'Cancelación Compra #');
  text = text.replace(/Reversión Cobro Pedido #/g, 'Reversión Cobro Compra #');
  text = text.replace(/Anticipo Pedido #/g, 'Crédito Compra #');
  text = text.replace(/Crédito Pedido #/g, 'Crédito Compra #');
  text = text.replace(/Aplicación anticipo Pedido #/g, 'Aplicación crédito Compra #');
  text = text.replace(/Reversión anticipo Pedido #/g, 'Reversión crédito Compra #');
  text = text.replace(/Reversión crédito Pedido #/g, 'Reversión crédito Compra #');
  text = text.replace(/Depósito cuenta corriente/g, 'Depósito a cuenta');
  text = text.replace(/Pago cuenta corriente/g, 'Pago recibido');
  text = text.replace(/ — saldo a favor/g, ' — saldo a favor');
  if (text.includes(' - ')) {
    text = text.split(' - ')[0];
  }
  return text;
};

export const isCCCashInflowConcept = (concepto) => {
  const text = conceptText(concepto);
  if (isUnlinkedClientPaymentConcept(text)) return true;
  if (isDepositConcept(text)) return true;
  if (isCobroSaldoFavorImputation(text)) return false;
  if (text.includes('Cobro Pedido #') && !text.includes('Reversión')) return true;
  return false;
};
