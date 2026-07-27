-- Migración ONE-TIME: tablas sin prefijo gst_ -> tablas gst_*
-- Ejecutar solo si tenés datos viejos en tablas legacy (clientes, personal, etc.)
-- El código de la app consulta únicamente tablas gst_*.
--
-- 1) Obtener tu business_id:
--    SELECT id, name FROM gst_businesses;
--
-- 2) Reemplazar YOUR_BUSINESS_ID abajo por el UUID real.

INSERT INTO public.gst_clientes (id, business_id, nombre, razon_social, cuit, saldo, telefono, condicion_iva, direccion_predeterminada, created_at)
SELECT id, 'YOUR_BUSINESS_ID'::uuid, nombre, razon_social, cuit, saldo, telefono, condicion_iva, direccion_predeterminada, created_at
FROM public.clientes c
WHERE NOT EXISTS (SELECT 1 FROM public.gst_clientes g WHERE g.id = c.id);

INSERT INTO public.gst_personal (id, business_id, nombre, apodo, cuit, cbu, telefono, direccion, activo, created_at)
SELECT gen_random_uuid(), 'YOUR_BUSINESS_ID'::uuid, nombre, NULL, NULL, NULL, NULL, NULL, activo, created_at
FROM public.personal p
WHERE NOT EXISTS (
  SELECT 1 FROM public.gst_personal g
  WHERE g.business_id = 'YOUR_BUSINESS_ID'::uuid AND lower(g.nombre) = lower(p.nombre)
);

INSERT INTO public.gst_proveedores (id, business_id, nombre, cuit, alias, tipo, detalle, pago, factura, created_at)
SELECT id, 'YOUR_BUSINESS_ID'::uuid, nombre, cuit, alias, tipo, detalle, pago, factura, created_at
FROM public.proveedores pr
WHERE NOT EXISTS (SELECT 1 FROM public.gst_proveedores g WHERE g.id = pr.id);
