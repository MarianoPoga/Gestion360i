import { buildMedioValuesFromCierre } from '../cierreMedios';
import { isCobroPedidoConcept, isCreditoPedidoConcept } from '../ccMovements';
import { emptyResumen, MOVIMIENTO_TIPOS } from './resultadosTypes';
import { isDateInRange, toDateString } from './resultadosPeriod';

const parseAmount = (v) => parseFloat(v) || 0;

export const getEnabledMedioColumns = (mediosConfig = []) =>
  (mediosConfig || [])
    .filter((m) => m.enabled !== false && m.label)
    .map((m) => ({ id: m.id, label: m.label }));

export const buildVentasPorCaja = (cierres, mediosConfig, { desde, hasta, turnoFilter = '' }) => {
  const columns = getEnabledMedioColumns(mediosConfig);
  const filtered = (cierres || []).filter((c) => {
    if (!isDateInRange(c.fecha, desde, hasta)) return false;
    if (turnoFilter && c.turno !== turnoFilter) return false;
    return true;
  });

  const rows = filtered.map((c) => {
    const medios = buildMedioValuesFromCierre(c);
    const mediosMap = {};
    columns.forEach(({ id }) => {
      mediosMap[id] = parseAmount(medios[id]);
    });
    return {
      id: c.id,
      turno: c.turno || '',
      fecha: c.fecha,
      fechaLabel: toDateString(c.fecha).split('-').reverse().join('/'),
      total: parseAmount(c.total),
      comprasTurno: parseAmount(c.compras),
      adelantos:
        parseAmount(c.adelantos_efectivo) + parseAmount(c.adelantos_merc),
      medios: mediosMap,
    };
  });

  const totales = {
    turno: 'TOTAL',
    fechaLabel: '',
    total: 0,
    comprasTurno: 0,
    adelantos: 0,
    medios: {},
  };
  columns.forEach(({ id }) => {
    totales.medios[id] = 0;
  });

  rows.forEach((row) => {
    totales.total += row.total;
    totales.comprasTurno += row.comprasTurno;
    totales.adelantos += row.adelantos;
    columns.forEach(({ id }) => {
      totales.medios[id] += row.medios[id] || 0;
    });
  });

  return { rows, totales, columns };
};

export const buildComposicionVentas = (cierres, mediosConfig, range) => {
  const { totales, columns } = buildVentasPorCaja(cierres, mediosConfig, range);
  const medios = columns
    .map(({ id, label }) => ({
      id,
      label,
      value: totales.medios[id] || 0,
    }))
    .filter((m) => m.value > 0);

  return { medios, total: totales.total };
};

export const buildResumen = ({
  cierres,
  compras,
  desde,
  hasta,
  turnoFilter = '',
  cierresAnterior = [],
  comprasAnterior = [],
}) => {
  const { totales } = buildVentasPorCaja(cierres, [], { desde, hasta, turnoFilter });

  const egresosTotal = (compras || [])
    .filter((c) => isDateInRange(c.fecha, desde, hasta))
    .reduce((acc, c) => acc + parseAmount(c.total), 0);

  const ventasAnterior = (cierresAnterior || [])
    .reduce((acc, c) => acc + parseAmount(c.total), 0);

  const egresosAnterior = (comprasAnterior || [])
    .reduce((acc, c) => acc + parseAmount(c.total), 0);

  const resumen = emptyResumen();
  resumen.ventasTotal = totales.total;
  resumen.egresosTotal = egresosTotal;
  resumen.resultadoOperativo = totales.total - egresosTotal;
  resumen.ventasAnterior = ventasAnterior;
  resumen.egresosAnterior = egresosAnterior;
  resumen.resultadoAnterior = ventasAnterior - egresosAnterior;
  return resumen;
};

export const classifyCcMovimiento = (mov) => {
  const concepto = mov.concepto || '';
  const debe = parseAmount(mov.debe);
  const haber = parseAmount(mov.haber);
  if (isCobroPedidoConcept(concepto) || (haber > 0 && /cobro/i.test(concepto))) {
    return MOVIMIENTO_TIPOS.COBRO_CC;
  }
  if (isCreditoPedidoConcept(concepto) || debe > 0) {
    return MOVIMIENTO_TIPOS.CARGO_CC;
  }
  return MOVIMIENTO_TIPOS.OTRO_CC;
};

