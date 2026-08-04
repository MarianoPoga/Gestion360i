-- Migrar pagos legacy → Cobro Pedido #ref (FIFO)
-- Supabase SQL Editor: ejecutar UN bloque a la vez (cada bloque es una sola sentencia).

-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 — Crear funciones (ejecutar una vez)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cc_legacy_migration_preview()
RETURNS TABLE (
  seccion text,
  cliente_nombre text,
  order_ref text,
  monto numeric,
  concepto text,
  fecha timestamptz
)
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  ord RECORD;
  remaining numeric;
  pending numeric;
  apply_amt numeric;
  medio text;
BEGIN
  DROP TABLE IF EXISTS public._cc_mig_cobros;
  DROP TABLE IF EXISTS public._cc_mig_depositos;

  CREATE TABLE public._cc_mig_cobros (
    legacy_id uuid,
    cliente_nombre text,
    business_id uuid,
    cliente_id uuid,
    order_ref text,
    monto numeric,
    concepto text,
    fecha timestamptz
  );

  CREATE TABLE public._cc_mig_depositos (
    legacy_id uuid,
    cliente_nombre text,
    business_id uuid,
    cliente_id uuid,
    monto numeric,
    concepto text,
    fecha timestamptz
  );

  FOR rec IN
    SELECT
      m.id AS legacy_id,
      m.business_id,
      m.cliente_id,
      c.nombre AS cliente_nombre,
      m.fecha AS pago_fecha,
      round(coalesce(m.haber, 0)::numeric, 2) AS pago_monto,
      coalesce(nullif(trim(substring(m.concepto from '\(([^)]+)\)')), ''), 'Efectivo') AS medio
    FROM public.gst_cliente_movimientos m
    JOIN public.gst_clientes c ON c.id = m.cliente_id
    WHERE m.concepto LIKE 'Pago cuenta corriente%'
      AND coalesce(m.haber, 0) > 0
    ORDER BY m.fecha, m.id
  LOOP
    remaining := rec.pago_monto;
    medio := rec.medio;

    FOR ord IN
      SELECT
        left(p.id::text, 6) AS order_ref,
        coalesce(p.fecha, p.created_at) AS order_fecha
      FROM public.gst_pedidos p
      WHERE p.cliente_id = rec.cliente_id
        AND lower(coalesce(p.estado, '')) IN ('finalizado', 'cobrado')
        AND lower(coalesce(p.estado, '')) NOT IN ('cancelado', 'cancelada', 'cancelled')
        AND coalesce(p.fecha, p.created_at) <= rec.pago_fecha
      ORDER BY coalesce(p.fecha, p.created_at), left(p.id::text, 6)
    LOOP
      EXIT WHEN remaining <= 0.005;

      SELECT greatest(0, round(coalesce(sum(coalesce(m2.debe, 0) - coalesce(m2.haber, 0)), 0)::numeric, 2))
      INTO pending
      FROM public.gst_cliente_movimientos m2
      WHERE m2.cliente_id = rec.cliente_id
        AND m2.concepto LIKE '%#' || ord.order_ref || '%'
        AND m2.fecha <= rec.pago_fecha
        AND m2.id <> rec.legacy_id;

      IF pending <= 0.005 THEN
        CONTINUE;
      END IF;

      apply_amt := least(remaining, pending);

      INSERT INTO public._cc_mig_cobros VALUES (
        rec.legacy_id, rec.cliente_nombre, rec.business_id, rec.cliente_id,
        ord.order_ref, apply_amt,
        'Cobro Pedido #' || ord.order_ref || ' (' || medio || ')',
        rec.pago_fecha
      );

      remaining := round((remaining - apply_amt)::numeric, 2);
    END LOOP;

    IF remaining > 0.005 THEN
      INSERT INTO public._cc_mig_depositos VALUES (
        rec.legacy_id, rec.cliente_nombre, rec.business_id, rec.cliente_id,
        remaining, 'Depósito cuenta corriente (' || medio || ')', rec.pago_fecha
      );
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT 'COBROS'::text, c.cliente_nombre, c.order_ref, c.monto, c.concepto, c.fecha
  FROM public._cc_mig_cobros c
  ORDER BY c.cliente_nombre, c.fecha, c.order_ref;

  RETURN QUERY
  SELECT 'DEPOSITO'::text, d.cliente_nombre, NULL::text, d.monto, d.concepto, d.fecha
  FROM public._cc_mig_depositos d
  ORDER BY d.cliente_nombre, d.fecha;

  RETURN QUERY
  SELECT 'LEGACY_A_BORRAR'::text, c.nombre, NULL::text,
         round(m.haber::numeric, 2), m.concepto, m.fecha
  FROM public.gst_cliente_movimientos m
  JOIN public.gst_clientes c ON c.id = m.cliente_id
  WHERE m.concepto LIKE 'Pago cuenta corriente%';
END;
$$;


CREATE OR REPLACE FUNCTION public.cc_legacy_migration_apply()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  n_cobros int;
  n_depositos int;
  n_deleted int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = '_cc_mig_cobros'
  ) THEN
    RAISE EXCEPTION 'Ejecutá primero: SELECT * FROM cc_legacy_migration_preview();';
  END IF;

  INSERT INTO public.gst_cliente_movimientos (business_id, cliente_id, concepto, debe, haber, fecha)
  SELECT business_id, cliente_id, concepto, 0, monto, fecha
  FROM public._cc_mig_cobros;
  GET DIAGNOSTICS n_cobros = ROW_COUNT;

  INSERT INTO public.gst_cliente_movimientos (business_id, cliente_id, concepto, debe, haber, fecha)
  SELECT business_id, cliente_id, concepto, 0, monto, fecha
  FROM public._cc_mig_depositos;
  GET DIAGNOSTICS n_depositos = ROW_COUNT;

  DELETE FROM public.gst_cliente_movimientos m
  WHERE m.id IN (
    SELECT legacy_id FROM public._cc_mig_cobros
    UNION
    SELECT legacy_id FROM public._cc_mig_depositos
  );
  GET DIAGNOSTICS n_deleted = ROW_COUNT;

  DROP TABLE IF EXISTS public._cc_mig_cobros;
  DROP TABLE IF EXISTS public._cc_mig_depositos;

  RETURN format('OK: %s cobros, %s depósitos, %s pagos legacy borrados.', n_cobros, n_depositos, n_deleted);
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 — Preview (ejecutar solo esta línea)
-- ══════════════════════════════════════════════════════════════════════════════

-- SELECT * FROM public.cc_legacy_migration_preview();


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 — Aplicar (ejecutar solo después de revisar el preview)
-- ══════════════════════════════════════════════════════════════════════════════

-- SELECT public.cc_legacy_migration_apply();


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 — Verificar (opcional)
-- ══════════════════════════════════════════════════════════════════════════════

-- SELECT c.nombre, count(*) AS pagos_legacy
-- FROM public.gst_cliente_movimientos m
-- JOIN public.gst_clientes c ON c.id = m.cliente_id
-- WHERE m.concepto LIKE 'Pago cuenta corriente%'
-- GROUP BY c.nombre;
