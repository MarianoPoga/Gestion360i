/**
 * Valores iniciales al crear una empresa nueva.
 *
 * Editar este archivo para cambiar qué se precarga al registrarse.
 * Los cambios hechos en Configuración se guardan por empresa en la nube;
 * no se sobrescriben al recargar (salvo "Restaurar predefinidos").
 */

import { DEFAULT_CAJA_FUERTE_NAME } from './moduleLabels';
import { createDefaultCierreMedios } from './cierreMedios';
import { DEFAULT_CIERRE_TURNOS, getCierreTurnoNames } from './cierreTurnos';
import { createDefaultComprasCategories } from './expenseTypes';
import { normalizePedidosCajasConfig } from './pedidosCajas';
import { normalizeRolePermissions } from './rolePermissions';
import { DEFAULT_PRICE_LIST_NAMES } from './priceLists';
import {
  DEFAULT_PERIODIC_CONCEPTS,
  buildPeriodicPaymentFromConcept,
} from './periodicPaymentsDefaults';

export { DEFAULT_PERIODIC_CONCEPTS } from './periodicPaymentsDefaults';

export const DEFAULT_TERMINAL_NAME = 'Terminal Principal';

export const DEFAULT_ENABLED_MODULES = {
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
  'pago-impuestos': true,
};

export const DEFAULT_COMPRAS_FORMAS_PAGO = [
  'Efectivo',
  'Caja',
  'Rendición',
  'Transferencia',
  'Tarjeta',
  'Mercado Pago',
];

export const DEFAULT_RENDICIONES_CONFIG = {
  caja_nombre: DEFAULT_CAJA_FUERTE_NAME,
  allow_adelantos: true,
  allow_compras: true,
  allow_pagos: true,
};

export const DEFAULT_WHATSAPP_TEMPLATE =
  'Hola! Estoy por llegar con su pedido 🛵 🍔. Gracias!!';

export const DEFAULT_PRICE_LIST_SEED = [
  { nombre: DEFAULT_PRICE_LIST_NAMES.normal, es_default: true, orden: 1 },
  { nombre: DEFAULT_PRICE_LIST_NAMES.empresas, es_default: false, orden: 2 },
  { nombre: DEFAULT_PRICE_LIST_NAMES.viandas, es_default: false, orden: 3 },
  { nombre: DEFAULT_PRICE_LIST_NAMES.efectivo, es_default: false, orden: 4 },
];

export const buildDefaultCierreTurnos = () =>
  DEFAULT_CIERRE_TURNOS.map((turno) => ({ ...turno }));

export const buildDefaultCierreMedios = () => createDefaultCierreMedios();

export const buildDefaultComprasCategorias = () => createDefaultComprasCategories();

export const buildDefaultPedidosCajasConfig = () =>
  normalizePedidosCajasConfig(getCierreTurnoNames(DEFAULT_CIERRE_TURNOS), null);

export const buildDefaultRolePermissions = () =>
  normalizeRolePermissions(null, DEFAULT_ENABLED_MODULES);

export const buildDefaultPeriodicPaymentRows = ({ isMonotributo = false } = {}) =>
  DEFAULT_PERIODIC_CONCEPTS.map((concept, index) =>
    buildPeriodicPaymentFromConcept(concept, isMonotributo, index)
  );

/** Snapshot completo de config inicial para una empresa nueva. */
export const buildNewBusinessDefaults = ({ isMonotributo = false } = {}) => ({
  modules: { ...DEFAULT_ENABLED_MODULES },
  cierreTurnos: buildDefaultCierreTurnos(),
  cierreMedios: buildDefaultCierreMedios(),
  comprasCategorias: buildDefaultComprasCategorias(),
  comprasFormasPago: [...DEFAULT_COMPRAS_FORMAS_PAGO],
  pedidosCajas: buildDefaultPedidosCajasConfig(),
  rolePermissions: buildDefaultRolePermissions(),
  rendiciones: { ...DEFAULT_RENDICIONES_CONFIG },
  whatsappTemplate: DEFAULT_WHATSAPP_TEMPLATE,
  periodicPayments: buildDefaultPeriodicPaymentRows({ isMonotributo }),
});
