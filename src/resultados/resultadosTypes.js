export const PERIOD_PRESETS = {
  TODAY: 'today',
  WEEK: 'week',
  MONTH: 'month',
  PREV_MONTH: 'prev_month',
  CUSTOM: 'custom',
};

export const RESULTADOS_TABS = {
  MOVIMIENTOS: 'movimientos',
  VENTAS: 'ventas',
  COMPRAS: 'compras',
  CC: 'cc',
};

export const MOVIMIENTO_TIPOS = {
  VENTA: 'Venta',
  COMPRA: 'Compra',
  COBRO_CC: 'Cobro CC',
  CARGO_CC: 'Cargo CC',
  OTRO_CC: 'CC',
};

export const emptyResumen = () => ({
  ventasTotal: 0,
  egresosTotal: 0,
  resultadoOperativo: 0,
  ventasAnterior: 0,
  egresosAnterior: 0,
  resultadoAnterior: 0,
});

export const emptyComposicionVentas = () => ({
  medios: [],
  total: 0,
});
