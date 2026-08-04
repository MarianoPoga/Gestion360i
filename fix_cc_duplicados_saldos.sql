-- Eliminar Pedido # duplicados y recalcular saldos
-- Supabase SQL Editor: ejecutar UN bloque a la vez.

-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 — Crear funciones (ejecutar una vez)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cc_duplicados_preview()
RETURNS TABLE (
  seccion text,
  cliente_nombre text,
  order_ref text,
  monto numeric,
  concepto text,
  movimiento_id uuid,
  fecha timestamptz
)
LANGUAGE sql
AS $$
  WITH pedido_charges AS (
    SELECT
      m.id,
      c.nombre AS cliente_nombre,
      substring(m.concepto from '#([A-Za-z0-9_]+)') AS order_ref,
      round(coalesce(m.debe, 0)::numeric, 2) AS monto,
      m.concepto,
      m.fecha,
      row_number() OVER (
        PARTITION BY m.cliente_id, substring(m.concepto from '#([A-Za-z0-9_]+)')
        ORDER BY m.fecha ASC, m.id ASC
      ) AS rn
    FROM public.gst_cliente_movimientos m
    JOIN public.gst_clientes c ON c.id = m.cliente_id
    WHERE m.concepto ~ '^Pedido #'
      AND coalesce(m.debe, 0) > 0
  )
  SELECT
    CASE WHEN rn > 1 THEN 'DUPLICADO_A_BORRAR' ELSE 'PEDIDO_OK' END,
    cliente_nombre,
    order_ref,
    monto,
    concepto,
    id,
    fecha
  FROM pedido_charges
  ORDER BY cliente_nombre, order_ref, rn;
$$;


CREATE OR REPLACE FUNCTION public.cc_duplicados_apply()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  n_deleted int;
  n_clientes int;
BEGIN
  WITH pedido_charges AS (
    SELECT
      m.id,
      row_number() OVER (
        PARTITION BY m.cliente_id, substring(m.concepto from '#([A-Za-z0-9_]+)')
        ORDER BY m.fecha ASC, m.id ASC
      ) AS rn
    FROM public.gst_cliente_movimientos m
    WHERE m.concepto ~ '^Pedido #'
      AND coalesce(m.debe, 0) > 0
  ),
  to_delete AS (
    SELECT id FROM pedido_charges WHERE rn > 1
  )
  DELETE FROM public.gst_cliente_movimientos m
  USING to_delete d
  WHERE m.id = d.id;
  GET DIAGNOSTICS n_deleted = ROW_COUNT;

  WITH saldo_calc AS (
    SELECT
      m.cliente_id,
      round(sum(coalesce(m.debe, 0) - coalesce(m.haber, 0))::numeric, 2) AS nuevo_saldo
    FROM public.gst_cliente_movimientos m
    GROUP BY m.cliente_id
  )
  UPDATE public.gst_clientes c
  SET saldo = coalesce(s.nuevo_saldo, 0)
  FROM saldo_calc s
  WHERE c.id = s.cliente_id;
  GET DIAGNOSTICS n_clientes = ROW_COUNT;

  UPDATE public.gst_clientes c
  SET saldo = 0
  WHERE NOT EXISTS (
    SELECT 1 FROM public.gst_cliente_movimientos m WHERE m.cliente_id = c.id
  );

  RETURN format('OK: %s movimientos duplicados borrados, %s saldos recalculados.', n_deleted, n_clientes);
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 — Preview (ejecutar solo esta línea)
-- ══════════════════════════════════════════════════════════════════════════════

-- SELECT * FROM public.cc_duplicados_preview() WHERE seccion = 'DUPLICADO_A_BORRAR';


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 — Aplicar
-- ══════════════════════════════════════════════════════════════════════════════

-- SELECT public.cc_duplicados_apply();


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 — Verificar Estudio Diez (opcional)
-- ══════════════════════════════════════════════════════════════════════════════

-- SELECT c.nombre, round(c.saldo::numeric, 2) AS saldo
-- FROM public.gst_clientes c
-- WHERE c.nombre ILIKE '%Estudio Diez%';
