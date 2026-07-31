-- Sincronizar cuenta corriente: pedidos FINALIZADOS de HOY (hora Argentina)
-- Ejecutar en Supabase → SQL Editor (una sola vez por día si hace falta)
--
-- Qué hace:
-- 1) Borra movimientos obsoletos "Aplicación anticipo"
-- 2) Imputa deuda (Pedido #xxxxxx) si falta
-- 3) Imputa cobro al finalizar si pagaron hoy sin crédito previo
-- 4) Recalcula saldos de clientes afectados

BEGIN;

DELETE FROM public.gst_cliente_movimientos
WHERE concepto LIKE 'Aplicación anticipo Pedido #%';

WITH bounds AS (
  SELECT
    (date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires') AS start_utc,
    ((date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') + interval '1 day') AT TIME ZONE 'America/Argentina/Buenos_Aires') AS end_utc
),
finalized_today AS (
  SELECT
    p.*,
    left(p.id::text, 6) AS order_ref
  FROM public.gst_pedidos p
  CROSS JOIN bounds b
  WHERE lower(p.estado) IN ('finalizado', 'cobrado')
    AND lower(coalesce(p.estado, '')) NOT IN ('cancelado', 'cancelada', 'cancelled')
    AND coalesce(p.fecha, p.created_at) >= b.start_utc
    AND coalesce(p.fecha, p.created_at) < b.end_utc
),
missing_debt AS (
  SELECT ft.*
  FROM finalized_today ft
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.gst_cliente_movimientos m
    WHERE m.business_id = ft.business_id
      AND m.cliente_id = ft.cliente_id
      AND m.concepto LIKE 'Pedido #' || ft.order_ref || '%'
  )
)
INSERT INTO public.gst_cliente_movimientos (business_id, cliente_id, concepto, debe, haber, fecha)
SELECT
  business_id,
  cliente_id,
  'Pedido #' || order_ref,
  total,
  0,
  coalesce(fecha, created_at, now())
FROM missing_debt;

WITH bounds AS (
  SELECT
    (date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires') AS start_utc,
    ((date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') + interval '1 day') AT TIME ZONE 'America/Argentina/Buenos_Aires') AS end_utc
),
finalized_today AS (
  SELECT
    p.*,
    left(p.id::text, 6) AS order_ref
  FROM public.gst_pedidos p
  CROSS JOIN bounds b
  WHERE lower(p.estado) IN ('finalizado', 'cobrado')
    AND lower(coalesce(p.estado, '')) NOT IN ('cancelado', 'cancelada', 'cancelled')
    AND coalesce(p.fecha, p.created_at) >= b.start_utc
    AND coalesce(p.fecha, p.created_at) < b.end_utc
),
missing_cobro AS (
  SELECT ft.*
  FROM finalized_today ft
  WHERE coalesce(trim(ft.medio_pago), '') <> ''
    AND lower(trim(ft.medio_pago)) NOT IN ('cta cte', 'cuenta corriente (deuda)', 'cuenta corriente')
    AND NOT EXISTS (
      SELECT 1 FROM public.gst_cliente_movimientos m
      WHERE m.business_id = ft.business_id
        AND m.cliente_id = ft.cliente_id
        AND (
          m.concepto LIKE 'Crédito Pedido #' || ft.order_ref || '%'
          OR m.concepto LIKE 'Anticipo Pedido #' || ft.order_ref || '%'
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.gst_cliente_movimientos m
      WHERE m.business_id = ft.business_id
        AND m.cliente_id = ft.cliente_id
        AND m.concepto LIKE 'Cobro Pedido #' || ft.order_ref || '%'
        AND m.concepto NOT LIKE 'Reversión%'
    )
)
INSERT INTO public.gst_cliente_movimientos (business_id, cliente_id, concepto, debe, haber, fecha)
SELECT
  business_id,
  cliente_id,
  'Cobro Pedido #' || order_ref || ' (' || medio_pago || ')',
  0,
  total,
  coalesce(fecha, created_at, now())
FROM missing_cobro;

WITH saldo_calc AS (
  SELECT
    business_id,
    cliente_id,
    round(sum(debe - haber)::numeric, 2) AS nuevo_saldo
  FROM public.gst_cliente_movimientos
  GROUP BY business_id, cliente_id
)
UPDATE public.gst_clientes c
SET saldo = s.nuevo_saldo
FROM saldo_calc s
WHERE c.id = s.cliente_id
  AND c.business_id = s.business_id;

COMMIT;

-- Verificación: pedidos finalizados hoy y sus movimientos
-- SELECT p.id, left(p.id::text, 6) AS ref, p.cliente_id, p.total, p.medio_pago, p.estado, p.fecha, p.created_at
-- FROM public.gst_pedidos p
-- WHERE lower(p.estado) IN ('finalizado', 'cobrado')
--   AND coalesce(p.fecha, p.created_at)::date = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
-- ORDER BY coalesce(p.fecha, p.created_at) DESC;
