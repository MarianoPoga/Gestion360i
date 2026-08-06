-- Eliminar movimientos "Reversión …" (legacy) y recalcular saldos
-- Supabase SQL Editor: ejecutar UN bloque a la vez.

-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 — Funciones (ejecutar una vez)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cc_saldo_neto_cliente(p_cliente_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT round(coalesce(sum(
    coalesce(m.debe, 0)
    - CASE
        WHEN m.concepto LIKE '%Cobro Pedido #%'
         AND m.concepto LIKE '%saldo a favor%'
        THEN 0
        ELSE coalesce(m.haber, 0)
      END
  ), 0)::numeric, 2)
  FROM public.gst_cliente_movimientos m
  WHERE m.cliente_id = p_cliente_id;
$$;


CREATE OR REPLACE FUNCTION public.cc_reversiones_preview()
RETURNS TABLE (
  movimiento_id uuid,
  cliente_id uuid,
  cliente_nombre text,
  concepto text,
  debe numeric,
  haber numeric,
  fecha timestamptz
)
LANGUAGE sql
AS $$
  SELECT
    m.id,
    m.cliente_id,
    c.nombre,
    m.concepto,
    round(coalesce(m.debe, 0)::numeric, 2),
    round(coalesce(m.haber, 0)::numeric, 2),
    m.fecha
  FROM public.gst_cliente_movimientos m
  JOIN public.gst_clientes c ON c.id = m.cliente_id
  WHERE m.concepto ILIKE '%reversi%'
  ORDER BY c.nombre, m.fecha;
$$;


CREATE OR REPLACE FUNCTION public.cc_reversiones_apply()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  n_deleted int;
  n_clientes int;
BEGIN
  DELETE FROM public.gst_cliente_movimientos m
  WHERE m.concepto ILIKE '%reversi%';
  GET DIAGNOSTICS n_deleted = ROW_COUNT;

  UPDATE public.gst_clientes c
  SET saldo = public.cc_saldo_neto_cliente(c.id);

  GET DIAGNOSTICS n_clientes = ROW_COUNT;

  UPDATE public.gst_clientes c
  SET saldo = 0
  WHERE NOT EXISTS (
    SELECT 1 FROM public.gst_cliente_movimientos m WHERE m.cliente_id = c.id
  );

  RETURN format(
    'OK: %s movimientos Reversión borrados, %s saldos recalculados.',
    n_deleted,
    n_clientes
  );
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 — Preview (cuántos y cuáles se borran)
-- ══════════════════════════════════════════════════════════════════════════════

-- SELECT count(*) AS total_reversiones FROM public.cc_reversiones_preview();
-- SELECT * FROM public.cc_reversiones_preview();


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 — Aplicar limpieza
-- ══════════════════════════════════════════════════════════════════════════════

-- SELECT public.cc_reversiones_apply();


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 — Verificar (sin Reversión restante)
-- ══════════════════════════════════════════════════════════════════════════════

-- SELECT count(*) AS reversiones_restantes
-- FROM public.gst_cliente_movimientos
-- WHERE concepto ILIKE '%reversi%';
