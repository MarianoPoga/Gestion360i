-- Repara cobros faltantes en cuenta corriente (todos los pedidos finalizados pagos)
-- Caso típico: pedido "Pagado en caja" con Compra # en CC pero sin línea de Cobro
-- Ejecutar en Supabase → SQL Editor

BEGIN;

DELETE FROM public.gst_cliente_movimientos
WHERE concepto LIKE 'Aplicación anticipo Pedido #%';

WITH finalized AS (
  SELECT
    p.*,
    left(p.id::text, 6) AS order_ref
  FROM public.gst_pedidos p
  WHERE lower(p.estado) IN ('finalizado', 'cobrado')
    AND lower(coalesce(p.estado, '')) NOT IN ('cancelado', 'cancelada', 'cancelled')
),
missing_debt AS (
  SELECT ft.*
  FROM finalized ft
  WHERE NOT EXISTS (
    SELECT 1 FROM public.gst_cliente_movimientos m
    WHERE m.business_id = ft.business_id
      AND m.cliente_id = ft.cliente_id
      AND m.concepto LIKE 'Pedido #' || ft.order_ref || '%'
  )
)
INSERT INTO public.gst_cliente_movimientos (business_id, cliente_id, concepto, debe, haber, fecha)
SELECT business_id, cliente_id, 'Pedido #' || order_ref, total, 0,
  coalesce(fecha, created_at, now())
FROM missing_debt;

WITH finalized AS (
  SELECT p.*, left(p.id::text, 6) AS order_ref
  FROM public.gst_pedidos p
  WHERE lower(p.estado) IN ('finalizado', 'cobrado')
    AND lower(coalesce(p.estado, '')) NOT IN ('cancelado', 'cancelada', 'cancelled')
),
missing_cobro AS (
  SELECT ft.*
  FROM finalized ft
  WHERE coalesce(trim(ft.medio_pago), '') <> ''
    AND lower(trim(ft.medio_pago)) NOT IN ('cta cte', 'cuenta corriente (deuda)', 'cuenta corriente')
    AND NOT EXISTS (
      SELECT 1 FROM public.gst_cliente_movimientos m
      WHERE m.business_id = ft.business_id AND m.cliente_id = ft.cliente_id
        AND (m.concepto LIKE 'Crédito Pedido #' || ft.order_ref || '%'
          OR m.concepto LIKE 'Anticipo Pedido #' || ft.order_ref || '%')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.gst_cliente_movimientos m
      WHERE m.business_id = ft.business_id AND m.cliente_id = ft.cliente_id
        AND m.concepto LIKE 'Cobro Pedido #' || ft.order_ref || '%'
        AND m.concepto NOT LIKE 'Reversión%'
    )
)
INSERT INTO public.gst_cliente_movimientos (business_id, cliente_id, concepto, debe, haber, fecha)
SELECT business_id, cliente_id,
  'Cobro Pedido #' || order_ref || ' (' || medio_pago || ')',
  0, total, coalesce(fecha, created_at, now())
FROM missing_cobro;

WITH saldo_calc AS (
  SELECT business_id, cliente_id, round(sum(debe - haber)::numeric, 2) AS nuevo_saldo
  FROM public.gst_cliente_movimientos
  GROUP BY business_id, cliente_id
)
UPDATE public.gst_clientes c
SET saldo = s.nuevo_saldo
FROM saldo_calc s
WHERE c.id = s.cliente_id AND c.business_id = s.business_id;

COMMIT;

-- Ver Leo Esteban (ajustá el nombre si hace falta):
-- SELECT c.nombre, c.saldo, m.concepto, m.debe, m.haber, m.fecha
-- FROM public.gst_clientes c
-- JOIN public.gst_cliente_movimientos m ON m.cliente_id = c.id
-- WHERE c.nombre ILIKE '%Leo Esteban%'
-- ORDER BY m.fecha DESC;
