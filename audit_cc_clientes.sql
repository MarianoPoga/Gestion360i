-- Auditoría CC: todos los clientes
-- Ejecutar en Supabase → SQL Editor

-- 1) Deudas Pedido # duplicadas por cliente y compra
WITH pedido_charges AS (
  SELECT
    m.business_id,
    m.cliente_id,
    c.nombre AS cliente_nombre,
    substring(m.concepto from '#([A-Za-z0-9_]+)') AS order_ref,
    m.id,
    m.concepto,
    round(coalesce(m.debe, 0)::numeric, 2) AS debe,
    m.fecha
  FROM public.gst_cliente_movimientos m
  JOIN public.gst_clientes c ON c.id = m.cliente_id
  WHERE m.concepto ~ '^Pedido #'
    AND coalesce(m.debe, 0) > 0
),
dupes AS (
  SELECT
    business_id,
    cliente_id,
    cliente_nombre,
    order_ref,
    count(*) AS pedido_count,
    array_agg(debe ORDER BY fecha) AS montos,
    array_agg(concepto ORDER BY fecha) AS conceptos
  FROM pedido_charges
  GROUP BY 1, 2, 3, 4
  HAVING count(*) > 1
)
SELECT * FROM dupes
ORDER BY cliente_nombre, order_ref;

-- 2) Saldo guardado vs neto de movimientos (sin deduplicar)
WITH mov_net AS (
  SELECT
    m.cliente_id,
    round(sum(coalesce(m.debe, 0) - coalesce(m.haber, 0))::numeric, 2) AS net_raw
  FROM public.gst_cliente_movimientos m
  GROUP BY m.cliente_id
),
mov_net_dedup AS (
  SELECT
    cliente_id,
    round(sum(debe - haber)::numeric, 2) AS net_dedup
  FROM (
    SELECT
      m.cliente_id,
      m.debe,
      m.haber,
      row_number() OVER (
        PARTITION BY m.cliente_id, substring(m.concepto from '#([A-Za-z0-9_]+)')
        ORDER BY m.fecha, m.id
      ) AS pedido_rn
    FROM public.gst_cliente_movimientos m
    WHERE NOT (
      m.concepto ~ '^Pedido #'
      AND coalesce(m.debe, 0) > 0
    )
    UNION ALL
    SELECT
      m.cliente_id,
      m.debe,
      m.haber,
      row_number() OVER (
        PARTITION BY m.cliente_id, substring(m.concepto from '#([A-Za-z0-9_]+)')
        ORDER BY m.fecha, m.id
      ) AS pedido_rn
    FROM public.gst_cliente_movimientos m
    WHERE m.concepto ~ '^Pedido #'
      AND coalesce(m.debe, 0) > 0
  ) x
  WHERE pedido_rn = 1 OR pedido_rn IS NULL
  GROUP BY cliente_id
)
SELECT
  c.nombre,
  round(coalesce(c.saldo, 0)::numeric, 2) AS saldo_guardado,
  n.net_raw,
  d.net_dedup AS saldo_calculado,
  round((coalesce(c.saldo, 0) - d.net_dedup)::numeric, 2) AS diff
FROM public.gst_clientes c
LEFT JOIN mov_net n ON n.cliente_id = c.id
LEFT JOIN mov_net_dedup d ON d.cliente_id = c.id
WHERE abs(coalesce(c.saldo, 0) - coalesce(d.net_dedup, 0)) > 0.02
   OR abs(coalesce(n.net_raw, 0) - coalesce(d.net_dedup, 0)) > 0.02
ORDER BY abs(coalesce(c.saldo, 0) - coalesce(d.net_dedup, 0)) DESC;

-- 3) Pagos legacy sin compra en concepto
SELECT
  c.nombre,
  count(*) AS pagos_legacy,
  round(sum(coalesce(m.haber, 0))::numeric, 2) AS total_haber
FROM public.gst_cliente_movimientos m
JOIN public.gst_clientes c ON c.id = m.cliente_id
WHERE m.concepto LIKE 'Pago cuenta corriente%'
GROUP BY c.nombre
ORDER BY pagos_legacy DESC;
