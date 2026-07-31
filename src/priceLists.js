export const DEFAULT_PRICE_LIST_NAMES = {
  normal: 'Lista Normal',
  empresas: 'Lista Empresas',
  efectivo: 'Lista Efectivo',
};

export const buildPriceListItemKey = (listaId, productoId) => `${listaId}:${productoId}`;

export const normalizeRubro = (rubro) => String(rubro || '').trim().toLowerCase();

export const sameRubro = (a, b) => normalizeRubro(a) === normalizeRubro(b);

export const sameBasePrice = (a, b) =>
  Math.abs((parseFloat(a) || 0) - (parseFloat(b) || 0)) < 0.005;

export const findRubroPriceSiblings = (products, product, originalPrice) => {
  if (!product) return [];
  const rubro = product.rubro;
  return (products || []).filter(
    (p) =>
      sameRubro(p.rubro, rubro) &&
      sameBasePrice(p.precio, originalPrice)
  );
};

export const resolveProductPrice = (product, lista, priceListItems = {}) => {
  const base = parseFloat(product?.precio) || 0;
  if (!lista || lista.es_default) return base;
  const key = buildPriceListItemKey(lista.id, product.id);
  if (priceListItems[key] !== undefined && priceListItems[key] !== null) {
    const parsed = parseFloat(priceListItems[key]);
    return Number.isFinite(parsed) ? parsed : base;
  }
  return base;
};

export const getDefaultPriceList = (lists) =>
  (lists || []).find((l) => l.es_default) || (lists || [])[0] || null;

export const getClientPriceListId = (client, lists) => {
  if (client?.lista_precio_id) return client.lista_precio_id;
  return getDefaultPriceList(lists)?.id || null;
};