export const buildMovimientosCc = (movimientos, clientesMap, { desde, hasta }) =>
  (movimientos || [])
    .filter((m) => isDateInRange(m.fecha || m.created_at, desde, hasta))
    .map((m) => {
      const tipo = classifyCcMovimiento(m);
      const debe = parseAmount(m.debe);
      const haber = parseAmount(m.haber);
      const cliente = clientesMap[m.cliente_id] || '—';
      const fechaRef = m.fecha || m.created_at;
      return {
        id: m.id,
        fecha: fechaRef,
        fechaLabel: toDateString(fechaRef).split('-').reverse().join('/'),
        cliente,
        concepto: m.concepto || '',
        tipo,
        debe,
        haber,
        ingreso: tipo === MOVIMIENTO_TIPOS.COBRO_CC ? haber : 0,
        egreso: tipo === MOVIMIENTO_TIPOS.CARGO_CC ? debe : 0,
      };
    })
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

export const buildMovimientosUnificados = ({
  cierres,
  compras,
  movimientosCc,
  desde,
  hasta,
  turnoFilter = '',
}) => {
  const items = [];

  (cierres || []).forEach((c) => {
    if (!isDateInRange(c.fecha, desde, hasta)) return;
    if (turnoFilter && c.turno !== turnoFilter) return;
    items.push({
      id: `cierre-${c.id}`,
      fecha: c.fecha,
      fechaLabel: toDateString(c.fecha).split('-').reverse().join('/'),
      tipo: MOVIMIENTO_TIPOS.VENTA,
      concepto: `Cierre ${c.turno || ''}`.trim(),
      categoria: 'Ventas',
      caja: c.turno || '',
      cliente: '',
      ingreso: parseAmount(c.total),
      egreso: 0,
    });
  });

  (compras || []).forEach((c) => {
    if (!isDateInRange(c.fecha, desde, hasta)) return;
    items.push({
      id: `compra-${c.id}`,
      fecha: c.fecha,
      fechaLabel: toDateString(c.fecha).split('-').reverse().join('/'),
      tipo: MOVIMIENTO_TIPOS.COMPRA,
      concepto: c.concepto || c.proveedor || 'Compra',
      categoria: c.categoria || c.tipo || 'Compras',
      caja: c.caja_cierre || '',
      cliente: '',
      ingreso: 0,
      egreso: parseAmount(c.total),
    });
  });

  (movimientosCc || []).forEach((m) => {
    items.push({
      id: `cc-${m.id}`,
      fecha: m.fecha,
      fechaLabel: m.fechaLabel,
      tipo: m.tipo,
      concepto: m.concepto,
      categoria: 'Cuenta corriente',
      caja: '',
      cliente: m.cliente,
      ingreso: m.ingreso,
      egreso: m.egreso,
    });
  });

  return items.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
};

export const buildComprasDetalle = (compras, { desde, hasta }) =>
  (compras || [])
    .filter((c) => isDateInRange(c.fecha, desde, hasta))
    .map((c) => ({
      id: c.id,
      fecha: c.fecha,
      fechaLabel: toDateString(c.fecha).split('-').reverse().join('/'),
      proveedor: c.proveedor || '',
      concepto: c.concepto || '',
      categoria: c.categoria || '',
      neto: parseAmount(c.neto),
      iva:
        parseAmount(c.iva)
        + parseAmount(c.iva21)
        + parseAmount(c.iva105)
        + parseAmount(c.iva27),
      total: parseAmount(c.total),
      factura: c.factura || '',
      caja: c.caja_cierre || '',
    }))
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

export const buildEgresosPorCategoria = (compras, { desde, hasta }) => {
  const map = {};
  (compras || []).forEach((c) => {
    if (!isDateInRange(c.fecha, desde, hasta)) return;
    const cat = c.categoria || c.tipo || 'Sin categoría';
    map[cat] = (map[cat] || 0) + parseAmount(c.total);
  });
  return Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
};

const parseDateForLoop = (str) => {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const buildIngresosEgresosDiarios = ({
  cierres,
  compras,
  desde,
  hasta,
  turnoFilter = '',
}) => {
  const days = {};
  const cursor = parseDateForLoop(desde);
  const end = parseDateForLoop(hasta);
  while (cursor <= end) {
    const key = toDateString(cursor);
    days[key] = {
      fecha: key,
      label: key.split('-').slice(1).reverse().join('/'),
      ingresos: 0,
      egresos: 0,
    };
    cursor.setDate(cursor.getDate() + 1);
  }

  (cierres || []).forEach((c) => {
    if (!isDateInRange(c.fecha, desde, hasta)) return;
    if (turnoFilter && c.turno !== turnoFilter) return;
    const key = toDateString(c.fecha);
    if (days[key]) days[key].ingresos += parseAmount(c.total);
  });

  (compras || []).forEach((c) => {
    if (!isDateInRange(c.fecha, desde, hasta)) return;
    const key = toDateString(c.fecha);
    if (days[key]) days[key].egresos += parseAmount(c.total);
  });

  return Object.values(days);
};

export const pctChange = (current, previous) => {
  if (!previous || previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
};

export const formatCurrency = (amount) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(parseAmount(amount));
