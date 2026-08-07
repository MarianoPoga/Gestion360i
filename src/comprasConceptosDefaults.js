/**
 * Conceptos predefinidos por categoría de Compras.
 * Fuente única: se usan al iniciar y se fusionan con conceptos custom guardados en config.
 */

const concept = (label, iva = 21, id) => ({
  id: id || `cc_${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
  label,
  iva,
});

export const PREDEFINED_COMPRAS_CONCEPTOS_BY_CATEGORY = {
  Mercadería: [
    concept('Almacén', 21, 'cc_m_almacen'),
    concept('Art. Cocina', 21, 'cc_m_art_cocina'),
    concept('Bebidas', 21, 'cc_m_bebidas'),
    concept('Carnes', 21, 'cc_m_carnes'),
    concept('Combustible', 21, 'cc_m_combustible'),
    concept('Envases', 21, 'cc_m_envases'),
    concept('Fiambres', 21, 'cc_m_fiambres'),
    concept('Flete', 21, 'cc_m_flete'),
    concept('Fumigación', 21, 'cc_m_fumigacion'),
    concept('Huevos', 21, 'cc_m_huevos'),
    concept('Lacteos', 21, 'cc_m_lacteos'),
    concept('Limpieza', 21, 'cc_m_limpieza'),
    concept('Pan', 21, 'cc_m_pan'),
    concept('Pastas', 21, 'cc_m_pastas'),
    concept('Pescado', 21, 'cc_m_pescado'),
    concept('Pollos', 21, 'cc_m_pollos'),
    concept('Productos', 21, 'cc_m_productos'),
    concept('Verduras', 21, 'cc_m_verduras'),
    concept('Sin categoria', 21, 'cc_m_sin_categoria'),
  ],
  'Mantenimiento y limpieza': [
    concept('Repuestos', 21, 'cc_ml_repuestos'),
    concept('Reparaciones', 21, 'cc_ml_reparaciones'),
    concept('Service equipos', 21, 'cc_ml_service'),
    concept('Artículos de limpieza', 21, 'cc_ml_art_limpieza'),
    concept('Insumos de higiene', 21, 'cc_ml_higiene'),
    concept('Fumigación', 21, 'cc_ml_fumigacion'),
    concept('Mantenimiento edilicio', 21, 'cc_ml_edilicio'),
  ],
  Inversión: [
    concept('Maquinaria', 21, 'cc_inv_maquinaria'),
    concept('Mobiliario', 21, 'cc_inv_mobiliario'),
    concept('Equipamiento', 21, 'cc_inv_equipamiento'),
    concept('Herramientas', 21, 'cc_inv_herramientas'),
    concept('Tecnología', 21, 'cc_inv_tecnologia'),
  ],
};

export const PREDEFINED_COMPRAS_CATEGORY_NAMES = Object.keys(PREDEFINED_COMPRAS_CONCEPTOS_BY_CATEGORY);

export const getPredefinedComprasConceptos = (categoryName) =>
  (PREDEFINED_COMPRAS_CONCEPTOS_BY_CATEGORY[categoryName] || []).map((item) => ({ ...item }));

export const buildPredefinedComprasCategories = () =>
  PREDEFINED_COMPRAS_CATEGORY_NAMES.map((name) => ({
    name,
    details: getPredefinedComprasConceptos(name),
  }));
