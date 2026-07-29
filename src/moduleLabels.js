export const DEFAULT_CAJA_FUERTE_NAME = 'Caja Fuerte';

export const MODULE_LABELS = {
  cierre: 'Cerrar Caja',
  compras: 'Compras',
  adelantos: 'Adelantos Personal',
  'pago-proveedores': 'Pagos Proveedores',
  'pago-impuestos': 'Pagos',
  rendiciones: 'Caja Fuerte',
  'pagos-periodicos': 'Calendario de Pagos',
  clientes: 'Pedidos',
  proveedores: 'CtaCte Proveedores',
  empleados: 'Empleados',
  resultados: 'Resultados',
  tareas: 'Tareas',
};

export const MODULE_DESCRIPTIONS = {
  cierre: 'Cierre de turnos y arqueo de efectivo.',
  compras: 'Registro de egresos y facturas de proveedores.',
  adelantos: 'Retiros de empleados (Dinero/Mercadería).',
  'pago-proveedores': 'Gestión de pagos a proveedores y caja chica.',
  'pago-impuestos': 'Pagos regulares sin factura de proveedor: personal, impuestos, banco y financieros. También alternativa al Calendario.',
  rendiciones: 'Historial y saldos de caja fuerte (Rendiciones).',
  'pagos-periodicos': 'Gestión de gastos recurrentes y vencimientos.',
  clientes: 'Registro de pedidos, direcciones y saldos de clientes.',
  proveedores: 'Cuenta corriente y registro de pagos a proveedores.',
  empleados: 'Gestión de personal y adelantos/sueldos.',
  resultados: 'Dashboard de estadísticas y utilidad.',
  tareas: 'Listado de tareas de mantenimiento/limpieza.',
};

export const getModuleLabel = (id) => MODULE_LABELS[id] || id;
