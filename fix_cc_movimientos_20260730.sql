-- Corregir movimientos de cuenta corriente del 30/07/2026 (Argentina)
-- Ejecutar en Supabase → SQL Editor
--
-- Regla:
--   • Si hubo pago antes de finalizar → 1) Crédito (haber)  2) Pedido (debe)
--   • Si finalizó en Cta Cte sin cobrar → 1) Pedido (debe)
--   • Si pagó al finalizar (sin crédito previo) → 1) Pedido (debe)  2) Cobro (haber)
--
-- Borra movimientos erróneos/duplicados de esos pedidos y los reconstruye.

BEGIN;

DELETE FROM public.gst_cliente_movimientos
WHERE concepto LIKE 'Aplicación anticipo Pedido #%';

WITH bounds AS (
  SELECT
    ('2026-07-30'::date AT TIME ZONE 'America/Argentina/Buenos_Aires') AS start_utc,
    ('2026-07-31'::date AT TIME ZONE 'America/Argentina/Buenos_Aires') AS end_utc
),
finalized_day AS (
  SELECT
    p.*,
    left(p.id::text, 6) AS order_ref,
    coalesce(p.fecha, p.created_at, now()) AS finalize_ts,
    round(coalesce(p.total, 0)::numeric, 2) AS order_total,
    trim(coalesce(p.medio_pago, '')) AS medio_trim,
    lower(trim(coalesce(p.medio_pago, ''))) AS medio_lower
  FROM public.gst_pedidos p
  CROSS JOIN bounds b
  WHERE lower(coalesce(p.estado, '')) IN ('finalizado', 'cobrado')
    AND lower(coalesce(p.estado, '')) NOT IN ('cancelado', 'cancelada', 'cancelled')
    AND coalesce(p.fecha, p.created_at) >= b.start_utc
    AND coalesce(p.fecha, p.created_at) < b.end_utc
),
credit_hints AS (
  SELECT DISTINCT ON (fd.id)
    fd.id AS pedido_id,
    fd.order_ref,
    m.concepto AS credit_concepto,
    m.fecha AS credit_fecha
  FROM finalized_day fd
  JOIN public.gst_cliente_movimientos m
    ON m.business_id = fd.business_id
   AND m.cliente_id = fd.cliente_id
   AND (
     m.concepto LIKE 'Crédito Pedido #' || fd.order_ref || '%'
     OR m.concepto LIKE 'Anticipo Pedido #' || fd.order_ref || '%'
   )
  ORDER BY fd.id, m.fecha ASC
),
removed AS (
  DELETE FROM public.gst_cliente_movimientos m
  USING finalized_day fd
  WHERE m.business_id = fd.business_id
    AND m.cliente_id = fd.cliente_id
    AND m.concepto LIKE '%#' || fd.order_ref || '%'
  RETURNING m.id
),
expected AS (
  -- Crédito previo + deuda al finalizar
  SELECT
    fd.business_id,
    fd.cliente_id,
    coalesce(
      ch.credit_concepto,
      'Crédito Pedido #' || fd.order_ref || ' (' || fd.medio_trim || ')'
    ) AS concepto,
    0::numeric AS debe,
    fd.order_total AS haber,
    coalesce(ch.credit_fecha, fd.finalize_ts - interval '1 minute') AS fecha,
    1 AS sort_key
  FROM finalized_day fd
  JOIN credit_hints ch ON ch.pedido_id = fd.id

  UNION ALL

  SELECT
    fd.business_id,
    fd.cliente_id,
    'Pedido #' || fd.order_ref,
    fd.order_total,
    0::numeric,
    fd.finalize_ts,
    2 AS sort_key
  FROM finalized_day fd
  JOIN credit_hints ch ON ch.pedido_id = fd.id

  UNION ALL

  -- Solo deuda (Cta Cte o sin medio)
  SELECT
    fd.business_id,
    fd.cliente_id,
    'Pedido #' || fd.order_ref,
    fd.order_total,
    0::numeric,
    fd.finalize_ts,
    1 AS sort_key
  FROM finalized_day fd
  LEFT JOIN credit_hints ch ON ch.pedido_id = fd.id
  WHERE ch.pedido_id IS NULL
    AND (
      fd.medio_trim = ''
      OR fd.medio_lower IN ('cta cte', 'cuenta corriente (deuda)', 'cuenta corriente')
    )

  UNION ALL

  -- Deuda al finalizar + cobro (pagó al finalizar, sin crédito previo)
  SELECT
    fd.business_id,
    fd.cliente_id,
    'Pedido #' || fd.order_ref,
    fd.order_total,
    0::numeric,
    fd.finalize_ts,
    1 AS sort_key
  FROM finalized_day fd
  LEFT JOIN credit_hints ch ON ch.pedido_id = fd.id
  WHERE ch.pedido_id IS NULL
    AND fd.medio_trim <> ''
    AND fd.medio_lower NOT IN ('cta cte', 'cuenta corriente (deuda)', 'cuenta corriente')

  UNION ALL

  SELECT
    fd.business_id,
    fd.cliente_id,
    'Cobro Pedido #' || fd.order_ref || ' (' || fd.medio_trim || ')',
    0::numeric,
    fd.order_total,
    fd.finalize_ts + interval '1 second',
    2 AS sort_key
  FROM finalized_day fd
  LEFT JOIN credit_hints ch ON ch.pedido_id = fd.id
  WHERE ch.pedido_id IS NULL
    AND fd.medio_trim <> ''
    AND fd.medio_lower NOT IN ('cta cte', 'cuenta corriente (deuda)', 'cuenta corriente')
)
INSERT INTO public.gst_cliente_movimientos (business_id, cliente_id, concepto, debe, haber, fecha)
SELECT business_id, cliente_id, concepto, debe, haber, fecha
FROM expected
ORDER BY cliente_id, fecha, sort_key;

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

-- Verificación (descomentar):
-- WITH bounds AS (
--   SELECT
--     ('2026-07-30'::date AT TIME ZONE 'America/Argentina/Buenos_Aires') AS start_utc,
--     ('2026-07-31'::date AT TIME ZONE 'America/Argentina/Buenos_Aires') AS end_utc
-- )
-- SELECT
--   left(p.id::text, 6) AS ref,
--   c.nombre,
--   p.total,
--   p.medio_pago,
--   m.concepto,
--   m.debe,
--   m.haber,
--   m.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires' AS fecha_ar
-- FROM public.gst_pedidos p
-- JOIN bounds b ON coalesce(p.fecha, p.created_at) >= b.start_utc
--   AND coalesce(p.fecha, p.created_at) < b.end_utc
-- JOIN public.gst_clientes c ON c.id = p.cliente_id
-- LEFT JOIN public.gst_cliente_movimientos m
--   ON m.cliente_id = p.cliente_id
--  AND m.business_id = p.business_id
--  AND m.concepto LIKE '%#' || left(p.id::text, 6) || '%'
-- WHERE lower(p.estado) IN ('finalizado', 'cobrado')
-- ORDER BY c.nombre, ref, m.fecha, m.concepto;
